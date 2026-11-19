<template>
  <div id="page-intro">
    <article id="home-overview">
      <header>
        <h3><i class="bi bi-activity"></i> Last 24 hours</h3>
      </header>
      <section class="overview-strip">
        <NuxtLink
          v-if="hasLogsScope"
          to="/logs"
          class="overview-cell plain-link"
        >
          <span
            v-if="HomeOverviewCellIsLoading(cells.logs)"
            class="overview-value overview-skeleton"
            aria-label="Loading logs"
          ></span>
          <span v-else class="overview-value">{{
            HomeOverviewCellValueText(cells.logs)
          }}</span>
          <span class="overview-label">logs ingested</span>
          <span v-if="cells.logs.detail !== null" class="overview-sub"
            >{{ cells.logs.detail }} errors</span
          >
          <span
            v-if="cells.logs.status === 'error'"
            class="overview-error"
            :title="cells.logs.error || 'Refresh failed'"
          >
            <template v-if="cells.logs.fetchedAt !== null">{{
              HomeOverviewAsOfLabel(cells.logs.fetchedAt)
            }}</template>
            <template v-else>failed</template>
            <button
              type="button"
              class="overview-retry"
              title="Retry"
              aria-label="Retry logs"
              @click.prevent.stop="refreshLogs"
            >
              <i class="bi bi-arrow-repeat"></i>
            </button>
          </span>
        </NuxtLink>
        <NuxtLink
          v-if="hasTracesScope"
          to="/traces"
          class="overview-cell plain-link"
        >
          <span
            v-if="HomeOverviewCellIsLoading(cells.traces)"
            class="overview-value overview-skeleton"
            aria-label="Loading traces"
          ></span>
          <span v-else class="overview-value">{{
            HomeOverviewCellValueText(cells.traces)
          }}</span>
          <span class="overview-label">traces ingested</span>
          <span v-if="cells.traces.detail !== null" class="overview-sub"
            >{{ cells.traces.detail }} errors</span
          >
          <span
            v-if="cells.traces.status === 'error'"
            class="overview-error"
            :title="cells.traces.error || 'Refresh failed'"
          >
            <template v-if="cells.traces.fetchedAt !== null">{{
              HomeOverviewAsOfLabel(cells.traces.fetchedAt)
            }}</template>
            <template v-else>failed</template>
            <button
              type="button"
              class="overview-retry"
              title="Retry"
              aria-label="Retry traces"
              @click.prevent.stop="refreshTraces"
            >
              <i class="bi bi-arrow-repeat"></i>
            </button>
          </span>
        </NuxtLink>
        <NuxtLink
          v-if="hasMetricsScope"
          to="/metrics"
          class="overview-cell plain-link"
        >
          <span
            v-if="HomeOverviewCellIsLoading(cells.metrics)"
            class="overview-value overview-skeleton"
            aria-label="Loading metric series"
          ></span>
          <span v-else class="overview-value">{{
            HomeOverviewCellValueText(cells.metrics)
          }}</span>
          <span class="overview-label">metric series</span>
          <span
            v-if="cells.metrics.status === 'error'"
            class="overview-error"
            :title="cells.metrics.error || 'Refresh failed'"
          >
            <template v-if="cells.metrics.fetchedAt !== null">{{
              HomeOverviewAsOfLabel(cells.metrics.fetchedAt)
            }}</template>
            <template v-else>failed</template>
            <button
              type="button"
              class="overview-retry"
              title="Retry"
              aria-label="Retry metric series"
              @click.prevent.stop="refreshMetrics"
            >
              <i class="bi bi-arrow-repeat"></i>
            </button>
          </span>
        </NuxtLink>
        <div class="overview-cell">
          <span
            v-if="HomeOverviewCellIsLoading(cells.services)"
            class="overview-value overview-skeleton"
            aria-label="Loading services"
          ></span>
          <span v-else class="overview-value">{{
            HomeOverviewCellValueText(cells.services)
          }}</span>
          <span class="overview-label">services reporting</span>
          <span
            v-if="cells.services.status === 'error'"
            class="overview-error"
            :title="cells.services.error || 'Refresh failed'"
          >
            <template v-if="cells.services.fetchedAt !== null">{{
              HomeOverviewAsOfLabel(cells.services.fetchedAt)
            }}</template>
            <template v-else>failed</template>
            <button
              type="button"
              class="overview-retry"
              title="Retry"
              aria-label="Retry services"
              @click.prevent.stop="refreshServices"
            >
              <i class="bi bi-arrow-repeat"></i>
            </button>
          </span>
        </div>
        <div class="overview-cell overview-jobs">
          <span class="overview-label">Scheduled jobs</span>
          <div v-for="job in overviewJobs" :key="job.label" class="overview-job">
            <span class="overview-job-label">{{ job.label }}</span>
            <span class="overview-job-value">{{
              formatJobTime(job.generatedAt)
            }}</span>
          </div>
        </div>
      </section>
    </article>

    <NuxtLink to="/traces" class="plain-link">
      <article>
        <header>
          <h3><i class="bi bi-list-nested"></i> Traces</h3>
        </header>
        <section>
          <i class="bi bi-list-nested card-icon"></i>
          Traces capture the journey of a request as it travels through various
          services and components in a distributed system, helping you visualize
          and analyze end-to-end workflows and pinpoint performance bottlenecks.
        </section>
      </article>
    </NuxtLink>
    <NuxtLink to="/metrics" class="plain-link">
      <article>
        <header>
          <h3><i class="bi bi-bar-chart-line"></i> Metrics</h3>
        </header>
        <section>
          <i class="bi bi-bar-chart-line card-icon"></i>
          Metrics provide numerical data about the health and performance of
          your systems, such as request rates, error counts, and resource usage,
          enabling you to monitor trends and set up alerts for anomalies.
        </section>
      </article>
    </NuxtLink>
    <NuxtLink to="/logs" class="plain-link">
      <article>
        <header>
          <h3><i class="bi bi-card-text"></i> Logs</h3>
        </header>
        <section>
          <i class="bi bi-card-text card-icon"></i>
          Logs record discrete events and messages from your applications,
          offering detailed context for troubleshooting issues, auditing
          activity, and understanding system behavior over time.
        </section>
      </article>
    </NuxtLink>

    <article
      v-if="hasRecommendationAccess && recommendation"
      id="page-recommendation"
      class="recommendation-card"
    >
      <header>
        <h3><i class="bi bi-robot"></i> LLM Recommendation</h3>
      </header>
      <section>
        <i class="bi bi-robot card-icon"></i>
        <div v-if="recommendation.analysis" class="rec-section">
          <h4><i class="bi bi-search"></i> Analysis</h4>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="rec-content" v-html="renderMarkdown(recommendation.analysis)"></div>
        </div>
        <div v-if="recommendation.recommendations" class="rec-section">
          <h4><i class="bi bi-lightbulb"></i> Recommendations</h4>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="rec-content" v-html="renderMarkdown(recommendation.recommendations)"></div>
          <div v-if="recommendationTraceLinks.length" class="rec-links">
            <h5>Related traces</h5>
            <ul>
              <li v-for="link in recommendationTraceLinks" :key="link.key">
                <NuxtLink
                  :to="{
                    path: '/traces',
                    query: recommendationTraceQuery(link),
                  }"
                >
                  {{ link.label }}
                </NuxtLink>
                <span class="rec-link-meta">{{ link.meta }}</span>
              </li>
            </ul>
          </div>
        </div>
        <div
          v-if="!recommendation.analysis && !recommendation.recommendations"
          class="rec-section"
        >
          <em>No recommendation content available.</em>
        </div>
        <small class="rec-generated-at" v-if="recommendation.generatedAt">
          {{ formatDate(recommendation.generatedAt) }} &middot;
          {{ recommendation.periodHours }}h period </small
        ><br />
        <button
          v-if="isAdmin"
          class="rec-regenerate outline"
          type="button"
          @click="regenerateRecommendation"
          :disabled="regenerating"
        >
          <i class="bi bi-arrow-repeat"></i>
          {{ regenerating ? "Generating..." : "Re-generate" }}
        </button>
      </section>
    </article>
  </div>
</template>

<script>
import axios from "axios";
import { SERVER_URL } from "~~/services/Config";
import { AuthService } from "~~/services/AuthService";
import { analyticsGet } from "~~/services/AnalyticsQueue";
import { renderMarkdown } from "~~/services/Markdown";
import { UtilsDecompressJson, UtilsRelativeTime } from "~~/services/Utils";
import {
  HomeOverviewAsOfLabel,
  HomeOverviewCellFailure,
  HomeOverviewCellIsLoading,
  HomeOverviewCellSuccess,
  HomeOverviewCellValueText,
  HomeOverviewCellsInitial,
  HomeOverviewCellsLoad,
  HomeOverviewCellsSave,
  HomeOverviewCanAccessRecommendation,
  HomeOverviewErrorMessage,
  HomeOverviewTraceTotals,
  HomeOverviewWindowNs,
} from "~~/services/HomeOverview";
import {
  RecommendationBuildTraceLinks,
  RecommendationTraceQuery,
} from "~~/services/RecommendationLinks";

const CELL_REQUEST_TIMEOUT_MS = 15000;

export default {
  data() {
    return {
      recommendation: null,
      regenerating: false,
      recommendationGeneratedAt: null,
      longestReportGeneratedAt: null,
      mostCalledReportGeneratedAt: null,
      cells: HomeOverviewCellsInitial(),
      cellRequestIds: {},
    };
  },
  computed: {
    isAdmin() {
      return AuthenticationStore().isAdmin;
    },
    hasTracesScope() {
      return AuthenticationStore().hasTracesScope;
    },
    hasMetricsScope() {
      return AuthenticationStore().hasMetricsScope;
    },
    hasLogsScope() {
      return AuthenticationStore().hasLogsScope;
    },
    hasRecommendationAccess() {
      return HomeOverviewCanAccessRecommendation(
        this.hasTracesScope,
        this.hasLogsScope,
      );
    },
    overviewJobs() {
      return [
        {
          label: "LLM recommendation",
          generatedAt: this.recommendationGeneratedAt,
        },
        {
          label: "Longest traces report",
          generatedAt: this.longestReportGeneratedAt,
        },
        {
          label: "Most called traces report",
          generatedAt: this.mostCalledReportGeneratedAt,
        },
      ];
    },
    recommendationTraceLinks() {
      return RecommendationBuildTraceLinks(this.recommendation);
    },
  },
  async created() {
    this.cells = HomeOverviewCellsLoad(window.localStorage);
    if (await AuthenticationStore().ensureAuthenticated()) {
      this.refreshOverview();
    } else {
      useRouter().push({ path: "/settings/profile" });
    }
  },
  methods: {
    HomeOverviewCellIsLoading,
    HomeOverviewCellValueText,
    HomeOverviewAsOfLabel,
    refreshOverview() {
      // Every cell loads independently: one slow or failing signal must not
      // hide the others, and each has its own retry action.
      this.fetchRecommendation();
      this.refreshLogs();
      this.refreshTraces();
      this.refreshMetrics();
      this.refreshServices();
      this.refreshReportJobs();
    },
    async refreshCell(key, enabled, request) {
      if (!enabled) return;
      // A retry started while an older request is in flight wins: the older
      // response is discarded.
      const requestId = (this.cellRequestIds[key] || 0) + 1;
      this.cellRequestIds[key] = requestId;
      try {
        const result = await request();
        if (this.cellRequestIds[key] !== requestId) return;
        this.cells = {
          ...this.cells,
          [key]: HomeOverviewCellSuccess(
            this.cells[key],
            result.value,
            result.detail ?? null,
            Date.now(),
          ),
        };
      } catch (err) {
        if (this.cellRequestIds[key] !== requestId) return;
        this.cells = {
          ...this.cells,
          [key]: HomeOverviewCellFailure(
            this.cells[key],
            HomeOverviewErrorMessage(err),
          ),
        };
      }
      HomeOverviewCellsSave(window.localStorage, this.cells);
    },
    async authHeader() {
      return AuthService.getAuthHeader();
    },
    windowQueryString() {
      const { from, to } = HomeOverviewWindowNs(Date.now());
      return `from=${from}&to=${to}`;
    },
    async refreshLogs() {
      await this.refreshCell("logs", this.hasLogsScope, async () => {
        const windowQs = this.windowQueryString();
        const response = await analyticsGet(
          `${SERVER_URL}/analytics/logs/stats?${windowQs}`,
          { ...(await this.authHeader()), timeout: CELL_REQUEST_TIMEOUT_MS },
        );
        const severityCounts = response.data?.severityCounts || {};
        return {
          value: Number(response.data?.totalCount ?? 0),
          detail:
            (Number(severityCounts.ERROR) || 0) +
            (Number(severityCounts.FATAL) || 0),
        };
      });
    },
    async refreshTraces() {
      await this.refreshCell("traces", this.hasTracesScope, async () => {
        const windowQs = this.windowQueryString();
        const response = await analyticsGet(
          `${SERVER_URL}/analytics/traces/summary?${windowQs}&includePercentiles=false`,
          { ...(await this.authHeader()), timeout: CELL_REQUEST_TIMEOUT_MS },
        );
        const groups = response.data?.compressed
          ? await UtilsDecompressJson(response.data.groups)
          : response.data?.groups || [];
        const totals = HomeOverviewTraceTotals(groups);
        return { value: totals.tracesTotal, detail: totals.traceErrors };
      });
    },
    async refreshMetrics() {
      await this.refreshCell("metrics", this.hasMetricsScope, async () => {
        const windowQs = this.windowQueryString();
        const response = await analyticsGet(
          `${SERVER_URL}/analytics/metrics/names?${windowQs}`,
          { ...(await this.authHeader()), timeout: CELL_REQUEST_TIMEOUT_MS },
        );
        const names = await UtilsDecompressJson(response.data.metricsNames);
        return {
          value: Array.isArray(names) ? names.length : 0,
          detail: null,
        };
      });
    },
    async refreshServices() {
      await this.refreshCell("services", true, async () => {
        const response = await analyticsGet(
          `${SERVER_URL}/analytics/services`,
          { ...(await this.authHeader()), timeout: CELL_REQUEST_TIMEOUT_MS },
        );
        return {
          value: (response.data?.services || []).length,
          detail: null,
        };
      });
    },
    async refreshReportJobs() {
      const authHeader = await this.authHeader();
      const [longest, mostCalled] = await Promise.allSettled([
        axios.get(`${SERVER_URL}/reports/longest-traces`, authHeader),
        axios.get(`${SERVER_URL}/reports/most-called-traces`, authHeader),
      ]);
      if (longest.status === "fulfilled") {
        this.longestReportGeneratedAt =
          longest.value?.data?.generatedAt ?? null;
      }
      if (mostCalled.status === "fulfilled") {
        this.mostCalledReportGeneratedAt =
          mostCalled.value?.data?.generatedAt ?? null;
      }
    },
    async fetchRecommendation() {
      // The server requires both scopes: calling without them only yields a
      // silent 403.
      if (!this.hasRecommendationAccess) {
        this.recommendation = null;
        this.recommendationGeneratedAt = null;
        return;
      }
      try {
        const url = `${SERVER_URL}/recommendation`;
        const response = await axios.get(url, {
          ...(await this.authHeader()),
          timeout: CELL_REQUEST_TIMEOUT_MS,
        });
        if (response.data && response.data.generatedAt) {
          this.recommendation = response.data;
          this.recommendationGeneratedAt = response.data.generatedAt;
        } else {
          this.recommendation = null;
          this.recommendationGeneratedAt = null;
        }
      } catch (err) {
        this.recommendation = null;
        this.recommendationGeneratedAt = null;
      }
    },
    recommendationTraceQuery(link) {
      return RecommendationTraceQuery(link, this.recommendation, Date.now());
    },
    renderMarkdown,
    formatDate(isoString) {
      const d = new Date(isoString);
      return d.toLocaleString();
    },
    formatJobTime(generatedAt) {
      return generatedAt === null ? "never" : UtilsRelativeTime(generatedAt);
    },
    async regenerateRecommendation() {
      this.regenerating = true;
      try {
        const url = `${SERVER_URL}/recommendation/regenerate`;
        const response = await axios.post(
          url,
          {},
          await AuthService.getAuthHeader(),
        );
        if (response.data && response.data.generatedAt) {
          this.recommendation = response.data;
        }
      } catch (err) {
        // silently ignore
      } finally {
        this.regenerating = false;
      }
    },
  },
};
</script>

<style scoped>
#page-intro {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
  gap: 1rem;
}

.plain-link {
  color: inherit;
  text-decoration: none;
}

/* Overview strip */
.overview-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 1rem;
  align-items: start;
}
.overview-cell {
  display: flex;
  flex-direction: column;
}
.overview-value {
  font-size: 1.4rem;
  font-weight: bold;
  line-height: 1.2;
}
.overview-label {
  font-size: 0.8rem;
  opacity: 0.7;
}
.overview-sub {
  font-size: 0.75rem;
  opacity: 0.55;
}
.overview-skeleton {
  display: inline-block;
  width: 4rem;
  height: 1.4rem;
  border-radius: 0.25rem;
  background-color: currentColor;
  opacity: 0.12;
  animation: overview-pulse 1.2s ease-in-out infinite;
}
@keyframes overview-pulse {
  0%,
  100% {
    opacity: 0.08;
  }
  50% {
    opacity: 0.22;
  }
}
.overview-error {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: #c62828;
}
.overview-retry {
  width: auto;
  margin: 0;
  padding: 0 0.35rem;
  font-size: 0.75rem;
  line-height: 1.4;
}
.overview-jobs {
  gap: 0.15rem;
}
.overview-job {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.8rem;
}
.overview-job-label {
  opacity: 0.7;
}
.overview-job-value {
  white-space: nowrap;
}

#page-intro article {
  display: flow-root;
}
#page-intro article header {
  width: 100%;
}
#page-intro article .card-icon {
  float: right;
  font-size: 3rem;
  margin-left: 1rem;
  margin-bottom: 0.5rem;
}

#page-intro article header i {
  margin-right: 0.5rem;
}

#home-overview {
  grid-column: 1 / -1;
}

#page-intro h3 {
  font-size: 1.1rem;
}

#page-intro h3 i,
#page-intro h4 i {
  margin-right: 0.5rem;
}

/* Recommendation Card */
.recommendation-card {
  grid-column: 1 / -1;
}
.rec-generated-at {
  opacity: 0.6;
  font-size: 0.8rem;
}
.rec-section {
  margin-bottom: 2rem;
}
.rec-section h4 {
  margin-bottom: 0.5rem;
  font-size: 1rem;
}
.rec-content {
  line-height: 1.5;
  font-size: 0.9rem;
}
.rec-content h2 {
  font-size: 1.1rem;
  margin: 0.8rem 0 0.3rem 0;
}
.rec-content h3 {
  font-size: 1rem;
  margin: 0.6rem 0 0.2rem 0;
}
.rec-content p {
  margin: 0.3rem 0;
}
.rec-content ul,
.rec-content ol {
  margin: 0.2rem 0;
  padding-left: 1.5rem;
}
.rec-content li {
  margin: 0.15rem 0;
}
.rec-content strong {
  font-weight: 600;
}
.rec-links {
  margin-top: 0.75rem;
}
.rec-links h5 {
  margin: 0 0 0.35rem 0;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  opacity: 0.7;
}
.rec-links ul {
  list-style: none;
  padding-left: 0;
  margin: 0;
}
.rec-links li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
  padding: 0.15rem 0;
}
.rec-links a {
  font-size: 0.85rem;
}
.rec-link-meta {
  font-size: 0.75rem;
  opacity: 0.6;
}

.rec-regenerate {
  margin-top: 1rem;
  font-size: 0.75rem;
  padding: 0.2rem 0.6rem;
  width: auto;
  display: inline-block;
}
</style>
