<template>
  <div id="metrics-page">
    <SearchOptions @filterChanged="onFilterChanged" />
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
import { find, sortBy } from "lodash";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import axios from "axios";
import SearchOptions from "~/components/SearchOptions.vue";

export default {
  components: { SearchOptions },
  data() {
    return {
      metrics: [],
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
        this.fetchMetrics();
      }, interval);
    }
  },
  beforeUnmount() {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
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
      // Sort by serviceName, serviceVersion, name
      return sortBy(formattedMetrics, [
        "serviceName",
        "serviceVersion",
        "name",
      ]);
    },
    onFilterChanged(filter) {
      this.filter.queryString = filter.queryString;
      this.fetchMetrics();
    },
    async fetchMetrics() {
      const url = `${(await Config.get()).SERVER_URL}/analytics/metrics${
        this.filter.queryString ? "?" + this.filter.queryString : ""
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

#metrics-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(25rem, 1fr));
  gap: 1rem;
}

header kbd {
  font-size: 0.7em;
}
</style>
