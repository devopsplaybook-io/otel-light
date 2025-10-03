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
      return attributes
        .map((item) => `${item.key}:${item.value.stringValue}`)
        .join("-");
    },
  },
};
</script>
