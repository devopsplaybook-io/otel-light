<template>
  <div id="metrics-page">
    <SearchOptions @filterChanged="onFilterChanged" type="metrics" />
    <div id="metrics-list">
      <article
        v-for="metric of metricsNames"
        :key="metric.serviceName + metric.name + refreshCounter"
      >
        <header>
          <div class="metric-header">
            <h6 class="metric-name" :title="metric.name">
              {{ metric.name }}
            </h6>
            <span class="metric-service-name">{{ metric.serviceName }}</span>
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
import { analyticsGet } from "~~/services/AnalyticsQueue";
import SearchOptions from "~/components/SearchOptions.vue";
import { UtilsDecompressJson } from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { PreferencesService } from "~~/services/PreferencesService";

export default {
  components: { SearchOptions },
  data() {
    return {
      metricsNames: [],
      refreshCounter: 0,
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
      this.filter = { ...filter };
      this.refreshCounter++;
      this.fetchMetricsNames();
    },
    async fetchMetricsNames() {
      const fetchTime = new Date();
      this.fetchTime = fetchTime;
      this.loading = true;
      const url = `${SERVER_URL}/analytics/metrics/names${
        this.filter.queryString ? "?" + this.filter.queryString : ""
      }`;
      analyticsGet(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          if (fetchTime < this.fetchTime) {
            return;
          }
          const metrics = await UtilsDecompressJson(response.data.metricsNames);
          for (const metric of metrics) {
            metric.autoLoad = PreferencesService.getMetricAutoLoad(
              this.getMetricKey(metric),
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
}

.metric-service-name {
  font-size: 0.6em;
  align-self: flex-start;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.6;
  grid-column: 1;
  grid-row: 2;
}

.metric-name {
  font-size: 0.9em;
  word-break: break-all;
  line-height: 1.3;
  padding-bottom: 0;
  margin-bottom: 0;
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
