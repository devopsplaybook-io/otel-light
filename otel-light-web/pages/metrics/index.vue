<template>
  <div id="metrics-page">
    <SearchOptions @filterChanged="onFilterChanged" type="metrics" />
    <div id="metrics-status">
      <Loading v-if="loading && !loadedOnce" size="small" />
      <span v-else-if="statusText">{{ statusText }}</span>
    </div>
    <div id="metrics-list">
      <article
        v-for="metric of visibleMetrics"
        :key="cardKey(metric)"
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
            v-if="latestInfo[cardKey(metric)]"
            class="metric-latest"
            :title="latestInfo[cardKey(metric)].seriesName"
          >
            {{ latestText(latestInfo[cardKey(metric)]) }}
          </div>
          <div v-else class="metric-latest metric-latest-unknown">
            last update {{ relativeTime(metric.lastSeen) }}
          </div>
          <div
            v-if="metric.load && cardStates[cardKey(metric)]"
            class="metric-load-state"
          >
            <template v-if="cardStates[cardKey(metric)] === 'queued'">
              Queued…
            </template>
            <template v-else-if="cardStates[cardKey(metric)] === 'loading'">
              Loading…
            </template>
            <template v-else-if="cardStates[cardKey(metric)] === 'error'">
              Failed to load
              <button
                type="button"
                class="metric-state-action"
                @click="retryMetric(metric)"
              >
                Retry
              </button>
            </template>
            <template v-else-if="isCardStale(metric)">
              Newer data available
              <button
                type="button"
                class="metric-state-action"
                @click="retryMetric(metric)"
              >
                Refresh
              </button>
            </template>
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
          :reloadToken="reloadTokens[cardKey(metric)] || 0"
          :priority="!!priorityKeys[cardKey(metric)]"
          @latest="onMetricLatest(cardKey(metric), $event)"
          @loadState="onMetricLoadState(cardKey(metric), $event)"
          hydrate-on-visible
        />
        <LazyMetricDataHistogram
          v-else-if="metric.type == 'histogram'"
          :serviceName="metric.serviceName"
          :name="metric.name"
          :filter="filter"
          :reloadToken="reloadTokens[cardKey(metric)] || 0"
          :priority="!!priorityKeys[cardKey(metric)]"
          @latest="onMetricLatest(cardKey(metric), $event)"
          @loadState="onMetricLoadState(cardKey(metric), $event)"
          hydrate-on-visible
        />
        <LazyMetricDataSum
          v-else-if="metric.type == 'sum'"
          :serviceName="metric.serviceName"
          :name="metric.name"
          :filter="filter"
          :reloadToken="reloadTokens[cardKey(metric)] || 0"
          :priority="!!priorityKeys[cardKey(metric)]"
          @latest="onMetricLatest(cardKey(metric), $event)"
          @loadState="onMetricLoadState(cardKey(metric), $event)"
          hydrate-on-visible
        />
      </article>
      <div
        v-if="loadedOnce && !loading && metricsNames.length === 0"
        class="empty-state"
      >
        <FirstRunGuidance v-if="showFirstRunGuidance" />
        <template v-else>
          No metrics found for this search
          <div class="empty-state-hint">
            No data matched the current filters — try widening the time window
            or clearing filters.
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import { analyticsGet } from "~~/services/AnalyticsQueue";
import SearchOptions from "~/components/SearchOptions.vue";
import Loading from "~/components/Loading.vue";
import FirstRunGuidance from "~/components/FirstRunGuidance.vue";
import { ServicesStore } from "~/stores/ServicesStore";
import { MetricsCardsFormatValue, MetricsCardsIsStale, MetricsCardsLastSeenAdvanced, MetricsCardsSortAutoLoadLast } from "~~/services/MetricsCards";
import { UtilsDecompressJson, UtilsRelativeTime } from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { handleError } from "~~/services/EventBus";
import { PreferencesService } from "~~/services/PreferencesService";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";

export default {
  components: { SearchOptions, Loading, FirstRunGuidance },
  data() {
    return {
      metricsNames: [],
      traceSpans: {},
      filter: {
        queryString: "",
      },
      loading: false,
      loadedOnce: false,
      fetchTime: null,
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      refreshPending: false,
      visibilityHandler: null,
      manuallyLoaded: new Set(),
      latestInfo: {},
      cardStates: {},
      reloadTokens: {},
      priorityKeys: {},
      lastSeenByKey: {},
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
        // Pause the auto-refresh while the tab is hidden; the names list is
        // refreshed once when it becomes visible again.
        if (document.hidden) {
          this.refreshPending = true;
          return;
        }
        this.fetchMetricsNames();
      }, interval);
    }
    this.visibilityHandler = () => {
      if (document.hidden || !this.refreshPending) {
        return;
      }
      this.refreshPending = false;
      this.fetchMetricsNames();
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  },
  beforeUnmount() {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
  },
  computed: {
    showFirstRunGuidance() {
      const servicesStore = ServicesStore();
      return (
        servicesStore.lastFetchedAt > 0 &&
        servicesStore.services.length === 0
      );
    },
    visibleMetrics() {
      return MetricsCardsSortAutoLoadLast(this.metricsNames);
    },
    statusText() {
      if (this.loading && !this.loadedOnce) {
        return "";
      }
      let toLoad = 0;
      let loaded = 0;
      let errors = 0;
      let inFlight = 0;
      let queued = 0;
      let stale = 0;
      for (const metric of this.visibleMetrics) {
        const key = this.cardKey(metric);
        if (metric.load) {
          toLoad++;
        }
        const state = this.cardStates[key];
        if (state === "loaded") {
          loaded++;
          if (this.isCardStale(metric)) {
            stale++;
          }
        } else if (state === "error") {
          errors++;
        } else if (state === "loading") {
          inFlight++;
        } else if (state === "queued") {
          queued++;
        }
      }
      const done = loaded + errors;
      const errorSuffix =
        errors > 0 ? ` — ${errors} charts failed to load` : "";
      const staleSuffix =
        stale > 0 ? ` — ${stale} with newer data` : "";
      if (inFlight > 0 || queued > 0) {
        const queuedSuffix = queued > 0 ? ` (${queued} queued)` : "";
        return `Loading ${done} of ${toLoad} metric charts…${queuedSuffix}${errorSuffix}`;
      }
      if (toLoad === 0) {
        return "";
      }
      if (done < toLoad) {
        return `${done} of ${toLoad} charts loaded — scroll to load more${errorSuffix}${staleSuffix}`;
      }
      return `${toLoad} metric charts${errorSuffix}${staleSuffix}`;
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
    onFilterChanged(filter) {
      this.filter = { ...filter };
      this.lastSeenByKey = {};
      this.reloadTokens = {};
      this.priorityKeys = {};
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
          const nextLastSeen = {};
          const nextReloadTokens = { ...this.reloadTokens };
          for (const metric of metrics) {
            const key = this.getMetricKey(metric);
            metric.autoLoad = PreferencesService.getMetricAutoLoad(key);
            metric.load = metric.autoLoad || this.manuallyLoaded.has(key);
            // Cards are keyed by identity: the names list may contain the
            // same service+name with several types.
            const cardIdentity = this.cardKey(metric);
            const lastSeen = Number(metric.lastSeen) || 0;
            nextLastSeen[cardIdentity] = lastSeen;
            const previous = this.lastSeenByKey[cardIdentity];
            // Only charts that already rendered and whose data actually
            // advanced are reloaded; a names refresh never remounts cards.
            if (
              previous !== undefined &&
              MetricsCardsLastSeenAdvanced(previous, lastSeen) &&
              this.cardStates[cardIdentity] === "loaded"
            ) {
              nextReloadTokens[cardIdentity] =
                (nextReloadTokens[cardIdentity] || 0) + 1;
            }
          }
          this.metricsNames = metrics;
          this.lastSeenByKey = nextLastSeen;
          this.reloadTokens = nextReloadTokens;
        })
        .catch(handleError)
        .finally(() => {
          this.loading = false;
          this.loadedOnce = true;
        });
    },
    cardKey(metric) {
      return JSON.stringify([metric.serviceName, metric.name, metric.type]);
    },
    getMetricKey(metric) {
      return `${metric.serviceName}-${metric.name}`;
    },
    isCardStale(metric) {
      const key = this.cardKey(metric);
      return (
        this.cardStates[key] === "loaded" &&
        MetricsCardsIsStale(
          Number(metric.lastSeen),
          this.latestInfo[key]?.timeUnixNano,
        )
      );
    },
    retryMetric(metric) {
      const key = this.cardKey(metric);
      this.priorityKeys = { ...this.priorityKeys, [key]: true };
      this.reloadTokens = {
        ...this.reloadTokens,
        [key]: (this.reloadTokens[key] || 0) + 1,
      };
    },
    toggleMetricAutoLoad(metric, event) {
      const autoLoad = event.target.checked;
      const key = this.getMetricKey(metric);
      const cardIdentity = this.cardKey(metric);
      PreferencesService.setMetricAutoLoad(key, autoLoad);
      metric.autoLoad = autoLoad;
      metric.load = autoLoad;
      if (autoLoad) {
        this.manuallyLoaded.add(key);
      } else {
        this.manuallyLoaded.delete(key);
        delete this.cardStates[cardIdentity];
        delete this.latestInfo[cardIdentity];
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
      if (state === "loaded" || state === "error") {
        const priorityKeys = { ...this.priorityKeys };
        delete priorityKeys[key];
        this.priorityKeys = priorityKeys;
      }
    },
  },
};
</script>

<style scoped>
#metrics-page {
  display: grid;
  grid-template-rows: auto auto 1fr;
  height: 100%;
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

.metric-load-state {
  font-size: 0.7em;
  opacity: 0.7;
  margin-top: 0.15rem;
}

.metric-state-action {
  margin: 0 0 0 0.35rem;
  padding: 0.05rem 0.45rem;
  width: auto;
  font-size: 0.9em;
  line-height: 1.4;
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
