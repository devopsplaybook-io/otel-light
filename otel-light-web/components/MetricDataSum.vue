<template>
  <div class="metric-chart">
    <div v-if="loading" class="loading-indicator"></div>
    <apexchart v-else :options="chartOptions" :series="chartSeries" />
  </div>
</template>

<script>
import VueApexCharts from "vue3-apexcharts";
import axios from "axios";
import {
  UtilsDecompressJson,
  UtilsMetricSampleDataPoints,
} from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

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
      metrics: [],
      loading: false,
    };
  },
  async created() {
    this.fetchMetrics();
  },
  methods: {
    async fetchMetrics() {
      this.loading = true;
      const fetchTime = new Date();
      this.fetchTime = fetchTime;
      const url = `${(await Config.get()).SERVER_URL}/analytics/metrics${
        this.filter.queryString
          ? `?${this.filter.queryString}&serviceName=${this.serviceName}&name=${this.name}`
          : `?serviceName=${this.serviceName}&name=${this.name}`
      }`;
      axios
        .get(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          if (fetchTime < this.fetchTime) {
            return;
          }
          this.metrics = UtilsMetricSampleDataPoints(
            await UtilsDecompressJson(response.data.metrics),
            500
          );
          if (response.data.warning) {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              type: "warning",
              text: response.data.warning,
            });
          }
          this.displayMetrics();
        })
        .catch(handleError)
        .finally(() => {
          this.loading = false;
        });
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
          (a, b) => a[0] - b[0]
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
            }`
        )
        .join("-");
    },
  },
};
</script>
