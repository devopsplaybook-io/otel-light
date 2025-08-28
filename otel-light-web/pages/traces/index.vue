<template>
  <div id="traces-page">
    <SearchOptions @filterChanged="onFilterChanged" />
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
          :class="traceSpans[trace.traceId] ? 'trace-span-expanded' : ''"
          hydrate-on-visible
        />
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
import { UtilsDecompressJson } from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";

export default {
  components: { SearchOptions },
  data() {
    return {
      traces: [],
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      traceSpans: {},
      filter: {
        queryString: "",
      },
      sortKey: "time",
      sortOrder: "desc",
      fetchTime: null,
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
    this.refreshIntervalValue = RefreshIntervalService.get();
  },
  mounted() {
    const interval = parseInt(this.refreshIntervalValue, 10);
    if (interval > 0) {
      this.refreshIntervalId = setInterval(() => {
        this.fetchTraces();
      }, interval);
    }
  },
  beforeUnmount() {
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
      this.fetchTraces();
    },
    async getTraceSpans(traceId) {
      return await axios
        .get(
          `${
            (
              await Config.get()
            ).SERVER_URL
          }/analytics/traces/${traceId}/spans`,
          await AuthService.getAuthHeader()
        )
        .then((response) => {
          return response.data.spans;
        });
    },
    async toggleTrace(traceId) {
      if (this.traceSpans[traceId]) {
        delete this.traceSpans[traceId];
      } else {
        if (!this.traceSpans[traceId]) {
          const spans = await this.getTraceSpans(traceId);
          this.traceSpans[traceId] = spans;
        }
      }
    },
    async fetchTraces() {
      const fetchTime = new Date();
      this.fetchTime = fetchTime;
      const url = `${(await Config.get()).SERVER_URL}/analytics/traces${
        this.filter.queryString ? "?" + this.filter.queryString : ""
      }`;
      axios
        .get(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          if (fetchTime < this.fetchTime) {
            return;
          }
          this.traces = await UtilsDecompressJson(response.data.traces);
          for (const trace of this.traces) {
            trace.duration = trace.endTime - trace.startTime;
          }
          if (response.data.warning) {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              type: "warning",
              text: response.data.warning,
            });
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
      this.$router.push("/traces/stats");
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
</style>
