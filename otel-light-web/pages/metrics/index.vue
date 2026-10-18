<template>
  <div id="metrics-page">
    <SearchOptions @filterChanged="onFilterChanged" type="metrics" />
    <div id="metrics-toolbar">
      <select
        v-model="sortKey"
        aria-label="Sort metric cards"
        class="metrics-sort-select"
      >
        <option value="service">Sort by service</option>
        <option value="name">Sort by metric name</option>
        <option value="lastUpdate">Sort by last update</option>
      </select>
      <button
        type="button"
        class="metrics-sort-direction"
        @click="toggleSortOrder"
        :title="sortOrder === 'asc' ? 'Ascending order' : 'Descending order'"
      >
        <i
          class="bi"
          :class="sortOrder === 'asc' ? 'bi-sort-down-alt' : 'bi-sort-up-alt'"
        ></i>
      </button>
    </div>
    <div id="metrics-status">
      <Loading v-if="loading && !loadedOnce" size="small" />
      <span v-else-if="statusText">{{ statusText }}</span>
    </div>
    <div id="metrics-list">
      <article
        v-for="metric of visibleMetrics"
        :key="metric.serviceName + metric.name + refreshCounter"
      >
        <header>
          <div class="metric-header">
            <h6 class="metric-name" :title="metric.name">
              {{ metric.name }}
            </h6>
            <input
              type="checkbox"
              :checked="metric.autoLoad"
              @change="toggleMetricAutoLoad(metric, $event)"
              role="switch"
            />
            <span class="metric-service-name">{{ metric.serviceName }}</span>
          </div>
          <div
            v-if="latestInfo[getMetricKey(metric)]"
            class="metric-latest"
            :title="latestInfo[getMetricKey(metric)].seriesName"
          >
            {{ latestText(latestInfo[getMetricKey(metric)]) }}
          </div>
          <div v-else class="metric-latest metric-latest-unknown">
            last update {{ relativeTime(metric.lastSeen) }}
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
          @latest="onMetricLatest(getMetricKey(metric), $event)"
          @loadState="onMetricLoadState(getMetricKey(metric), $event)"
          hydrate-on-visible
        />
        <LazyMetricDataHistogram
          v-else-if="metric.type == 'histogram'"
          :serviceName="metric.serviceName"
          :name="metric.name"
          :filter="filter"
          @latest="onMetricLatest(getMetricKey(metric), $event)"
          @loadState="onMetricLoadState(getMetricKey(metric), $event)"
          hydrate-on-visible
        />
        <LazyMetricDataSum
          v-else-if="metric.type == 'sum'"
          :serviceName="metric.serviceName"
          :name="metric.name"
          :filter="filter"
          @latest="onMetricLatest(getMetricKey(metric), $event)"
          @loadState="onMetricLoadState(getMetricKey(metric), $event)"
          hydrate-on-visible
        />
      </article>
      <div
        v-if="loadedOnce && !loading && metricsNames.length === 0"
        class="empty-state"
      >
        No metrics found for this search
        <div class="empty-state-hint">
          No data matched the current filters — try widening the time window or
          clearing filters.
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { analyticsGet } from "~~/services/AnalyticsQueue";
import SearchOptions from "~/components/SearchOptions.vue";
import Loading from "~/components/Loading.vue";
import {
  MetricsCardsFormatValue,
  MetricsCardsSortNames,
} from "~~/services/MetricsCards";
import { UtilsDecompressJson, UtilsRelativeTime } from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { handleError } from "~~/services/EventBus";
import { PreferencesService } from "~~/services/PreferencesService";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";

export default {
  components: { SearchOptions, Loading },
  data() {
    return {
      metricsNames: [],
      refreshCounter: 0,
      traceSpans: {},
      filter: {
        queryString: "",
      },
      loading: false,
      loadedOnce: false,
      fetchTime: null,
      sortKey: "service",
      sortOrder: "asc",
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      lastNamesSnapshot: null,
      manuallyLoaded: new Set(),
      latestInfo: {},
      cardStates: {},
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/settings/profile" });
    }
    this.refreshIntervalValue = RefreshIntervalService.get();
    this.fetchMetricsNames();
  },
  mounted() {
    const interval = parseInt(this.refreshIntervalValue, 10);
    if (interval > 0) {
      this.refreshIntervalId = setInterval(() => {
        this.fetchMetricsNames();
      }, interval);
    }
  },
  beforeUnmount() {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
  },
  computed: {
    visibleMetrics() {
      return MetricsCardsSortNames(
        this.metricsNames,
        this.sortKey,
        this.sortOrder,
      );
    },
    statusText() {
      if (this.loading && !this.loadedOnce) {
        return "";
      }
      let toLoad = 0;
      let loaded = 0;
      let errors = 0;
      let inFlight = 0;
      for (const metric of this.visibleMetrics) {
        const key = this.getMetricKey(metric);
        if (metric.load) {
          toLoad++;
        }
        const state = this.cardStates[key];
        if (state === "loaded") {
          loaded++;
        } else if (state === "error") {
          errors++;
        } else if (state === "loading") {
          inFlight++;
        }
      }
      const done = loaded + errors;
      const errorSuffix =
        errors > 0 ? ` — ${errors} charts failed to load` : "";
      if (inFlight > 0) {
        return `Loading ${done} of ${toLoad} metric charts…`;
      }
      if (toLoad === 0) {
        return "";
      }
      if (done < toLoad) {
        return `${done} of ${toLoad} charts loaded — scroll to load more${errorSuffix}`;
      }
      return `${toLoad} metric charts${errorSuffix}`;
    },
  },
  methods: {
    MetricsCardsFormatValue,
    UtilsRelativeTime,
    latestText(info) {
      const unit = info.unit ? ` ${info.unit}` : "";
      const counted = info.isHistogramCount ? " observations" : "";
      return `${MetricsCardsFormatValue(info.value)}${unit}${counted} · last update ${this.UtilsRelativeTime(new Date(info.timeUnixNano / 1e6).toISOString())}`;
    },
    relativeTime(lastSeenNs) {
      const ms = Number(lastSeenNs) / 1e6;
      if (!Number.isFinite(ms)) {
        return "";
      }
      return this.UtilsRelativeTime(new Date(ms).toISOString());
    },
    toggleSortOrder() {
      this.sortOrder = this.sortOrder === "asc" ? "desc" : "asc";
    },
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
            const key = this.getMetricKey(metric);
            metric.autoLoad = PreferencesService.getMetricAutoLoad(key);
            metric.load = metric.autoLoad || this.manuallyLoaded.has(key);
          }
          this.metricsNames = metrics;
          const snapshot = metrics
            .map((metric) => `${metric.serviceName}|${metric.name}|${metric.lastSeen}`)
            .join(",");
          if (snapshot !== this.lastNamesSnapshot) {
            this.lastNamesSnapshot = snapshot;
            this.refreshCounter++;
          }
        })
        .catch(handleError)
        .finally(() => {
          this.loading = false;
          this.loadedOnce = true;
        });
    },
    getMetricKey(metric) {
      return `${metric.serviceName}-${metric.name}`;
    },
    toggleMetricAutoLoad(metric, event) {
      const autoLoad = event.target.checked;
      const key = this.getMetricKey(metric);
      PreferencesService.setMetricAutoLoad(key, autoLoad);
      metric.autoLoad = autoLoad;
      metric.load = autoLoad;
      if (autoLoad) {
        this.manuallyLoaded.add(key);
      } else {
        this.manuallyLoaded.delete(key);
        delete this.cardStates[key];
        delete this.latestInfo[key];
      }
    },
    loadMetric(metric) {
      metric.load = true;
      this.manuallyLoaded.add(this.getMetricKey(metric));
    },
    onMetricLatest(key, info) {
      this.latestInfo = { ...this.latestInfo, [key]: info };
    },
    onMetricLoadState(key, state) {
      this.cardStates = { ...this.cardStates, [key]: state };
    },
  },
};
</script>

<style scoped>
#metrics-page {
  display: grid;
  grid-template-rows: auto auto auto 1fr;
  height: 100%;
}

#metrics-toolbar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding-bottom: 0.5rem;
}

.metrics-sort-select {
  width: auto;
  flex-shrink: 0;
}

.metrics-sort-direction {
  flex-shrink: 0;
  padding: 0.25rem 0.6rem;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1.2;
}

#metrics-status {
  min-height: 1.6rem;
  font-size: 0.8rem;
  opacity: 0.7;
  padding-bottom: 0.5rem;
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

.metric-latest {
  font-size: 0.75em;
  opacity: 0.75;
  margin-top: 0.2rem;
}

.metric-latest-unknown {
  opacity: 0.45;
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
