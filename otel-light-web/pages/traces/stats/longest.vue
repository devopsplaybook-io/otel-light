<template>
  <div id="traces-page" class="signals-page">
    <TabNavigation :tabs="reports" />
    <div class="signals-scroll">
      <TraceReportStatic
        title="Longest Traces"
        :generated-at="report.generatedAt"
        :period-days="report.periodDays"
        :top-n="report.topN"
        :bucket-ns="report.bucketNs"
        :series="report.series"
        value-label="Avg Duration (s)"
      />
    </div>
    <button class="fab-button" @click="goToTraces" title="Go to Analytics">
      <i class="bi bi-arrow-return-left"></i>&nbsp;Back
    </button>
  </div>
</template>

<script>
import axios from "axios";
import TraceReportStatic from "~/components/TraceReportStatic.vue";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { handleError } from "~~/services/EventBus";

export default {
  components: { TraceReportStatic },
  data() {
    return {
      reports: [
        {
          id: "aggregated",
          label: "Aggregated Traces",
          to: "/traces/stats/aggregated",
        },
        { id: "longest", label: "Longest Traces", to: "/traces/stats/longest" },
        {
          id: "most-called",
          label: "Most Called Traces",
          to: "/traces/stats/most-called",
        },
      ],
      report: {
        generatedAt: null,
        periodDays: null,
        topN: null,
        bucketNs: null,
        series: [],
      },
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
      return;
    }
    this.fetchReport();
  },
  methods: {
    goToTraces() {
      this.$router.push({ path: "/traces/", query: this.$route.query });
    },
    async fetchReport() {
      try {
        const response = await axios.get(
          `${SERVER_URL}/reports/longest-traces`,
          await AuthService.getAuthHeader(),
        );
        if (response.data) {
          const data = response.data;
          this.report = {
            generatedAt: data.generatedAt,
            periodDays: data.periodDays,
            topN: data.topN,
            bucketNs: data.bucketNs,
            series: data.series || [],
          };
        }
      } catch (err) {
        handleError(err);
      }
    },
  },
};
</script>
