<template>
  <div class="metric-chart">
    <div v-if="loading" class="loading-indicator"></div>
    <apexchart
      v-else
      :options="chartOptions"
      :series="chartSeries"
      height="100%"
    />
  </div>
</template>

<script>
import VueApexCharts from "vue3-apexcharts";
import {
  UtilsMetricSampleDataPoints,
  UtilsMetricSeriesName,
} from "~/services/Utils";
import { MetricsCardsLatestInfo } from "~~/services/MetricsCards";
import { MetricsServiceFetchMetricData } from "~~/services/MetricsService";
import { handleError } from "~~/services/EventBus";

export default {
  components: {
    apexchart: VueApexCharts,
  },
  emits: ["latest", "loadState"],
  props: {
    serviceName: {
      type: String,
      default: null,
    },
    name: {
      type: String,
      default: null,
    },
    filter: {
      type: Object,
      default: null,
    },
    reloadToken: {
      type: Number,
      default: 0,
    },
    priority: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      durationText: "",
      chartOptions: {
        chart: {
          height: "100%",
          id: "line",
          animations: { enabled: false },
          toolbar: {
            autoSelected: "selection",
          },
        },
        xaxis: { type: "datetime" },
        stroke: { width: 3 },
        legend: { height: 80 },
      },
      chartSeries: [],
      allMetrics: [],
      metrics: [],
      loading: false,
    };
  },
  async created() {
    this.fetchMetrics();
  },
  watch: {
    filter() {
      this.fetchMetrics();
    },
    reloadToken() {
      this.fetchMetrics();
    },
  },
  methods: {
    async fetchMetrics() {
      this.$emit("loadState", "queued");
      const fetchTime = new Date();
      this.fetchTime = fetchTime;

      try {
        const allMetrics = await MetricsServiceFetchMetricData(
          this.serviceName,
          this.name,
          this.filter.queryString,
          {
            priority: this.priority,
            onStart: () => {
              if (fetchTime < this.fetchTime) {
                return;
              }
              this.loading = true;
              this.chartSeries = [];
              this.allMetrics = [];
              this.metrics = [];
              this.$emit("loadState", "loading");
            },
          },
        );
        if (fetchTime < this.fetchTime) {
          return;
        }
        this.allMetrics = allMetrics;
        this.metrics = UtilsMetricSampleDataPoints(allMetrics, 500);
        this.displayMetrics();
        const latest = MetricsCardsLatestInfo(this.allMetrics);
        if (latest) {
          this.$emit("latest", latest);
        }
        this.$emit("loadState", "loaded");
      } catch (error) {
        if (fetchTime < this.fetchTime) {
          return;
        }
        handleError(error);
        this.$emit("loadState", "error");
      }
      this.loading = false;
    },
    displayMetrics() {
      const chartSeriesContainer = {};
      this.metrics.forEach((data) => {
        data.data.gauge.dataPoints.forEach((point) => {
          const seriesName = UtilsMetricSeriesName(point.attributes);
          if (!chartSeriesContainer[seriesName]) {
            chartSeriesContainer[seriesName] = [];
          }
          chartSeriesContainer[seriesName].push([
            new Date(Number(point.timeUnixNano) / 1_000_000),
            point.asDouble ?? point.asInt ?? 0,
          ]);
        });
      });
      Object.keys(chartSeriesContainer).forEach((name) => {
        this.chartSeries.push({
          name,
          data: chartSeriesContainer[name].sort((a, b) => a[0] - b[0]),
        });
      });
    },
  },
};
</script>
