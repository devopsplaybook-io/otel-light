<template>
  <div id="traces-page">
    <SearchOptions
      ref="searchOptions"
      @filterChanged="onFilterChanged"
      type="traces"
    />
    <div id="traces">
      <div class="trace-summary">
        <b @click="sortBy('service')" :class="headerClass('service')"
          >Service</b
        >
        <b @click="sortBy('name')" :class="headerClass('name')">Name</b>
        <b @click="sortBy('time')" :class="headerClass('time')">Time</b>
        <b @click="sortBy('duration')" :class="headerClass('duration')"
          >Duration</b
        >
        <b @click="sortBy('traceId')" :class="headerClass('traceId')">ID</b>
        <b @click="sortBy('nbErrors')" :class="headerClass('nbErrors')"
          >Errors</b
        >
        <b @click="sortBy('spanCount')" :class="headerClass('spanCount')"
          >Spans</b
        >
      </div>
      <div v-for="trace of sortedTraces" :key="trace.traceId">
        <LazyTrace
          @click="toggleTrace(trace.traceId)"
          style="cursor: pointer"
          :trace="trace"
          :class="traceSpans[trace.traceId] ? 'trace-expanded' : ''"
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
      <div id="traces-sentinel" ref="sentinel"></div>
      <div class="load-status">
        <Loading v-if="isLoadingMore" />
        <span v-else-if="!hasMore && traces.length > 0" class="no-more-data">No more data</span>
      </div>
    </div>
    <button class="fab-button" @click="goToAnalytics" title="Go to Analytics">
      <i class="bi bi-pie-chart-fill"></i>&nbsp;Stats
    </button>
  </div>
</template>

<script>
import axios from "axios";
import SearchOptions from "~/components/SearchOptions.vue";
import Loading from "~/components/Loading.vue";
import { UtilsDecompressJson } from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";

const PAGE_SIZE = 200;

export default {
  components: { SearchOptions, Loading },
  data() {
    return {
      traces: [],
      page: 0,
      hasMore: true,
      isLoadingMore: false,
      newestStartTime: null,
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      traceSpans: {},
      traceLogs: {},
      filter: {
        queryString: "",
      },
      sortKey: "time",
      sortOrder: "desc",
      fetchTime: null,
      observer: null,
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
    this.refreshIntervalValue = RefreshIntervalService.get();
  },
  mounted() {
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && this.hasMore && !this.isLoadingMore) {
          this.fetchTraces();
        }
      },
      { threshold: 0.1 },
    );
    if (this.$refs.sentinel) {
      this.observer.observe(this.$refs.sentinel);
    }
    const interval = parseInt(this.refreshIntervalValue, 10);
    if (interval > 0) {
      this.refreshIntervalId = setInterval(() => {
        this.fetchTracesRefresh();
      }, interval);
    }
  },
  beforeUnmount() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
  },
  computed: {
    sortedTraces() {
      if (!this.traces) return [];
      const tracesCopy = [...this.traces];
      const keyMap = {
        service: "serviceName",
        name: "name",
        time: "startTime",
        duration: "duration",
        traceId: "traceId",
        nbErrors: "nbErrors",
        spanCount: "spanCount",
      };
      const key = keyMap[this.sortKey] || this.sortKey;
      const order = this.sortOrder;
      return tracesCopy.sort((a, b) => {
        let aVal = a[key];
        let bVal = b[key];
        // Handle undefined/null values
        aVal = aVal === undefined || aVal === null ? "" : aVal;
        bVal = bVal === undefined || bVal === null ? "" : bVal;
        if (typeof aVal === "string" && typeof bVal === "string") {
          return order === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }
        return order === "asc" ? aVal - bVal : bVal - aVal;
      });
    },
  },
  methods: {
    onFilterChanged(filter) {
      this.filter.queryString = filter.queryString;
      this.page = 0;
      this.traces = [];
      this.hasMore = true;
      this.newestStartTime = null;
      this.fetchTraces();
    },
    async getTraceSpans(traceId) {
      return await axios
        .get(
          `${
            (await Config.get()).SERVER_URL
          }/analytics/traces/${traceId}/spans`,
          await AuthService.getAuthHeader(),
        )
        .then((response) => {
          return response.data.spans;
        });
    },
    async getTraceLogs(traceId) {
      return await axios
        .get(
          `${(await Config.get()).SERVER_URL}/analytics/traces/${traceId}/logs`,
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
      if (this.isLoadingMore || !this.hasMore) return;
      this.isLoadingMore = true;
      const fetchTime = new Date();
      this.fetchTime = fetchTime;
      const offset = this.page * PAGE_SIZE;
      const qs = this.filter.queryString
        ? `${this.filter.queryString}&offset=${offset}&limit=${PAGE_SIZE}`
        : `offset=${offset}&limit=${PAGE_SIZE}`;
      const url = `${(await Config.get()).SERVER_URL}/analytics/traces?${qs}`;
      axios
        .get(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          if (fetchTime < this.fetchTime) {
            return;
          }
          const newTraces = await UtilsDecompressJson(response.data.traces);
          if (newTraces && newTraces.length > 0) {
            for (const trace of newTraces) {
              trace.duration = trace.endTime - trace.startTime;
            }
            this.traces = [...this.traces, ...newTraces];
            this.page += 1;
            if (this.newestStartTime === null) {
              this.newestStartTime = newTraces[0].startTime;
            }
          }
          this.hasMore = response.data.hasMore === true;
        })
        .catch(handleError)
        .finally(() => {
          this.isLoadingMore = false;
        });
    },
    async fetchTracesRefresh() {
      if (!this.newestStartTime) return;
      const qs = this.filter.queryString
        ? `${this.filter.queryString}&afterTime=${this.newestStartTime}`
        : `afterTime=${this.newestStartTime}`;
      const url = `${(await Config.get()).SERVER_URL}/analytics/traces?${qs}`;
      axios
        .get(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          const newTraces = await UtilsDecompressJson(response.data.traces);
          if (newTraces && newTraces.length > 0) {
            for (const trace of newTraces) {
              trace.duration = trace.endTime - trace.startTime;
            }
            this.traces = [...newTraces, ...this.traces];
            this.newestStartTime = newTraces[0].startTime;
          }
        })
        .catch(handleError);
    },
    sortBy(key) {
      if (this.sortKey === key) {
        this.sortOrder = this.sortOrder === "asc" ? "desc" : "asc";
      } else {
        this.sortKey = key;
        this.sortOrder = "asc";
      }
    },
    headerClass(key) {
      return {
        sortable: true,
        sorted: this.sortKey === key,
        asc: this.sortKey === key && this.sortOrder === "asc",
        desc: this.sortKey === key && this.sortOrder === "desc",
      };
    },
    goToAnalytics() {
      this.$router.push({ path: "/traces/stats", query: this.$route.query });
    },
  },
};
</script>

<style></style>

<style scoped>
#traces-page {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
}

#traces {
  max-width: 100%;
  overflow-x: auto;
}

.trace-expanded {
  background-color: #dfe3eb22;
}
.trace-span-expanded {
  background-color: #dfe3eb11;
}

#traces-sentinel {
  height: 1px;
}

.load-status {
  padding: 0.75rem 0;
  text-align: center;
}

.no-more-data {
  color: #888;
  font-size: 0.85em;
}
</style>
