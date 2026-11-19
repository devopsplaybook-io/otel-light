<template>
  <div id="traces-page" class="signals-page signals-page-with-tabs">
    <TabNavigation :tabs="tracesTabs" />
    <SearchOptions @filterChanged="onFilterChanged" type="traces" />
    <div id="traces" class="signals-scroll">
      <div v-if="error" class="aggregated-error" role="alert">
        <i class="bi bi-exclamation-triangle"></i>
        Could not load aggregated traces: {{ error }}
        <button class="secondary" type="button" @click="fetchTraces">
          Retry
        </button>
      </div>
      <div
        class="trace-group-summary trace-group-header"
        role="row"
      >
        <b role="columnheader">Service</b>
        <b role="columnheader">Name</b>
        <b
          v-for="column in sortableColumns"
          :key="column.key"
          role="columnheader"
          :aria-sort="ariaSort(column.key)"
        >
          <button
            type="button"
            class="sort-button"
            :class="{ 'sort-active': sortKey === column.key }"
            @click="sortBy(column.key)"
          >
            {{ column.label }}
            <i
              class="bi"
              :class="sortIcon(column.key)"
              aria-hidden="true"
            ></i>
          </button>
        </b>
        <b role="columnheader"></b>
      </div>
      <div v-if="loading" class="aggregated-loading" aria-busy="true">
        <div
          v-for="row in 5"
          :key="row"
          class="trace-group-summary skeleton-row"
        >
          <span v-for="cell in 8" :key="cell" class="skeleton-cell"></span>
        </div>
      </div>
      <div v-for="group in groupedTraces" :key="group.key">
        <div
          class="trace-group-summary"
          style="cursor: pointer"
          @click="toggleGroup(group)"
          :class="[
            { 'trace-group-summary-errors': group.nbErrors > 0 },
            expandedGroup === group.key ? 'group-selected' : '',
          ]"
        >
          <span>{{ group.serviceName }}:{{ group.serviceVersion }}</span>
          <span>{{ group.name }}</span>
          <span>{{ group.traceCount }}</span>
          <span>
            <button
              v-if="group.nbErrors > 0"
              type="button"
              class="error-badge"
              :title="`Show the ${group.nbErrors} erroneous traces`"
              :aria-label="`Show the ${group.nbErrors} erroneous traces of ${group.name}`"
              @click.stop="openErrorsInTraces(group)"
            >
              {{ group.nbErrors }}
            </button>
            <template v-else>0</template>
          </span>
          <span>{{ formatDuration(group.avgDuration) }}</span>
          <span>{{ formatDuration(group.p90) }}</span>
          <span>{{ formatDuration(group.p95) }}</span>
          <span class="trace-group-open">
            <i
              class="bi bi-box-arrow-up-right"
              title="Open in Traces"
              @click.stop="openGroupInTraces(group)"
            ></i>
          </span>
        </div>
        <div
          v-if="expandedGroup === group.key"
          class="traces-group-expanded"
        >
          <div class="trace-summary">
            <b>Service</b>
            <b>Name</b>
            <b>Time</b>
            <b>Duration</b>
            <b>ID</b>
            <b>Errors</b>
            <b>Spans</b>
          </div>
          <div v-for="trace in group.traces" :key="trace.traceId">
            <LazyTrace
              @click="onTraceClick(trace.traceId)"
              style="cursor: pointer"
              :trace="trace"
              :class="[traceSpans[trace.traceId] ? 'trace-expanded' : '']"
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
        </div>
      </div>
      <div
        v-if="loadedOnce && !loading && !error && groupedTraces.length === 0"
        class="empty-state"
      >
        No results for this search
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
import Trace from "~/components/Trace.vue";
import TraceSpan from "~/components/TraceSpan.vue";
import { TracesTabs } from "~~/services/TracesTabs";
import { UtilsDecompressJson } from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { handleError } from "~~/services/EventBus";
import { getDurationText } from "~/services/Utils";
import {
  TraceApiLogsUrl,
  TraceApiSpansUrl,
  TraceGroupToAnalyticsParams,
  TraceGroupToTracesQuery,
} from "~~/services/TraceLinks";
import {
  TRACES_AGGREGATED_DEFAULT_SORT,
  TracesAggregatedSort,
} from "~~/services/TracesAggregated";

const AGGREGATED_REQUEST_TIMEOUT_MS = 20000;

export default {
  components: { SearchOptions, Trace, TraceSpan },
  data() {
    return {
      tracesTabs: TracesTabs,
      groups: [],
      expandedGroupTraces: {},
      traceSpans: {},
      traceLogs: {},
      filter: {
        queryString: "",
      },
      fetchTime: null,
      expandedGroup: null,
      loadingExpanded: false,
      loadedOnce: false,
      loading: true,
      error: null,
      sortKey: TRACES_AGGREGATED_DEFAULT_SORT.key,
      sortDir: TRACES_AGGREGATED_DEFAULT_SORT.dir,
      sortableColumns: [
        { key: "traceCount", label: "Traces" },
        { key: "nbErrors", label: "Errors" },
        { key: "avgDuration", label: "Avg duration" },
        { key: "p90", label: "P90" },
        { key: "p95", label: "P95" },
      ],
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/settings/profile" });
      return;
    }
    this.fetchTraces();
  },
  computed: {
    groupedTraces() {
      return TracesAggregatedSort(
        this.groups,
        this.sortKey,
        this.sortDir,
      ).map((group) => ({
        ...group,
        traces: this.expandedGroupTraces[group.key] || [],
      }));
    },
  },
  methods: {
    onFilterChanged(filter) {
      this.filter.queryString = filter.queryString;
      this.fetchTraces();
    },
    async getTraceSpans(traceId) {
      return await analyticsGet(
        TraceApiSpansUrl(SERVER_URL, traceId),
        await AuthService.getAuthHeader(),
      ).then((response) => {
        return response.data.spans;
      });
    },
    async getTraceLogs(traceId) {
      if (!AuthenticationStore().hasLogsScope) {
        return [];
      }
      return await analyticsGet(
        TraceApiLogsUrl(SERVER_URL, traceId),
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
      const fetchTime = new Date();
      this.fetchTime = fetchTime;
      this.error = null;
      this.loading = this.groups.length === 0;
      const qs = this.filter.queryString || "";
      // The summary endpoint is a single root-span GROUP BY: it stays fast
      // enough for the 24 h window without the all-spans join of
      // /analytics/traces/stats. Percentiles come from a bounded sample.
      const url = `${SERVER_URL}/analytics/traces/summary${qs ? "?" + qs : ""}`;
      const authHeader = await AuthService.getAuthHeader();
      analyticsGet(url, {
        ...authHeader,
        timeout: AGGREGATED_REQUEST_TIMEOUT_MS,
      })
        .then(async (response) => {
          if (fetchTime < this.fetchTime) {
            return;
          }
          const serverGroups = response.data.compressed
            ? await UtilsDecompressJson(response.data.groups)
            : response.data.groups;
          this.groups = (serverGroups || []).map((g) => ({
            ...g,
            key: [
              g.serviceName || "",
              g.serviceVersion || "",
              g.name || "",
            ].join("||"),
            p90: g.p90 ?? null,
            p95: g.p95 ?? null,
          }));
          this.expandedGroupTraces = {};
          this.expandedGroup = null;
        })
        .catch((err) => {
          if (fetchTime < this.fetchTime) {
            return;
          }
          this.error =
            err?.message || "The analytics request failed";
        })
        .finally(() => {
          if (fetchTime === this.fetchTime) {
            this.loading = false;
            this.loadedOnce = true;
          }
        });
    },
    formatDuration(value) {
      const ns = Number(value);
      if (value === null || value === undefined || !Number.isFinite(ns)) {
        return "—";
      }
      return getDurationText(ns);
    },
    sortBy(key) {
      if (this.sortKey === key) {
        this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
        return;
      }
      this.sortKey = key;
      this.sortDir = "desc";
    },
    ariaSort(key) {
      if (this.sortKey !== key) return "none";
      return this.sortDir === "asc" ? "ascending" : "descending";
    },
    sortIcon(key) {
      if (this.sortKey !== key) return "bi-arrow-down-up sort-idle";
      return this.sortDir === "asc" ? "bi-sort-up" : "bi-sort-down";
    },
    async toggleGroup(group) {
      if (this.expandedGroup === group.key) {
        this.expandedGroup = null;
        return;
      }
      this.expandedGroup = group.key;
      if (!group || this.expandedGroupTraces[group.key]) return;
      this.loadingExpanded = true;
      const params = TraceGroupToAnalyticsParams(
        group,
        this.filter.queryString,
      );
      const url = `${SERVER_URL}/analytics/traces?${params.toString()}`;
      analyticsGet(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          const traces = await UtilsDecompressJson(response.data.traces);
          for (const t of traces) {
            t.duration = t.endTime - t.startTime;
          }
          traces.sort(
            (a, b) => b.endTime - b.startTime - (a.endTime - a.startTime),
          );
          this.expandedGroupTraces = {
            ...this.expandedGroupTraces,
            [group.key]: traces,
          };
        })
        .catch(handleError)
        .finally(() => {
          this.loadingExpanded = false;
        });
    },
    onTraceClick(traceId) {
      this.toggleTrace(traceId);
    },
    openGroupInTraces(group) {
      this.$router.push({
        path: "/traces",
        query: TraceGroupToTracesQuery(group, this.$route.query),
      });
    },
    openErrorsInTraces(group) {
      this.$router.push({
        path: "/traces",
        query: {
          ...TraceGroupToTracesQuery(group, this.$route.query),
          errorsOnly: "true",
        },
      });
    },
  },
};
</script>

<style scoped>
.trace-group-summary,
.trace-span-expanded {
  min-width: 1200px;
}
.trace-group-summary {
  display: grid;
  grid-template-columns: 2fr 2fr 1fr 1fr 2fr 2fr 2fr auto;
  gap: 1rem;
  width: 100%;
}
.trace-group-summary span,
.trace-group-summary b {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.trace-group-summary b {
  user-select: none;
}
.sort-button {
  width: auto;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: bold;
  text-align: left;
  cursor: pointer;
}
.sort-button i {
  margin-left: 0.25rem;
  opacity: 0.5;
}
.sort-button.sort-active i {
  opacity: 1;
}
.sort-button i.sort-idle {
  opacity: 0.2;
}
.trace-group-summary-errors {
  background-color: #ff950033;
}
.error-badge {
  width: auto;
  margin: 0;
  padding: 0.05rem 0.45rem;
  border-radius: 0.75rem;
  font-size: 0.8rem;
  line-height: 1.3;
  background-color: #c62828;
  border-color: #c62828;
  color: #fff;
}
.trace-group-open i {
  cursor: pointer;
  opacity: 0.6;
}
.trace-group-open i:hover {
  opacity: 1;
}
.trace-span-expanded {
  background-color: #dfe3eb11;
}
.group-selected {
  background-color: #dfe3eb11;
}
.traces-group-expanded {
  padding: 1rem;
  background-color: #dfe3eb11;
}
.trace-expanded {
  background-color: #dfe3eb22;
}
.trace-span-expanded {
  background-color: #dfe3eb11;
}
.aggregated-error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding: 0.6rem 0.8rem;
  border-radius: 0.35rem;
  background-color: #c6282811;
  border: 1px solid #c6282855;
}
.aggregated-error button {
  width: auto;
  margin: 0;
  padding: 0.2rem 0.7rem;
  font-size: 0.8rem;
}
.aggregated-loading {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.skeleton-row {
  align-items: center;
}
.skeleton-cell {
  display: block;
  height: 1rem;
  border-radius: 0.2rem;
  background-color: currentColor;
  opacity: 0.1;
  animation: skeleton-pulse 1.2s ease-in-out infinite;
}
@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 0.06;
  }
  50% {
    opacity: 0.18;
  }
}
</style>
