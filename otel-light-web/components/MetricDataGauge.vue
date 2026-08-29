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
import { UtilsMetricSampleDataPoints } from "~/services/Utils";
import { MetricsServiceFetchMetricData } from "~~/services/MetricsService";
import { handleError } from "~~/services/EventBus";

export default {
  components: {
    apexchart: VueApexCharts,
  },
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
      },
      legend: { height: 80 },
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
      this.chartSeries = [];
      this.allMetrics = [];
      this.metrics = [];
      this.fetchMetrics();
    },
  },
  methods: {
    async fetchMetrics() {
      this.loading = true;
      this.chartSeries = [];
      this.allMetrics = [];
      this.metrics = [];

      const fetchTime = new Date();
      this.fetchTime = fetchTime;

      try {
        const allMetrics = await MetricsServiceFetchMetricData(
          this.serviceName,
          this.name,
          this.filter.queryString,
        );
        if (fetchTime < this.fetchTime) {
          return;
        }
        this.allMetrics = allMetrics;
        this.metrics = UtilsMetricSampleDataPoints(allMetrics, 500);
        this.displayMetrics();
      } catch (error) {
        handleError(error);
      }
      this.loading = false;
    },
    displayMetrics() {
      const chartSeriesContainer = {};
      this.metrics.forEach((data) => {
        data.data.gauge.dataPoints.forEach((point) => {
          const seriesName = this.attributesToString(point.attributes);
          const timestamp = new Date(point.timestamp).getTime();
          if (!chartSeriesContainer[seriesName]) {
            chartSeriesContainer[seriesName] = [];
          }
          chartSeriesContainer[seriesName].push([
            new Date(point.timeUnixNano / 1_000_000),
            point.asDouble,
          ]);
        });
      });
      Object.keys(chartSeriesContainer).forEach((name) => {
        this.chartSeries.push({
          name,
          data: chartSeriesContainer[name],
        });
      });
    },
    attributesToString(attributes) {
      if (!attributes || attributes.length === 0) {
        return "default";
      }
      return attributes
        .map((item) => `${item.key}:${item.value.stringValue}`)
        .join("-");
    },
  },
};
</script>
