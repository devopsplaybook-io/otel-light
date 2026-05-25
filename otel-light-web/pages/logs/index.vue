<template>
  <div id="logs-page" class="signals-page">
    <SearchOptions
      ref="searchOptions"
      @filterChanged="onFilterChanged"
      type="logs"
    />
    <div id="logs" class="signals-scroll">
      <div class="log-summary">
        <b>Service</b>
        <b>Time</b>
        <b>Severity</b>
        <b>Log</b>
      </div>
      <div v-for="log of logs" :key="log.serviceName + log.time">
        <LazyLog :log="log" hydrate-on-visible />
      </div>
      <div id="logs-sentinel" ref="sentinel"></div>
      <div class="load-status">
        <Loading v-if="isLoadingMore" size="small" />
        <span v-else-if="!hasMore && logs.length > 0" class="no-more-data"
          >No more data</span
        >
      </div>
    </div>
    <button class="fab-button" @click="goToAnalytics" title="Go to Analytics">
      <i class="bi bi-pie-chart-fill"></i>&nbsp;Stats
    </button>
  </div>
</template>

<script>
import { analyticsGet } from "~~/services/AnalyticsQueue";
import SearchOptions from "~/components/SearchOptions.vue";
import Loading from "~/components/Loading.vue";
import { UtilsDecompressJson } from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";

const PAGE_SIZE = 200;

export default {
  components: { SearchOptions, Loading },
  data() {
    return {
      logs: [],
      hasMore: true,
      isLoadingMore: false,
      newestTime: null,
      oldestTime: null,
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      logSpans: {},
      filter: {
        queryString: "",
      },
      selectedLog: null,
      fetchTime: null,
      observer: null,
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
    this.refreshIntervalValue = RefreshIntervalService.get();
  },
  mounted() {
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && this.hasMore && !this.isLoadingMore) {
          this.fetchLogs();
        }
      },
      { threshold: 0.1 },
    );
    if (this.$refs.sentinel) {
      this.observer.observe(this.$refs.sentinel);
    }
    const interval = parseInt(this.refreshIntervalValue, 10);
    if (interval > 0) {
      this.refreshIntervalId = setInterval(() => {
        this.fetchLogsRefresh();
      }, interval);
    }
  },
  beforeUnmount() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
  },
  methods: {
    onFilterChanged(filter) {
      this.filter.queryString = filter.queryString;
      this.logs = [];
      this.hasMore = true;
      this.newestTime = null;
      this.oldestTime = null;
      this.isLoadingMore = false;
      this.fetchLogs();
    },
    async fetchLogs() {
      if (this.isLoadingMore || !this.hasMore) return;
      this.isLoadingMore = true;
      const fetchTime = new Date();
      this.fetchTime = fetchTime;
      // Keyset pagination: use `before` cursor (time of last seen item) instead
      // of OFFSET. The first page has no `before`.
      let qs = this.filter.queryString || "";
      if (this.oldestTime) {
        qs = qs
          ? `${qs}&before=${this.oldestTime}`
          : `before=${this.oldestTime}`;
      }
      const url = `${SERVER_URL}/analytics/logs?${qs}`;
      analyticsGet(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          if (fetchTime < this.fetchTime) {
            return;
          }
          const newLogs = await UtilsDecompressJson(response.data.logs);
          if (newLogs && newLogs.length > 0) {
            this.logs = [...this.logs, ...newLogs];
            if (this.newestTime === null) {
              this.newestTime = newLogs[0].time;
            }
            // Update cursor to the oldest item on this page for next fetch
            this.oldestTime = newLogs[newLogs.length - 1].time;
          }
          this.hasMore = response.data.hasMore === true;
        })
        .catch(handleError)
        .finally(() => {
          this.isLoadingMore = false;
        });
    },
    goToAnalytics() {
      this.$router.push({ path: "/logs/stats", query: this.$route.query });
    },
    async fetchLogsRefresh() {
      if (!this.newestTime) return;
      const qs = this.filter.queryString
        ? `${this.filter.queryString}&afterTime=${this.newestTime}`
        : `afterTime=${this.newestTime}`;
      const url = `${SERVER_URL}/analytics/logs?${qs}`;
      analyticsGet(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          const newLogs = await UtilsDecompressJson(response.data.logs);
          if (newLogs && newLogs.length > 0) {
            this.logs = [...newLogs, ...this.logs];
            this.newestTime = newLogs[0].time;
          }
        })
        .catch(handleError);
    },
  },
};
</script>

<style scoped>
.log-expanded {
  background-color: #dfe3eb22;
}
.log-span-expanded {
  background-color: #dfe3eb11;
}

#logs-sentinel {
  height: 1px;
}
</style>
