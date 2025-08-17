<template>
  <div id="metrics-page">
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
          <option value="minutes">min. ago</option>
          <option value="hours">h ago</option>
          <option value="days">days ago</option>
        </select>
        <label>To</label>
        <input type="number" min="0" v-model.number="toValue" />
        <select v-model="toUnit">
          <option value="minutes">min. ago</option>
          <option value="hours">h ago</option>
          <option value="days">days ago</option>
        </select>
      </div>
    </div>
    <div id="metrics-list">
      <article
        v-for="metric of metrics"
        :key="metric.serviceName + metric.serviceVersion + metric.name"
      >
        <header>
          <kbd>{{ metric.serviceName }}:{{ metric.serviceVersion }}</kbd>
          {{ metric.name }}
        </header>
        <MetricDataGauge v-if="metric.type == 'gauge'" :metric="metric" />
      </article>
    </div>
  </div>
</template>

<script>
import { find, debounce } from "lodash";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import axios from "axios";

export default {
  data() {
    return {
      metrics: [],
      keywords: "",
      refreshIntervalId: null,
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
    this.fetchMetrics();
  },
  mounted() {},
  beforeUnmount() {},
  watch: {
    fromValue: "dateFilterChanged",
    fromUnit: "dateFilterChanged",
    toValue: "dateFilterChanged",
    toUnit: "dateFilterChanged",
  },
  methods: {
    processMetrics(metrics) {
      const formattedMetrics = [];
      metrics.forEach((metric) => {
        let metricContainer = find(formattedMetrics, {
          serviceName: metric.serviceName,
          serviceVersion: metric.serviceVersion,
          name: metric.name,
        });

        if (!metricContainer) {
          metricContainer = {
            serviceName: metric.serviceName,
            serviceVersion: metric.serviceVersion,
            name: metric.name,
            type: metric.type,
            data: [],
          };
          formattedMetrics.push(metricContainer);
        }
        metricContainer.data.push(metric);
      });
      return formattedMetrics;
    },

    filterChanged: debounce(function () {
      this.fetchMetrics();
    }, 500),
    dateFilterChanged() {
      this.fetchMetrics();
    },

    async fetchMetrics() {
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
      const url = `${(await Config.get()).SERVER_URL}/analytics/metrics${
        queryString ? "?" + queryString : ""
      }`;
      axios.get(url, await AuthService.getAuthHeader()).then((response) => {
        this.metrics = this.processMetrics(response.data.metrics);
      });
    },
  },
};
</script>

<style scoped>
#metrics-page {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
}

#search-options {
  margin-bottom: 1rem;
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

#metrics-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(25rem, 1fr));
  gap: 1rem;
}

header kbd {
  font-size: 0.7em;
}
</style>
