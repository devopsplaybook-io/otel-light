<template>
  <div id="logs-page" class="signals-page">
    <SearchOptions
      ref="searchOptions"
      @filterChanged="onFilterChanged"
      type="logs"
    />
    <div id="logs" class="signals-scroll">
      <div class="stats-summary">
        <span class="stats-total"
          ><b>Total</b> {{ totalCount.toLocaleString() }}</span
        >
        <span
          v-for="sev in severityOrder"
          :key="sev"
          v-show="severityCounts[sev]"
          class="stats-pill"
          :class="'stats-pill-' + sev.toLowerCase()"
        >
          <b>{{ sev }}</b> {{ (severityCounts[sev] || 0).toLocaleString() }}
        </span>
      </div>
      <div class="stats-chart">
        <apexchart
          type="bar"
          height="400"
          :options="chartOptions"
          :series="chartSeries"
        />
      </div>
      <div class="load-status">
        <Loading v-if="isLoading" size="small" />
        <span v-if="isLoading" class="progress-text"
          >Aggregating page {{ pagesLoaded }}&hellip;</span
        >
        <span
          v-else-if="pagesLoaded > 0 && totalCount === 0"
          class="no-more-data"
          >No data</span
        >
      </div>
    </div>
    <button class="fab-button" @click="goToLogs" title="Back to Logs">
      <i class="bi bi-arrow-return-left"></i>&nbsp;Back
    </button>
  </div>
</template>

<script>
import axios from "axios";
import VueApexCharts from "vue3-apexcharts";
import SearchOptions from "~/components/SearchOptions.vue";
import Loading from "~/components/Loading.vue";
import { UtilsDecompressJson } from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError } from "~~/services/EventBus";

const PAGE_SIZE = 200;
const TARGET_BUCKETS = 50;
const REDRAW_INTERVAL_MS = 250;

const SEVERITY_ORDER = ["FATAL", "ERROR", "WARN", "INFO", "DEBUG", "TRACE"];
const SEVERITY_COLORS = {
  FATAL: "#8b0000",
  ERROR: "#d93526",
  WARN: "#ff9500",
  INFO: "#0a84ff",
  DEBUG: "#7c8b99",
  TRACE: "#39b37a",
  UNKNOWN: "#999999",
};

export default {
  components: { SearchOptions, Loading, apexchart: VueApexCharts },
  data() {
    return {
      filter: { queryString: "" },
      isLoading: false,
      pagesLoaded: 0,
      totalCount: 0,
      severityCounts: {},
      chartSeries: [],
      chartOptions: this.buildChartOptions(),
      // Internal, non-reactive state
      severityOrder: SEVERITY_ORDER,
    };
  },
  beforeCreate() {
    // Non-reactive internals must be ready BEFORE the child SearchOptions
    // emits its initial `filterChanged` during its own created() hook.
    this.runId = 0;
    this.abortCtrl = null;
    this.pendingRaf = null;
    this.lastRedrawAt = 0;
    this.buckets = {}; // severity -> Map(bucketKey -> count)
    this.bucketKeys = new Set();
    this.windowFromNs = null;
    this.windowToNs = null;
    this.bucketMsNs = null; // bucket width in nanoseconds
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
  },
  beforeUnmount() {
    this.cancelInFlight();
    if (this.pendingRaf) {
      cancelAnimationFrame(this.pendingRaf);
      this.pendingRaf = null;
    }
  },
  methods: {
    buildChartOptions() {
      return {
        chart: {
          id: "logs-stats",
          type: "bar",
          stacked: true,
          animations: { enabled: false },
          toolbar: { autoSelected: "zoom" },
          zoom: { enabled: true },
        },
        plotOptions: {
          bar: { columnWidth: "95%" },
        },
        dataLabels: { enabled: false },
        stroke: { width: 0 },
        xaxis: {
          type: "datetime",
          labels: { datetimeUTC: false },
        },
        yaxis: {
          labels: {
            formatter: (v) => Math.round(v).toLocaleString(),
          },
        },
        tooltip: {
          x: { format: "dd MMM yyyy HH:mm:ss" },
          y: {
            formatter: (v) => Math.round(v).toLocaleString(),
          },
        },
        legend: { position: "bottom" },
        colors: SEVERITY_ORDER.map((s) => SEVERITY_COLORS[s]).concat([
          SEVERITY_COLORS.UNKNOWN,
        ]),
      };
    },
    cancelInFlight() {
      if (this.abortCtrl) {
        this.abortCtrl.abort();
        this.abortCtrl = null;
      }
    },
    resetState() {
      this.buckets = {};
      this.bucketKeys = new Set();
      this.totalCount = 0;
      this.severityCounts = {};
      this.chartSeries = [];
      this.pagesLoaded = 0;
      this.windowFromNs = null;
      this.windowToNs = null;
      this.bucketMsNs = null;
    },
    parseWindow() {
      // Extract from/to from queryString (in nanoseconds, per SearchOptions).
      // `to` is omitted by SearchOptions when the user picked "now" — default to
      // the current time so buckets span the real filter window rather than
      // only the first page's timestamps.
      const params = new URLSearchParams(this.filter.queryString || "");
      const fromNs = params.get("from") ? Number(params.get("from")) : null;
      const toNs = params.get("to")
        ? Number(params.get("to"))
        : Date.now() * 1_000_000;
      return { fromNs, toNs };
    },
    computeBucketWidth(fromNs, toNs) {
      const spanNs = Math.max(1e9, toNs - fromNs);
      // bucketMsNs in nanoseconds
      const raw = Math.ceil(spanNs / TARGET_BUCKETS);
      // round to at least 1 second
      return Math.max(1_000_000_000, raw);
    },
    foldPage(logs) {
      if (!logs || !logs.length) return;
      // Lazy bucket width if window unknown: derive from first page timestamps
      if (this.bucketMsNs === null) {
        let minT = Infinity;
        let maxT = -Infinity;
        for (const l of logs) {
          if (l.time < minT) minT = l.time;
          if (l.time > maxT) maxT = l.time;
        }
        const fromNs = this.windowFromNs !== null ? this.windowFromNs : minT;
        const toNs =
          this.windowToNs !== null
            ? this.windowToNs
            : Math.max(maxT, fromNs + 1e9);
        this.windowFromNs = fromNs;
        this.windowToNs = toNs;
        this.bucketMsNs = this.computeBucketWidth(fromNs, toNs);
      }

      const fromNs = this.windowFromNs;
      const bw = this.bucketMsNs;
      const counts = this.buckets;
      const keys = this.bucketKeys;
      const sevCounts = { ...this.severityCounts };
      let total = this.totalCount;

      for (const log of logs) {
        const sev = (log.severity || "UNKNOWN").toUpperCase();
        const t = log.time;
        // Normalize bucket: anchor at fromNs
        const idx = Math.floor((t - fromNs) / bw);
        const keyNs = fromNs + idx * bw;
        if (!counts[sev]) counts[sev] = new Map();
        counts[sev].set(keyNs, (counts[sev].get(keyNs) || 0) + 1);
        keys.add(keyNs);
        sevCounts[sev] = (sevCounts[sev] || 0) + 1;
        total++;
      }
      this.severityCounts = sevCounts;
      this.totalCount = total;
    },
    scheduleRedraw(force = false) {
      const now = Date.now();
      if (!force && now - this.lastRedrawAt < REDRAW_INTERVAL_MS) {
        if (this.pendingRaf) return;
        this.pendingRaf = requestAnimationFrame(() => {
          this.pendingRaf = null;
          this.redraw();
        });
        return;
      }
      this.redraw();
    },
    redraw() {
      this.lastRedrawAt = Date.now();
      if (!this.bucketKeys.size) {
        this.chartSeries = [];
        return;
      }
      const sortedKeys = Array.from(this.bucketKeys).sort((a, b) => a - b);
      const presentSeverities = Object.keys(this.buckets);
      // Keep a stable order: known severities first, then any unknowns
      const ordered = SEVERITY_ORDER.filter((s) =>
        presentSeverities.includes(s),
      ).concat(presentSeverities.filter((s) => !SEVERITY_ORDER.includes(s)));

      const series = ordered.map((sev) => {
        const map = this.buckets[sev];
        const data = sortedKeys.map((k) => [
          Math.round(k / 1_000_000), // ns -> ms
          map.get(k) || 0,
        ]);
        return { name: sev, data };
      });

      // Update colors to match series order
      const colors = ordered.map(
        (s) => SEVERITY_COLORS[s] || SEVERITY_COLORS.UNKNOWN,
      );
      this.chartOptions = { ...this.chartOptions, colors };
      this.chartSeries = series;
    },
    async onFilterChanged(filter) {
      this.filter.queryString = filter.queryString;
      await this.aggregate();
    },
    async aggregate() {
      this.cancelInFlight();
      if (this.pendingRaf) {
        cancelAnimationFrame(this.pendingRaf);
        this.pendingRaf = null;
      }
      this.abortCtrl = new AbortController();
      const ctrl = this.abortCtrl;
      const runId = ++this.runId;

      this.resetState();
      const { fromNs, toNs } = this.parseWindow();
      this.windowFromNs = fromNs;
      this.windowToNs = toNs;
      if (fromNs !== null && toNs !== null) {
        this.bucketMsNs = this.computeBucketWidth(fromNs, toNs);
      }

      this.isLoading = true;
      const baseUrl = (await Config.get()).SERVER_URL;
      const authHeader = await AuthService.getAuthHeader();

      try {
        // Build query string for stats endpoint from existing filter params.
        const params = new URLSearchParams(this.filter.queryString || "");
        // Always include explicit from/to, overriding any existing values.
        if (fromNs !== null) params.set("from", String(fromNs));
        if (toNs !== null) params.set("to", String(toNs));
        // Add bucket width in nanoseconds (derived from the time window).
        if (this.bucketMsNs !== null) {
          params.set("bucketNs", String(this.bucketMsNs));
        }
        const qs = params.toString();
        const url = `${baseUrl}/analytics/logs/stats${qs ? "?" + qs : ""}`;

        let res;
        try {
          res = await axios.get(url, {
            ...authHeader,
            signal: ctrl.signal,
          });
        } catch (err) {
          if (
            axios.isCancel?.(err) ||
            err?.name === "CanceledError" ||
            err?.code === "ERR_CANCELED"
          ) {
            return;
          }
          handleError(err);
          return;
        }
        if (runId !== this.runId) return;

        const data = res.data;
        // Populate the existing reactive data structures from server response.
        this.totalCount = data.totalCount || 0;
        this.severityCounts = data.severityCounts || {};
        this.buckets = {};
        this.bucketKeys = new Set();
        if (data.buckets) {
          for (const b of data.buckets) {
            for (const [sev, cnt] of Object.entries(b.severities)) {
              if (!this.buckets[sev]) this.buckets[sev] = new Map();
              this.buckets[sev].set(b.bucket, Number(cnt));
            }
            this.bucketKeys.add(b.bucket);
          }
        }
        this.pagesLoaded = 1;
        if (runId === this.runId) {
          this.scheduleRedraw(true);
        }
      } finally {
        if (runId === this.runId) {
          this.isLoading = false;
          this.abortCtrl = null;
        }
      }
    },
    goToLogs() {
      this.$router.push({ path: "/logs", query: this.$route.query });
    },
  },
};
</script>

<style scoped>
.stats-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.5rem 0;
  font-size: 0.9em;
}
.stats-total,
.stats-pill {
  padding: 0.25rem 0.6rem;
  border-radius: 1rem;
  background-color: #dfe3eb22;
  white-space: nowrap;
}
.stats-total b,
.stats-pill b {
  margin-right: 0.3em;
}
.stats-pill-fatal {
  background-color: #8b000033;
}
.stats-pill-error {
  background-color: #d9352633;
}
.stats-pill-warn {
  background-color: #ff950033;
}
.stats-pill-info {
  background-color: #0a84ff22;
}
.stats-pill-debug {
  background-color: #7c8b9922;
}
.stats-pill-trace {
  background-color: #39b37a22;
}
.stats-chart {
  padding: 0.5rem 0;
  min-height: 400px;
}
.progress-text {
  margin-left: 0.5rem;
  color: #888;
  font-size: 0.85em;
}
</style>
