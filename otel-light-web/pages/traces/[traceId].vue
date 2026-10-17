<template>
  <div id="traces-page" class="signals-page signals-page-with-tabs">
    <TabNavigation :tabs="tracesTabs" />
    <div id="trace-detail" class="signals-scroll">
      <Loading v-if="isLoading" />
      <div v-else-if="!trace" class="empty-state">
        Trace not found
        <div class="empty-state-hint">
          The trace may have been removed by data retention or the link is
          invalid.
        </div>
      </div>
      <template v-else>
        <div class="trace-detail-header">
          <div class="trace-detail-title">
            <b>{{ trace.name }}</b>
            <span
              >{{ trace.serviceName
              }}{{ trace.serviceVersion ? ":" + trace.serviceVersion : "" }}</span
            >
            <span>{{ new Date(trace.startTime / 1_000_000).toLocaleString() }}</span>
            <span>{{ durationText }}</span>
            <span>{{ trace.nbErrors }} error{{ trace.nbErrors === 1 ? "" : "s" }}</span>
            <span
              >{{ trace.spanCount }} span{{ trace.spanCount === 1 ? "" : "s" }}</span
            >
          </div>
          <div class="trace-detail-actions">
            <button @click="copyLink" title="Copy link to this trace">
              <i class="bi bi-link-45deg"></i>&nbsp;Copy link
            </button>
            <button @click="copyJson" title="Copy trace as JSON">
              <i class="bi bi-clipboard"></i>&nbsp;Copy JSON
            </button>
            <button @click="downloadJson" title="Download trace as JSON">
              <i class="bi bi-download"></i>&nbsp;Download JSON
            </button>
          </div>
        </div>
        <Trace :trace="trace" />
        <TraceSpan
          v-if="traceSpans.length > 0"
          :trace="trace"
          :traceSpans="traceSpans"
          :traceLogs="traceLogs"
          class="trace-detail-spans"
        />
      </template>
    </div>
  </div>
</template>

<script>
import { analyticsGet } from "~~/services/AnalyticsQueue";
import TabNavigation from "~/components/TabNavigation.vue";
import Loading from "~/components/Loading.vue";
import Trace from "~/components/Trace.vue";
import TraceSpan from "~/components/TraceSpan.vue";
import { TracesTabs } from "~~/services/TracesTabs";
import { UtilsDecompressJson, getDurationText } from "~/services/Utils";
import { ExportTraceJson, ExportDownloadFile } from "~~/services/ExportService";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  components: { TabNavigation, Loading, Trace, TraceSpan },
  data() {
    return {
      tracesTabs: TracesTabs,
      trace: null,
      traceSpans: [],
      traceLogs: [],
      isLoading: true,
    };
  },
  computed: {
    traceId() {
      return this.$route.params.traceId;
    },
    durationText() {
      return this.trace
        ? getDurationText(this.trace.endTime - this.trace.startTime)
        : "";
    },
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/settings/profile" });
      return;
    }
    this.fetchTrace();
  },
  methods: {
    async fetchTrace() {
      this.isLoading = true;
      try {
        const authHeader = await AuthService.getAuthHeader();
        const [summaryResponse, spansResponse, logsResponse] = await Promise.all([
          analyticsGet(
            `${SERVER_URL}/analytics/traces?traceId=${this.traceId}`,
            authHeader
          ),
          analyticsGet(
            `${SERVER_URL}/analytics/traces/${this.traceId}/spans`,
            authHeader
          ),
          analyticsGet(
            `${SERVER_URL}/analytics/traces/${this.traceId}/logs`,
            authHeader
          ),
        ]);
        const traces = await UtilsDecompressJson(summaryResponse.data.traces);
        this.trace = traces && traces.length === 1 ? traces[0] : null;
        this.traceSpans = spansResponse.data.spans || [];
        this.traceLogs = logsResponse.data.logs || [];
      } catch (err) {
        handleError(err);
      } finally {
        this.isLoading = false;
      }
    },
    async copyLink() {
      try {
        await navigator.clipboard.writeText(window.location.href);
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: "Link copied",
        });
      } catch (err) {
        handleError(err);
      }
    },
    async copyJson() {
      try {
        await navigator.clipboard.writeText(this.traceJson());
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: "Trace JSON copied",
        });
      } catch (err) {
        handleError(err);
      }
    },
    downloadJson() {
      ExportDownloadFile(
        `trace-${this.traceId}.json`,
        this.traceJson(),
        "application/json"
      );
    },
    traceJson() {
      return ExportTraceJson(this.trace, this.traceSpans, this.traceLogs);
    },
  },
};
</script>

<style scoped>
.trace-detail-header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.5rem;
  align-items: baseline;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px dashed #666666aa;
}
.trace-detail-title {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.5rem;
  align-items: baseline;
  min-width: 0;
}
.trace-detail-title span {
  color: #888;
  font-size: 0.9em;
  white-space: nowrap;
}
.trace-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.trace-detail-actions button {
  font-size: 0.85em;
  padding: 0.3em 0.8em;
}
.trace-detail-spans {
  padding: 1rem 0;
}
</style>
