<template>
  <div id="page-intro">
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
          {{ recommendation.periodHours }}h period
        </small>
      </section>
    </article>
  </div>
</template>

<script>
import axios from "axios";
import Config from "~~/services/Config";
import { AuthService } from "~~/services/AuthService";
import { marked } from "marked";

export default {
  data() {
    return {
      recommendation: null,
    };
  },
  async created() {
    if (await AuthenticationStore().ensureAuthenticated()) {
      this.fetchRecommendation();
    } else {
      useRouter().push({ path: "/users" });
    }
  },
  methods: {
    async fetchRecommendation() {
      try {
        const url = `${(await Config.get()).SERVER_URL}/recommendation`;
        const response = await axios.get(
          url,
          await AuthService.getAuthHeader(),
        );
        if (response.data && response.data.generatedAt) {
          this.recommendation = response.data;
        } else {
          this.recommendation = null;
        }
      } catch (err) {
        this.recommendation = null;
      }
    },
    renderMarkdown(text) {
      if (!text) return "";
      return marked.parse(text, { breaks: true });
    },
    formatDate(isoString) {
      const d = new Date(isoString);
      return d.toLocaleString();
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
</style>
