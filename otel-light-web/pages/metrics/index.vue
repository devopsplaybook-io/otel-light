<template>
  <div id="metrics-page">
    <SearchOptions @filterChanged="onFilterChanged" />
    <div v-if="!loading" id="metrics-list">
      <article
        v-for="metric of metrics"
        :key="metric.serviceName + metric.name"
      >
        <header>
          <kbd>{{ metric.serviceName }}</kbd>
          {{ metric.name }}
        </header>
        <MetricDataGauge v-if="metric.type == 'gauge'" :metric="metric" />
        <MetricDataHistogram
          v-if="metric.type == 'histogram'"
          :metric="metric"
        />
        <MetricDataSum v-if="metric.type == 'sum'" :metric="metric" />
      </article>
    </div>
  </div>
</template>

<script>
import axios from "axios";
import { find, sortBy } from "lodash";
import SearchOptions from "~/components/SearchOptions.vue";
import MetricDataHistogram from "~/components/MetricDataHistogram.vue";
import MetricDataSum from "~/components/MetricDataSum.vue";
import { UtilsDecompressJson } from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  components: { SearchOptions, MetricDataHistogram, MetricDataSum },
  data() {
    return {
      metrics: [],
      traceSpans: {},
      filter: {
        queryString: "",
      },
      loading: false,
      fetchTime: null,
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
    this.fetchMetrics();
  },
  methods: {
    processMetrics(metrics) {
      const formattedMetrics = [];
      metrics.forEach((metric) => {
        let metricContainer = find(formattedMetrics, {
          serviceName: metric.serviceName,
          name: metric.name,
        });

        if (!metricContainer) {
          metricContainer = {
            serviceName: metric.serviceName,
            name: metric.name,
            type: metric.type,
            data: [],
          };
          formattedMetrics.push(metricContainer);
        }
        metricContainer.data.push(metric);
      });
      return sortBy(formattedMetrics, ["serviceName", "name"]);
    },
    onFilterChanged(filter) {
      this.filter.queryString = filter.queryString;
      this.fetchMetrics();
    },
    async fetchMetrics() {
      const fetchTime = new Date();
      this.fetchTime = fetchTime;
      this.loading = true;
      const url = `${(await Config.get()).SERVER_URL}/analytics/metrics${
        this.filter.queryString ? "?" + this.filter.queryString : ""
      }`;
      axios
        .get(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          if (fetchTime < this.fetchTime) {
            return;
          }
          this.metrics = this.processMetrics(
            await UtilsDecompressJson(response.data.metrics)
          );
          if (response.data.warning) {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              type: "warning",
              text: response.data.warning,
            });
          }
        })
        .catch(handleError)
        .finally(() => {
          this.loading = false;
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

<style>
:root[data-theme="dark"] .apexcharts-xaxis text,
:root[data-theme="dark"] .apexcharts-yaxis text {
  fill: #eee !important;
}
:root[data-theme="dark"] .apexcharts-legend-text {
  color: #eee !important;
}
:root[data-theme="light"] .apexcharts-xaxis text,
:root[data-theme="light"] .apexcharts-yaxis text {
  fill: #333 !important;
}
:root[data-theme="light"] .apexcharts-legend-text {
  color: #333 !important;
}
</style>
