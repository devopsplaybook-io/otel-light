<template>
  <div id="traces-page">
    <div id="search-options">
      <input
        type="search"
        v-model="keywords"
        placeholder="Search"
        aria-label="Search"
        v-on:input="filterChanged"
      />
      <div id="search-options-dates">
        <label>From</label>
        <input type="number" min="0" v-model.number="fromValue" />
        <select v-model="fromUnit">
          <option value="minutes">minutes ago</option>
          <option value="hours">hours ago</option>
          <option value="days">days ago</option>
        </select>
        <label>To</label>
        <input type="number" min="0" v-model.number="toValue" />
        <select v-model="toUnit">
          <option value="minutes">minutes ago</option>
          <option value="hours">hours ago</option>
          <option value="days">days ago</option>
        </select>
      </div>
    </div>
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
import { debounce } from "lodash";
import { AuthService } from "~~/services/AuthService";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";
import Config from "~~/services/Config";
import axios from "axios";

export default {
  data() {
    return {
      traces: [],
      keywords: "",
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      traceSpans: {},
      fromValue: 10,
      fromUnit: "minutes",
      toValue: 0,
      toUnit: "minutes",
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
    this.refreshIntervalValue = RefreshIntervalService.get();
    this.fetchTraces();
  },
  mounted() {
    const interval = parseInt(this.refreshIntervalValue, 10);
    if (interval > 0) {
      this.refreshIntervalId = setInterval(() => {
        this.fetchTraces();
      }, interval * 1000);
    }
  },
  beforeUnmount() {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
  },
  watch: {
    keywords(newFilter) {
      const query = { ...route.query };
      if (newFilter) {
        query.keywords = newFilter;
      } else {
        delete query.keywords;
      }
    },
    fromValue: "dateFilterChanged",
    fromUnit: "dateFilterChanged",
    toValue: "dateFilterChanged",
    toUnit: "dateFilterChanged",
  },
  methods: {
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
    filterChanged: debounce(async function (e) {
      this.fetchTraces();
    }, 500),
    dateFilterChanged() {
      this.fetchTraces();
    },
    async fetchTraces() {
      function toNanoseconds(value, unit) {
        if (!value) return 0;
        const multipliers = {
          minutes: 60,
          hours: 60 * 60,
          days: 24 * 60 * 60,
        };
        const secondsAgo = value * (multipliers[unit] || 1);
        const nowNs = Date.now() * 1e6;
        return nowNs - secondsAgo * 1e9;
      }

      const params = {};
      if (this.keywords) {
        params.keywords = this.keywords;
      }

      const fromNs = toNanoseconds(this.fromValue, this.fromUnit);
      const toNs = toNanoseconds(this.toValue, this.toUnit);

      if (fromNs > 0) params.from = fromNs;
      if (toNs > 0) params.to = toNs;

      const queryString = new URLSearchParams(params).toString();
      const url = `${(await Config.get()).SERVER_URL}/analytics/traces${
        queryString ? "?" + queryString : ""
      }`;
      axios.get(url, await AuthService.getAuthHeader()).then((response) => {
        this.traces = response.data.traces;
      });
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

select {
  padding: 0.5em 1em;
  height: 2.6rem;
}
#search-options input {
  padding-top: 0.5em;
  padding-bottom: 0.5em;
  height: 2.6rem;
}

#search-options-dates {
  display: grid;
  grid-template-columns: auto 1fr auto auto 1fr auto;
  align-items: center;
  gap: 0.5rem;
}

.trace-expanded {
  background-color: #dfe3eb22;
}
.trace-span-expanded {
  background-color: #dfe3eb11;
}
</style>
