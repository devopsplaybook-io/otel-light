<template>
  <div id="traces-page">
    <SearchOptions @filterChanged="onFilterChanged" />
    <div id="traces">
      <div class="trace-summary">
        <b>Service</b>
        <b>Name</b>
        <b>Time</b>
        <b>Duration</b>
        <b>ID</b>
        <b>Spans</b>
      </div>
      <div v-for="trace of traces" :key="trace.traceId">
        <Trace
          @click="toggleTrace(trace.traceId)"
          style="cursor: pointer"
          :trace="trace"
          :class="traceSpans[trace.traceId] ? 'trace-expanded' : ''"
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
</template>

<script>
import axios from "axios";
import SearchOptions from "~/components/SearchOptions.vue";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError } from "~~/services/EventBus";
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
      const url = `${(await Config.get()).SERVER_URL}/analytics/traces${
        this.filter.queryString ? "?" + this.filter.queryString : ""
      }`;
      axios
        .get(url, await AuthService.getAuthHeader())
        .then((response) => {
          this.traces = response.data.traces;
        })
        .catch(handleError);
    },
  },
};
</script>

<style>
.trace-summary {
  min-width: 1200px;
  display: grid;
  grid-template-columns: 3fr 3fr 3fr 2fr 2fr 1fr;
  gap: 1rem;
  width: 100%;
}
.trace-summary span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

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
