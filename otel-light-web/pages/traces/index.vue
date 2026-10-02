<template>
  <div id="traces-page" class="signals-page signals-page-with-tabs">
    <TabNavigation :tabs="tracesTabs" />
    <SearchOptions
      ref="searchOptions"
      @filterChanged="onFilterChanged"
      type="traces"
    />
    <div id="traces" class="signals-scroll">
      <div class="trace-summary">
        <b @click="sortBy('service')" :class="headerClass('service')"
          >Service</b
        >
        <b @click="sortBy('name')" :class="headerClass('name')">Name</b>
        <b @click="sortBy('time')" :class="headerClass('time')">Time</b>
        <b @click="sortBy('duration')" :class="headerClass('duration')"
          >Duration</b
        >
        <b @click="sortBy('traceId')" :class="headerClass('traceId')">ID</b>
        <b @click="sortBy('nbErrors')" :class="headerClass('nbErrors')"
          >Errors</b
        >
        <b @click="sortBy('spanCount')" :class="headerClass('spanCount')"
          >Spans</b
        >
      </div>
      <div v-for="trace of sortedTraces" :key="trace.traceId">
        <LazyTrace
          @click="toggleTrace(trace.traceId)"
          style="cursor: pointer"
          :trace="trace"
          :class="traceSpans[trace.traceId] ? 'trace-expanded' : ''"
          hydrate-on-visible
        />
        <LazyTraceSpan
          v-if="traceSpans[trace.traceId]"
          :trace="trace"
          :traceSpans="traceSpans[trace.traceId]"
          :traceLogs="traceLogs[trace.traceId]"
          :class="traceSpans[trace.traceId] ? 'trace-span-expanded' : ''"
          hydrate-on-visible
        />
      </div>
      <div id="traces-sentinel" ref="sentinel"></div>
      <div class="load-status">
        <Loading v-if="isLoadingMore" size="small" />
        <span v-else-if="!hasMore && traces.length > 0" class="no-more-data"
          >No more data</span
        >
      </div>
    </div>
  </div>
</template>

<script>
import { analyticsGet } from "~~/services/AnalyticsQueue";
import SearchOptions from "~/components/SearchOptions.vue";
import Loading from "~/components/Loading.vue";
import { TracesTabs } from "~~/services/TracesTabs";
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
      tracesTabs: TracesTabs,
      traces: [],
      hasMore: true,
      isLoadingMore: false,
      newestCursor: null,
      oldestCursor: null,
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      traceSpans: {},
      traceLogs: {},
      filter: {
        queryString: "",
      },
      sortKey: "time",
      sortOrder: "desc",
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
          this.fetchTraces();
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
        this.fetchTracesRefresh();
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
  computed: {
    sortedTraces() {
      if (!this.traces) return [];
      const tracesCopy = [...this.traces];
      const keyMap = {
        service: "serviceName",
        name: "name",
        time: "startTime",
        duration: "duration",
        traceId: "traceId",
        nbErrors: "nbErrors",
        spanCount: "spanCount",
      };
      const key = keyMap[this.sortKey] || this.sortKey;
      const order = this.sortOrder;
      return tracesCopy.sort((a, b) => {
        let aVal = a[key];
        let bVal = b[key];
        // Handle undefined/null values
        aVal = aVal === undefined || aVal === null ? "" : aVal;
        bVal = bVal === undefined || bVal === null ? "" : bVal;
        if (typeof aVal === "string" && typeof bVal === "string") {
          return order === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }
        return order === "asc" ? aVal - bVal : bVal - aVal;
      });
    },
  },
  methods: {
    onFilterChanged(filter) {
      this.filter.queryString = filter.queryString;
      this.traces = [];
      this.hasMore = true;
      this.newestCursor = null;
      this.oldestCursor = null;
      this.isLoadingMore = false;
      this.fetchTraces();
    },
    async getTraceSpans(traceId) {
      return await analyticsGet(
        `${SERVER_URL}/analytics/traces/${traceId}/spans`,
        await AuthService.getAuthHeader(),
      ).then((response) => {
        return response.data.spans;
      });
    },
    async getTraceLogs(traceId) {
      return await analyticsGet(
        `${SERVER_URL}/analytics/traces/${traceId}/logs`,
        await AuthService.getAuthHeader(),
      ).then((response) => {
        return response.data.logs;
      });
    },
    async toggleTrace(traceId) {
      if (this.traceSpans[traceId]) {
        delete this.traceSpans[traceId];
        delete this.traceLogs[traceId];
      } else {
        if (!this.traceSpans[traceId]) {
          this.traceSpans[traceId] = await this.getTraceSpans(traceId);
          this.traceLogs[traceId] = await this.getTraceLogs(traceId);
        }
      }
    },
    async fetchTraces() {
      if (this.isLoadingMore || !this.hasMore) return;
      this.isLoadingMore = true;
      const fetchTime = new Date();
      this.fetchTime = fetchTime;
      // Keyset pagination: send the composite cursor of the oldest trace shown
      // instead of OFFSET. The first page has no cursor.
      let qs = this.filter.queryString || "";
      if (this.oldestCursor) {
        qs = SignalQueryAdd(qs, "before", this.oldestCursor.time);
        qs = SignalQueryAdd(qs, "beforeTraceId", this.oldestCursor.id);
      }
      const url = `${SERVER_URL}/analytics/traces?${qs}`;
      analyticsGet(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          if (fetchTime < this.fetchTime) {
            return;
          }
          const newTraces = await UtilsDecompressJson(response.data.traces);
          if (newTraces && newTraces.length > 0) {
            for (const trace of newTraces) {
              trace.duration = trace.endTime - trace.startTime;
            }
            const seenIds = new Set(this.traces.map((trace) => trace.traceId));
            const dedupedTraces = SignalDedupeById(
              newTraces,
              (trace) => trace.traceId,
              seenIds,
            );
            this.traces = [...this.traces, ...dedupedTraces];
            if (this.newestCursor === null) {
              this.newestCursor = this.cursorOf(newTraces[0]);
            }
            // Update the cursor to the oldest trace on this page for next fetch
            this.oldestCursor = this.cursorOf(newTraces[newTraces.length - 1]);
          }
          this.hasMore = response.data.hasMore === true;
        })
        .catch(handleError)
        .finally(() => {
          this.isLoadingMore = false;
        });
    },
    cursorOf(trace) {
      return { time: trace.startTime, id: trace.traceId };
    },
    async fetchTracesRefresh() {
      if (!this.newestCursor) return;
      try {
        // Refresh from the newest trace shown. The API returns up to PAGE_SIZE
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
          qs = SignalQueryAdd(qs, "afterTraceId", refreshCursor.id);
          if (upperBound) {
            qs = SignalQueryAdd(qs, "before", upperBound.time);
            qs = SignalQueryAdd(qs, "beforeTraceId", upperBound.id);
          }
          const url = `${SERVER_URL}/analytics/traces?${qs}`;
          const response = await analyticsGet(
            url,
            await AuthService.getAuthHeader(),
          );
          const batch = await UtilsDecompressJson(response.data.traces);
          if (!batch || batch.length === 0) {
            break;
          }
          for (const trace of batch) {
            trace.duration = trace.endTime - trace.startTime;
          }
          batches.push(batch);
          newestCursor = SignalCursorMax(newestCursor, this.cursorOf(batch[0]));
          upperBound = this.cursorOf(batch[batch.length - 1]);
          hasMoreBatches = response.data.hasMore === true;
        }
        if (batches.length > 0) {
          const seenIds = new Set(this.traces.map((trace) => trace.traceId));
          const newTraces = SignalDedupeById(
            batches.flat(),
            (trace) => trace.traceId,
            seenIds,
          );
          this.traces = [...newTraces, ...this.traces];
          this.newestCursor = newestCursor;
        }
      } catch (err) {
        handleError(err);
      }
    },
    sortBy(key) {
      if (this.sortKey === key) {
        this.sortOrder = this.sortOrder === "asc" ? "desc" : "asc";
      } else {
        this.sortKey = key;
        this.sortOrder = "asc";
      }
    },
    headerClass(key) {
      return {
        sortable: true,
        sorted: this.sortKey === key,
        asc: this.sortKey === key && this.sortOrder === "asc",
        desc: this.sortKey === key && this.sortOrder === "desc",
      };
    },
  },
};
</script>

<style></style>

<style scoped>
.trace-expanded {
  background-color: #dfe3eb22;
}
.trace-span-expanded {
  background-color: #dfe3eb11;
}

#traces-sentinel {
  height: 1px;
}
</style>
