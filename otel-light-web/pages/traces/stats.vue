<template>
  <div id="traces-page">
    <SearchOptions @filterChanged="onFilterChanged" />
    <div id="traces">
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
            <Trace
              @click="onTraceClick(trace.traceId)"
              style="cursor: pointer"
              :trace="trace"
              :class="[traceSpans[trace.traceId] ? 'trace-expanded' : '']"
            />
            <TraceSpan
              v-if="traceSpans[trace.traceId]"
              :trace="trace"
              :traceSpans="traceSpans[trace.traceId]"
              :class="traceSpans[trace.traceId] ? 'trace-span-expanded' : ''"
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
import axios from "axios";
import SearchOptions from "~/components/SearchOptions.vue";
import Trace from "~/components/Trace.vue";
import TraceSpan from "~/components/TraceSpan.vue";
import { UtilsDecompressJson } from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { getDurationText } from "../services/Utils";

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export default {
  components: { SearchOptions, Trace, TraceSpan },
  data() {
    return {
      traces: [],
      traceSpans: {},
      filter: {
        queryString: "",
      },
      fetchTime: null,
      expandedGroup: null,
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
    this.fetchTraces();
  },
  computed: {
    groupedTraces() {
      // Group traces by serviceName, serviceVersion, name
      const groups = {};
      for (const trace of this.traces) {
        const key = [
          trace.serviceName || "",
          trace.serviceVersion || "",
          trace.name || "",
        ].join("||");
        if (!groups[key]) {
          groups[key] = {
            key,
            serviceName: trace.serviceName,
            serviceVersion: trace.serviceVersion,
            name: trace.name,
            traces: [],
          };
        }
        groups[key].traces.push(trace);
      }
      // Compute stats for each group
      return Object.values(groups).map((group) => {
        // Order traces by duration (descending)
        group.traces = group.traces
          .slice()
          .sort((a, b) => b.endTime - b.startTime - (a.endTime - a.startTime));
        const durations = group.traces.map((t) => t.endTime - t.startTime);
        const spanCounts = group.traces.map((t) => t.spanCount || 0);
        const nbErrors = group.traces.filter((t) => t.nbErrors > 0).length;
        const avgDuration =
          durations.reduce((a, b) => a + b, 0) / (durations.length || 1);
        const avgSpanCount =
          spanCounts.reduce((a, b) => a + b, 0) / (spanCounts.length || 1);
        const p90 = percentile(durations, 90);
        const p95 = percentile(durations, 95);
        const totalSpans = spanCounts.reduce((a, b) => a + b, 0);
        const traceCount = group.traces.length;
        return {
          ...group,
          avgDuration,
          avgSpanCount,
          nbErrors,
          p90,
          p95,
          totalSpans,
          traceCount,
        };
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
    formatDuration(ms) {
      return getDurationText(ms);
    },
    toggleGroup(idx) {
      this.expandedGroup = this.expandedGroup === idx ? null : idx;
    },
    goToTraces() {
      this.$router.push("/traces/");
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
