<template>
  <div id="traces-page" class="signals-page">
    <TabNavigation :tabs="tracesTabs" />
    <div class="signals-scroll">
      <TraceReportStatic
        title="Most Called Traces"
        :generated-at="report.generatedAt"
        :period-days="report.periodDays"
        :top-n="report.topN"
        :bucket-ns="report.bucketNs"
        :series="report.series"
        value-label="Avg Duration (s)"
      />
    </div>
  </div>
</template>

<script>
import axios from "axios";
import TraceReportStatic from "~/components/TraceReportStatic.vue";
import { TracesTabs } from "~~/services/TracesTabs";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { handleError } from "~~/services/EventBus";

export default {
  components: { TraceReportStatic },
  data() {
    return {
      tracesTabs: TracesTabs,
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
    async fetchReport() {
      try {
        const response = await axios.get(
          `${SERVER_URL}/reports/most-called-traces`,
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
