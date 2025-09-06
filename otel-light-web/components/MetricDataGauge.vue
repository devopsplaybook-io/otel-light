<template>
  <apexchart :options="chartOptions" :series="chartSeries" />
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
        chart: { id: "line", animations: { enabled: false } },
        xaxis: { type: "datetime", title: { text: "Timestamp" } },
      },
      chartSeries: [],
      metrics: [],
    };
  },
  async created() {
    this.fetchMetrics();
  },
  methods: {
    async fetchMetrics() {
      const fetchTime = new Date();
      this.fetchTime = fetchTime;
      this.loading = true;
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
