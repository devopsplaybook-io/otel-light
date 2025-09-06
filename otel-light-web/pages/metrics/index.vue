<template>
  <div id="metrics-page">
    <SearchOptions @filterChanged="onFilterChanged" type="metrics" />
    <div v-if="!loading" id="metrics-list">
      <article
        v-for="metric of metricsNames"
        :key="metric.serviceName + metric.name"
      >
        <header>
          <div class="metric-header">
            <div class="metric-title">
              <kbd>{{ metric.serviceName }}</kbd>
              {{ metric.name }}
            </div>
            <input
              type="checkbox"
              :checked="metric.autoLoad"
              @change="toggleMetricAutoLoad(metric, $event)"
              role="switch"
            />
          </div>
        </header>

        <div class="metric-manual-load" v-if="!metric.load">
          <i class="bi bi-download" @click="loadMetric(metric)"></i>
        </div>
        <LazyMetricDataGauge
          v-else-if="metric.type == 'gauge'"
          :serviceName="metric.serviceName"
          :name="metric.name"
          :filter="filter"
          hydrate-on-visible
        />
        <LazyMetricDataHistogram
          v-else-if="metric.type == 'histogram'"
          :serviceName="metric.serviceName"
          :name="metric.name"
          :filter="filter"
          hydrate-on-visible
        />
        <LazyMetricDataSum
          v-else-if="metric.type == 'sum'"
          :serviceName="metric.serviceName"
          :name="metric.name"
          :filter="filter"
          hydrate-on-visible
        />
      </article>
    </div>
  </div>
</template>

<script>
import axios from "axios";
import SearchOptions from "~/components/SearchOptions.vue";
import { UtilsDecompressJson } from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { PreferencesService } from "~~/services/PreferencesService";

export default {
  components: { SearchOptions },
  data() {
    return {
      metricsNames: [],
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
    this.fetchMetricsNames();
  },
  methods: {
    onFilterChanged(filter) {
      this.filter.queryString = filter.queryString;
      this.fetchMetricsNames();
    },
    async fetchMetricsNames() {
      const fetchTime = new Date();
      this.fetchTime = fetchTime;
      this.loading = true;
      const url = `${(await Config.get()).SERVER_URL}/analytics/metrics/names${
        this.filter.queryString ? "?" + this.filter.queryString : ""
      }`;
      axios
        .get(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          if (fetchTime < this.fetchTime) {
            return;
          }
          const metrics = await UtilsDecompressJson(response.data.metricsNames);
          for (const metric of metrics) {
            metric.autoLoad = PreferencesService.getMetricAutoLoad(
              this.getMetricKey(metric)
            );
            metric.load = metric.autoLoad;
          }
          this.metricsNames = metrics.sort((a, b) => {
            if (a.autoLoad && !b.autoLoad) return -1;
            if (!a.autoLoad && b.autoLoad) return 1;
            const serviceCompare = a.serviceName.localeCompare(b.serviceName);
            if (serviceCompare !== 0) return serviceCompare;
            return a.name.localeCompare(b.name);
          });
        })
        .catch(handleError)
        .finally(() => {
          this.loading = false;
        });
    },
    getMetricKey(metric) {
      return `${metric.serviceName}-${metric.name}`;
    },
    toggleMetricAutoLoad(metric, event) {
      const autoLoad = event.target.checked;
      PreferencesService.setMetricAutoLoad(this.getMetricKey(metric), autoLoad);
      metric.autoLoad = autoLoad;
      metric.load = autoLoad;
    },
    loadMetric(metric) {
      metric.load = true;
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

.metric-header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 1rem;
}

.metric-title kbd {
  font-size: 0.7em;
}

.metric-manual-load {
  padding-top: 2rem;
  width: 100%;
  text-align: center;
}

.metric-manual-load i {
  font-size: 3rem;
  opacity: 0.4;
  cursor: pointer;
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
.apexcharts-tooltip {
  color: #333;
}
</style>
