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
      <div v-for="log of logs" :key="log.recordId">
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
import { handleError } from "~~/services/EventBus";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";
import {
  SignalCursorMax,
  SignalDedupeById,
  SignalQueryAdd,
} from "~~/services/SignalCursors";

export default {
  components: { SearchOptions, Loading },
  data() {
    return {
      logs: [],
      hasMore: true,
      isLoadingMore: false,
      newestCursor: null,
      oldestCursor: null,
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
      this.newestCursor = null;
      this.oldestCursor = null;
      this.isLoadingMore = false;
      this.fetchLogs();
    },
    cursorOf(log) {
      return { time: log.time, id: log.recordId };
    },
    async fetchLogs() {
      if (this.isLoadingMore || !this.hasMore) return;
      this.isLoadingMore = true;
      const fetchTime = new Date();
      this.fetchTime = fetchTime;
      // Keyset pagination: send the composite cursor of the oldest log shown
      // instead of OFFSET. The first page has no cursor.
      let qs = this.filter.queryString || "";
      if (this.oldestCursor) {
        qs = SignalQueryAdd(qs, "before", this.oldestCursor.time);
        qs = SignalQueryAdd(qs, "beforeRecordId", this.oldestCursor.id);
      }
      const url = `${SERVER_URL}/analytics/logs?${qs}`;
      analyticsGet(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          if (fetchTime < this.fetchTime) {
            return;
          }
          const newLogs = await UtilsDecompressJson(response.data.logs);
          if (newLogs && newLogs.length > 0) {
            const seenIds = new Set(this.logs.map((log) => log.recordId));
            const dedupedLogs = SignalDedupeById(
              newLogs,
              (log) => log.recordId,
              seenIds,
            );
            this.logs = [...this.logs, ...dedupedLogs];
            if (this.newestCursor === null) {
              this.newestCursor = this.cursorOf(newLogs[0]);
            }
            // Update the cursor to the oldest log on this page for next fetch
            this.oldestCursor = this.cursorOf(newLogs[newLogs.length - 1]);
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
      if (!this.newestCursor) return;
      try {
        // Refresh from the newest log shown. The API returns up to PAGE_SIZE
        // records; while `hasMore` is true there are more recent records, so
        // keep fetching with an upper bound of the oldest record of the batch
        // just fetched until a partial page is returned.
        const refreshCursor = this.newestCursor;
        let upperBound = null;
        let newestCursor = refreshCursor;
        const batches = [];
        let hasMoreBatches = true;
        while (hasMoreBatches) {
          let qs = this.filter.queryString || "";
          qs = SignalQueryAdd(qs, "afterTime", refreshCursor.time);
          qs = SignalQueryAdd(qs, "afterRecordId", refreshCursor.id);
          if (upperBound) {
            qs = SignalQueryAdd(qs, "before", upperBound.time);
            qs = SignalQueryAdd(qs, "beforeRecordId", upperBound.id);
          }
          const url = `${SERVER_URL}/analytics/logs?${qs}`;
          const response = await analyticsGet(
            url,
            await AuthService.getAuthHeader(),
          );
          const batch = await UtilsDecompressJson(response.data.logs);
          if (!batch || batch.length === 0) {
            break;
          }
          batches.push(batch);
          newestCursor = SignalCursorMax(newestCursor, this.cursorOf(batch[0]));
          upperBound = this.cursorOf(batch[batch.length - 1]);
          hasMoreBatches = response.data.hasMore === true;
        }
        if (batches.length > 0) {
          const seenIds = new Set(this.logs.map((log) => log.recordId));
          const newLogs = SignalDedupeById(
            batches.flat(),
            (log) => log.recordId,
            seenIds,
          );
          this.logs = [...newLogs, ...this.logs];
          this.newestCursor = newestCursor;
        }
      } catch (err) {
        handleError(err);
      }
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
