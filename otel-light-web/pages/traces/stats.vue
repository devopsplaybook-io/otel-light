<template>
  <div id="traces-page" class="signals-page">
    <div class="report-tabs">
      <button
        v-for="report in reports"
        :key="report.id"
        @click="activeReport = report.id"
        :class="['report-tab', { active: activeReport === report.id }]"
      >
        {{ report.label }}
      </button>
    </div>

    <!-- ================================================================== -->
    <!-- Aggregated Traces Section (Dynamic)                                -->
    <!-- ================================================================== -->
    <div v-if="activeReport === 'aggregated'">
      <SearchOptions @filterChanged="onFilterChanged" type="traces" />
      <div id="traces" class="signals-scroll">
        <div class="trace-group-summary">
          <b>Service</b>
          <b>Name</b>
          <b>Traces</b>
          <b>Avg Spans</b>
          <b>Errors</b>
          <b>Avg Duration</b>
          <b>P90</b>
          <b>P95</b>
        </div>
        <div v-for="(group, idx) in groupedTraces" :key="group.key">
          <div
            class="trace-group-summary"
            style="cursor: pointer"
            @click="toggleGroup(idx)"
            :class="[
              { 'trace-group-summary-errors': group.nbErrors > 0 },
              expandedGroup === idx ? 'group-selected' : '',
            ]"
          >
            <span>{{ group.serviceName }}:{{ group.serviceVersion }}</span>
            <span>{{ group.name }}</span>
            <span>{{ group.traceCount }}</span>
            <span>{{ group.avgSpanCount.toFixed(1) }}</span>
            <span>{{ group.nbErrors }}</span>
            <span>{{ formatDuration(group.avgDuration) }}</span>
            <span>{{ formatDuration(group.p90) }}</span>
            <span>{{ formatDuration(group.p95) }}</span>
          </div>
          <div v-if="expandedGroup === idx" class="traces-group-expanded">
            <div class="trace-summary">
              <b>Service</b>
              <b>Name</b>
              <b>Time</b>
              <b>Duration</b>
              <b>ID</b>
              <b>Errors</b>
              <b>Spans</b>
            </div>
            <div v-for="trace in group.traces" :key="trace.traceId">
              <LazyTrace
                @click="onTraceClick(trace.traceId)"
                style="cursor: pointer"
                :trace="trace"
                :class="[traceSpans[trace.traceId] ? 'trace-expanded' : '']"
                hydrate-on-visible
              />
              <LazyTraceSpan
                v-if="traceSpans[trace.traceId]"
                :trace="trace"
                :traceSpans="traceSpans[trace.traceId]"
                :traceLogs="traceLogs[trace.traceId]"
                :class="traceSpans[trace.traceId] ? 'trace-span-expanded' : ''"
                hydrate-on-visible
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ================================================================== -->
    <!-- Longest Traces Section (Static Report - Line Graph)               -->
    <!-- ================================================================== -->
    <div v-if="activeReport === 'longest'" class="report-static">
      <div class="report-header">
        <div class="report-title-section">
          <h3>Longest Traces</h3>
          <span v-if="longestReport.generatedAt" class="report-meta">
            Generated {{ formatDate(longestReport.generatedAt) }} &mdash; Top
            {{ longestReport.topN }} &mdash; Last
            {{ longestReport.periodDays }} days
          </span>
          <span v-else class="report-meta report-pending">Generating…</span>
        </div>
      </div>
      <div v-if="longestReport.series && longestReport.series.length > 0">
        <TraceGroupLineChart
          :series="longestReport.series"
          :bucket-ns="longestReport.bucketNs"
          value-label="Max Duration (ns)"
        />
      </div>
      <div v-else class="report-empty">
        No data yet. The report is generated once daily.
      </div>
    </div>

    <!-- ================================================================== -->
    <!-- Most Called Traces Section (Static Report - Line Graph)            -->
    <!-- ================================================================== -->
    <div v-if="activeReport === 'most-called'" class="report-static">
      <div class="report-header">
        <div class="report-title-section">
          <h3>Most Called Traces</h3>
          <span v-if="mostCalledReport.generatedAt" class="report-meta">
            Generated {{ formatDate(mostCalledReport.generatedAt) }} &mdash; Top
            {{ mostCalledReport.topN }} &mdash; Last
            {{ mostCalledReport.periodDays }} days
          </span>
          <span v-else class="report-meta report-pending">Generating…</span>
        </div>
      </div>
      <div v-if="mostCalledReport.series && mostCalledReport.series.length > 0">
        <TraceGroupLineChart
          :series="mostCalledReport.series"
          :bucket-ns="mostCalledReport.bucketNs"
          value-label="Trace Count"
        />
      </div>
      <div v-else class="report-empty">
        No data yet. The report is generated once daily.
      </div>
    </div>

    <button class="fab-button" @click="goToTraces" title="Go to Analytics">
      <i class="bi bi-arrow-return-left"></i>&nbsp;Back
    </button>
  </div>
</template>

<script>
import axios from "axios";
import SearchOptions from "~/components/SearchOptions.vue";
import Trace from "~/components/Trace.vue";
import TraceSpan from "~/components/TraceSpan.vue";
import TraceGroupLineChart from "~/components/TraceGroupLineChart.vue";
import { UtilsDecompressJson } from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { handleError } from "~~/services/EventBus";
import { getDurationText } from "~/services/Utils";

export default {
  components: { SearchOptions, Trace, TraceSpan, TraceGroupLineChart },
  data() {
    return {
      groups: [],
      expandedGroupTraces: {},
      traceSpans: {},
      traceLogs: {},
      filter: {
        queryString: "",
      },
      fetchTime: null,
      expandedGroup: null,
      loadingExpanded: false,
      // Report tabs
      reports: [
        { id: "aggregated", label: "Aggregated Traces" },
        { id: "longest", label: "Longest Traces" },
        { id: "most-called", label: "Most Called Traces" },
      ],
      activeReport: "aggregated",
      longestReport: {
        generatedAt: null,
        periodDays: null,
        topN: null,
        bucketNs: null,
        series: [],
      },
      mostCalledReport: {
        generatedAt: null,
        periodDays: null,
        topN: null,
        bucketNs: null,
        series: [],
      },
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
    this.fetchTraces();
    this.fetchReport("longest");
    this.fetchReport("most-called");
  },
  computed: {
    groupedTraces() {
      // Server-side aggregated groups, enriched with per-group traces if expanded.
      return this.groups.map((g) => ({
        ...g,
        traces: this.expandedGroupTraces[g.key] || [],
      }));
    },
  },
  methods: {
    onFilterChanged(filter) {
      this.filter.queryString = filter.queryString;
      this.fetchTraces();
    },
    async fetchLongestTracesReport() {
      return this.fetchReport("longest");
    },
    async fetchReport(reportId) {
      const urlMap = {
        longest: `${SERVER_URL}/reports/longest-traces`,
        "most-called": `${SERVER_URL}/reports/most-called-traces`,
      };
      const url = urlMap[reportId];
      if (!url) return;
      try {
        const response = await axios.get(
          url,
          await AuthService.getAuthHeader(),
        );
        if (response.data) {
          const stateKey =
            reportId === "longest" ? "longestReport" : "mostCalledReport";
          const data = response.data;
          if (data.generatedAt === null) {
            this[stateKey] = {
              generatedAt: null,
              periodDays: null,
              topN: null,
              bucketNs: null,
              series: [],
            };
          } else {
            this[stateKey] = {
              generatedAt: data.generatedAt,
              periodDays: data.periodDays,
              topN: data.topN,
              bucketNs: data.bucketNs,
              series: data.series || [],
            };
          }
        }
      } catch (err) {
        handleError(err);
      }
    },
    async getTraceSpans(traceId) {
      return await axios
        .get(
          `${SERVER_URL}/analytics/traces/${traceId}/spans`,
          await AuthService.getAuthHeader(),
        )
        .then((response) => {
          return response.data.spans;
        });
    },
    async getTraceLogs(traceId) {
      return await axios
        .get(
          `${SERVER_URL}/analytics/traces/${traceId}/logs`,
          await AuthService.getAuthHeader(),
        )
        .then((response) => {
          return response.data.logs;
        });
    },
    async toggleTrace(traceId) {
      if (this.traceSpans[traceId]) {
        delete this.traceSpans[traceId];
        delete this.traceLogs[traceId];
      } else {
        if (!this.traceSpans[traceId]) {
          this.traceSpans[traceId] = await this.getTraceSpans(traceId);
          this.traceLogs[traceId] = await this.getTraceLogs(traceId);
        }
      }
    },
    async fetchTraces() {
      const fetchTime = new Date();
      this.fetchTime = fetchTime;
      const qs = this.filter.queryString || "";
      const url = `${SERVER_URL}/analytics/traces/stats${qs ? "?" + qs : ""}`;
      axios
        .get(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          if (fetchTime < this.fetchTime) {
            return;
          }
          const serverGroups = response.data.compressed
            ? await UtilsDecompressJson(response.data.groups)
            : response.data.groups;
          // Assign stable keys for expand tracking
          this.groups = (serverGroups || []).map((g) => ({
            ...g,
            key: [
              g.serviceName || "",
              g.serviceVersion || "",
              g.name || "",
            ].join("||"),
            p90: null,
            p95: null,
            totalSpans: Math.round((g.avgSpanCount || 0) * (g.traceCount || 0)),
          }));
          this.expandedGroupTraces = {};
          this.expandedGroup = null;
        })
        .catch(handleError);
    },
    formatDuration(ms) {
      return getDurationText(ms);
    },
    formatDate(isoString) {
      if (!isoString) return "";
      const d = new Date(isoString);
      return d.toLocaleString();
    },
    formatDateNs(ns) {
      if (!ns) return "";
      const d = new Date(ns / 1_000_000);
      return d.toLocaleString();
    },
    copyTraceId(traceId) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(traceId);
      }
    },
    async toggleGroup(idx) {
      if (this.expandedGroup === idx) {
        this.expandedGroup = null;
        return;
      }
      this.expandedGroup = idx;
      const group = this.groups[idx];
      if (!group || this.expandedGroupTraces[group.key]) return;
      // Lazy-fetch individual traces for this group via the list endpoint.
      this.loadingExpanded = true;
      const params = new URLSearchParams(this.filter.queryString || "");
      params.set("serviceName", group.serviceName);
      params.set("serviceVersion", group.serviceVersion || "");
      const url = `${SERVER_URL}/analytics/traces?${params.toString()}`;
      axios
        .get(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          const traces = await UtilsDecompressJson(response.data.traces);
          for (const t of traces) {
            t.duration = t.endTime - t.startTime;
          }
          traces.sort(
            (a, b) => b.endTime - b.startTime - (a.endTime - a.startTime),
          );
          this.expandedGroupTraces = {
            ...this.expandedGroupTraces,
            [group.key]: traces,
          };
        })
        .catch(handleError)
        .finally(() => {
          this.loadingExpanded = false;
        });
    },
    goToTraces() {
      this.$router.push({ path: "/traces/", query: this.$route.query });
    },
    onTraceClick(traceId) {
      this.toggleTrace(traceId);
    },
  },
};
</script>

<style scoped>
.trace-group-summary,
.trace-span-expanded {
  min-width: 1200px;
}
.trace-group-summary {
  display: grid;
  grid-template-columns: 2fr 2fr 1fr 1fr 1fr 2fr 2fr 2fr;
  gap: 1rem;
  width: 100%;
}
.trace-group-summary span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trace-group-summary b {
  cursor: pointer;
  user-select: none;
}
.trace-group-summary-errors {
  background-color: #ff950033;
}
.trace-span-expanded {
  background-color: #dfe3eb11;
}
.group-selected {
  background-color: #dfe3eb11;
}

.traces-group-expanded {
  padding: 1rem;
  background-color: #dfe3eb11;
}

.trace-expanded {
  background-color: #dfe3eb22;
}
.trace-span-expanded {
  background-color: #dfe3eb11;
}

/* Report Tabs */
.report-tabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid #ffffff22;
  padding-bottom: 0;
}
.report-tab {
  background: none;
  border: none;
  color: #aaa;
  padding: 0.5rem 1rem;
  cursor: pointer;
  font-size: 0.9rem;
  border-bottom: 2px solid transparent;
  transition:
    color 0.2s,
    border-color 0.2s;
}
.report-tab:hover {
  color: #ddd;
}
.report-tab.active {
  color: #fff;
  border-bottom-color: #4a9eff;
}

/* Report Static Section */
.report-static {
  width: 100%;
}
.report-header {
  margin-bottom: 1rem;
}
.report-title-section h3 {
  margin: 0 0 0.25rem 0;
  font-size: 1rem;
  font-weight: 600;
}
.report-meta {
  font-size: 0.8rem;
  color: #888;
}
.report-pending {
  font-style: italic;
}
.report-empty {
  padding: 2rem;
  text-align: center;
  color: #888;
  font-style: italic;
}
.trace-id {
  cursor: pointer;
  color: #4a9eff;
}
.trace-id:hover {
  text-decoration: underline;
}
</style>
