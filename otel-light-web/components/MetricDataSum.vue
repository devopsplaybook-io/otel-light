<template>
  <div class="metric-chart">
    <div v-if="loading" class="loading-indicator"></div>
    <apexchart v-else :options="chartOptions" :series="chartSeries" />
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
      chartOptions: {
        chart: {
          id: "sum",
          type: "line",
          animations: { enabled: false },
          toolbar: {
            autoSelected: "selection",
          },
        },
        xaxis: {
          type: "datetime",
        },
        stroke: {
          curve: "smooth",
          width: 2,
        },
        markers: {
          size: 4,
        },
        tooltip: {
          x: {
            format: "dd MMM yyyy HH:mm:ss",
          },
        },
        legend: {
          height: 80,
        },
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
        data.data.sum.dataPoints.forEach((point) => {
          const seriesName = this.attributesToString(point.attributes);
          const timestamp = new Date(point.timeUnixNano / 1_000_000);

          if (!chartSeriesContainer[seriesName]) {
            chartSeriesContainer[seriesName] = [];
          }

          // Handle both double and integer values
          const value =
            point.asDouble !== undefined
              ? point.asDouble
              : point.asInt !== undefined
                ? point.asInt
                : 0;

          chartSeriesContainer[seriesName].push([timestamp.getTime(), value]);
        });
      });

      // Sort data points by timestamp and create series
      Object.keys(chartSeriesContainer).forEach((seriesName) => {
        const sortedData = chartSeriesContainer[seriesName].sort(
          (a, b) => a[0] - b[0],
        );

        this.chartSeries.push({
          name: seriesName,
          data: sortedData,
        });
      });
    },
    attributesToString(attributes) {
      if (!attributes || attributes.length === 0) {
        return "default";
      }
      return attributes
        .map(
          (item) =>
            `${item.key}:${
              item.value.stringValue ||
              item.value.intValue ||
              item.value.doubleValue
            }`,
        )
        .join("-");
    },
  },
};
</script>
