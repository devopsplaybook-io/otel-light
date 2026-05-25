<template>
  <div id="traces-page" class="signals-page signals-page-stats">
    <TabNavigation :tabs="reports" />
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
    <button class="fab-button" @click="goToTraces" title="Go to Analytics">
      <i class="bi bi-arrow-return-left"></i>&nbsp;Back
    </button>
  </div>
</template>

<script>
import { analyticsGet } from "~~/services/AnalyticsQueue";
import SearchOptions from "~/components/SearchOptions.vue";
import Trace from "~/components/Trace.vue";
import TraceSpan from "~/components/TraceSpan.vue";
import { UtilsDecompressJson } from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { handleError } from "~~/services/EventBus";
import { getDurationText } from "~/services/Utils";

export default {
  components: { SearchOptions, Trace, TraceSpan },
  data() {
    return {
      reports: [
        {
          id: "aggregated",
          label: "Aggregated Traces",
          to: "/traces/stats/aggregated",
        },
        { id: "longest", label: "Longest Traces", to: "/traces/stats/longest" },
        {
          id: "most-called",
          label: "Most Called Traces",
          to: "/traces/stats/most-called",
        },
      ],
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
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
      return;
    }
    this.fetchTraces();
  },
  computed: {
    groupedTraces() {
      return this.groups.map((g) => ({
        ...g,
        traces: this.expandedGroupTraces[g.key] || [],
      }));
    },
  },
  methods: {
    goToTraces() {
      this.$router.push({ path: "/traces/", query: this.$route.query });
    },
    onFilterChanged(filter) {
      this.filter.queryString = filter.queryString;
      this.fetchTraces();
    },
    async getTraceSpans(traceId) {
      return await analyticsGet(
        `${SERVER_URL}/analytics/traces/${traceId}/spans`,
        await AuthService.getAuthHeader(),
      ).then((response) => {
        return response.data.spans;
      });
    },
    async getTraceLogs(traceId) {
      return await analyticsGet(
        `${SERVER_URL}/analytics/traces/${traceId}/logs`,
        await AuthService.getAuthHeader(),
      ).then((response) => {
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
      analyticsGet(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          if (fetchTime < this.fetchTime) {
            return;
          }
          const serverGroups = response.data.compressed
            ? await UtilsDecompressJson(response.data.groups)
            : response.data.groups;
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
    async toggleGroup(idx) {
      if (this.expandedGroup === idx) {
        this.expandedGroup = null;
        return;
      }
      this.expandedGroup = idx;
      const group = this.groups[idx];
      if (!group || this.expandedGroupTraces[group.key]) return;
      this.loadingExpanded = true;
      const params = new URLSearchParams(this.filter.queryString || "");
      params.set("serviceName", group.serviceName);
      params.set("serviceVersion", group.serviceVersion || "");
      const url = `${SERVER_URL}/analytics/traces?${params.toString()}`;
      analyticsGet(url, await AuthService.getAuthHeader())
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
    onTraceClick(traceId) {
      this.toggleTrace(traceId);
    },
  },
};
</script>

<style scoped>
.signals-page-stats {
  grid-template-rows: auto auto 1fr;
}

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
.trace-group-summary span,
.trace-group-summary b {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
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
</style>
