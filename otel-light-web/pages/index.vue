<template>
  <div id="page-intro">
    <article v-if="overview" id="home-overview">
      <header>
        <h3><i class="bi bi-activity"></i> Last 24 hours</h3>
      </header>
      <section class="overview-strip">
        <NuxtLink
          v-if="hasLogsScope"
          to="/logs"
          class="overview-cell plain-link"
        >
          <span class="overview-value">{{
            formatCount(overview.logsTotal)
          }}</span>
          <span class="overview-label">logs ingested</span>
          <span class="overview-sub"
            >{{ formatCount(overview.logErrors) }} errors</span
          >
        </NuxtLink>
        <NuxtLink
          v-if="hasTracesScope"
          to="/traces"
          class="overview-cell plain-link"
        >
          <span class="overview-value">{{
            formatCount(overview.tracesTotal)
          }}</span>
          <span class="overview-label">traces ingested</span>
          <span class="overview-sub"
            >{{ formatCount(overview.traceErrors) }} errors</span
          >
        </NuxtLink>
        <NuxtLink
          v-if="hasMetricsScope"
          to="/metrics"
          class="overview-cell plain-link"
        >
          <span class="overview-value">{{
            formatCount(overview.metricSeries)
          }}</span>
          <span class="overview-label">metric series</span>
        </NuxtLink>
        <div class="overview-cell">
          <span class="overview-value">{{
            formatCount(overview.servicesCount)
          }}</span>
          <span class="overview-label">services reporting</span>
        </div>
        <div class="overview-cell overview-jobs">
          <span class="overview-label">Scheduled jobs</span>
          <div v-for="job in overview.jobs" :key="job.label" class="overview-job">
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
      v-if="recommendation"
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
          <div
            class="rec-content"
            v-html="renderMarkdown(recommendation.analysis)"
          ></div>
        </div>
        <div v-if="recommendation.recommendations" class="rec-section">
          <h4><i class="bi bi-lightbulb"></i> Recommendations</h4>
          <div
            class="rec-content"
            v-html="renderMarkdown(recommendation.recommendations)"
          ></div>
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
  HomeOverviewBuildModel,
  HomeOverviewWindowNs,
} from "~~/services/HomeOverview";

export default {
  data() {
    return {
      recommendation: null,
      regenerating: false,
      recommendationGeneratedAt: null,
      overview: null,
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
  },
  async created() {
    if (await AuthenticationStore().ensureAuthenticated()) {
      this.fetchOverview();
    } else {
      useRouter().push({ path: "/settings/profile" });
    }
  },
  methods: {
    async fetchOverview() {
      // The recommendation powers both the card below and the strip's job row.
      const recommendationPromise = this.fetchRecommendation();
      const authHeader = await AuthService.getAuthHeader();
      const { from, to } = HomeOverviewWindowNs(Date.now());
      const windowQs = `from=${from}&to=${to}`;
      const [logsRes, tracesRes, metricsRes, servicesRes, longestRes, mostCalledRes] =
        await Promise.all([
          this.fetchCell(this.hasLogsScope, () =>
            analyticsGet(
              `${SERVER_URL}/analytics/logs/stats?${windowQs}`,
              authHeader,
            ),
          ),
          this.fetchCell(this.hasTracesScope, () =>
            analyticsGet(
              `${SERVER_URL}/analytics/traces/stats?${windowQs}`,
              authHeader,
            ),
          ),
          this.fetchCell(this.hasMetricsScope, () =>
            analyticsGet(
              `${SERVER_URL}/analytics/metrics/names?${windowQs}`,
              authHeader,
            ),
          ),
          this.fetchCell(true, () =>
            analyticsGet(`${SERVER_URL}/analytics/services`, authHeader),
          ),
          this.fetchCell(this.hasTracesScope, () =>
            axios.get(`${SERVER_URL}/reports/longest-traces`, authHeader),
          ),
          this.fetchCell(this.hasTracesScope, () =>
            axios.get(`${SERVER_URL}/reports/most-called-traces`, authHeader),
          ),
        ]);
      await recommendationPromise;

      let tracesGroups = null;
      if (tracesRes) {
        try {
          tracesGroups = await UtilsDecompressJson(tracesRes.data.groups);
        } catch (err) {
          tracesGroups = null;
        }
      }
      let metricNamesCount = null;
      if (metricsRes) {
        try {
          const names = await UtilsDecompressJson(metricsRes.data.metricsNames);
          metricNamesCount = Array.isArray(names) ? names.length : 0;
        } catch (err) {
          metricNamesCount = null;
        }
      }
      this.overview = HomeOverviewBuildModel({
        logsStats: logsRes ? logsRes.data : null,
        tracesGroups,
        metricNamesCount,
        servicesCount: servicesRes
          ? (servicesRes.data.services || []).length
          : null,
        recommendationGeneratedAt: this.recommendationGeneratedAt,
        longestReportGeneratedAt: longestRes?.data?.generatedAt ?? null,
        mostCalledReportGeneratedAt: mostCalledRes?.data?.generatedAt ?? null,
      });
    },
    // Returns null (rendered as "—") when the cell is out of scope or the
    // fetch fails: a broken cell must never break the page.
    async fetchCell(enabled, request) {
      if (!enabled) return null;
      try {
        return await request();
      } catch (err) {
        return null;
      }
    },
    async fetchRecommendation() {
      try {
        const url = `${SERVER_URL}/recommendation`;
        const response = await axios.get(
          url,
          await AuthService.getAuthHeader(),
        );
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
    renderMarkdown,
    formatDate(isoString) {
      const d = new Date(isoString);
      return d.toLocaleString();
    },
    formatCount(value) {
      return value === null ? "—" : String(value);
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

.rec-regenerate {
  margin-top: 1rem;
  font-size: 0.75rem;
  padding: 0.2rem 0.6rem;
  width: auto;
  display: inline-block;
}
</style>
