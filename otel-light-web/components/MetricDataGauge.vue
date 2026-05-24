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
import { SERVER_URL } from "~~/services/Config";
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

      const PAGE_SIZE = 500;
      const allMetrics = [];
      let beforeTime = null;
      let hasMore = true;

      while (hasMore) {
        if (fetchTime < this.fetchTime) {
          return;
        }

        const baseParams = new URLSearchParams(this.filter.queryString || "");
        baseParams.delete("serviceName");
        baseParams.delete("name");
        baseParams.delete("limit");
        baseParams.set("serviceName", this.serviceName);
        baseParams.set("name", this.name);
        baseParams.set("limit", String(PAGE_SIZE));

        if (beforeTime) {
          baseParams.set("beforeTime", String(beforeTime));
        }

        const url = `${SERVER_URL}/analytics/metrics?${baseParams.toString()}`;

        try {
          const response = await axios.get(
            url,
            await AuthService.getAuthHeader(),
          );

          if (fetchTime < this.fetchTime) {
            return;
          }

          const batchMetrics = await UtilsDecompressJson(response.data.metrics);

          if (response.data.warning) {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              type: "warning",
              text: response.data.warning,
            });
          }

          allMetrics.push(...batchMetrics);

          if (batchMetrics.length < PAGE_SIZE) {
            hasMore = false;
          } else {
            // Use the oldest timestamp in this batch as the cursor for next page
            beforeTime = Math.min(...batchMetrics.map((m) => m.time));
          }
        } catch (error) {
          handleError(error);
          hasMore = false;
        }
      }

      this.allMetrics = allMetrics;
      this.metrics = UtilsMetricSampleDataPoints(allMetrics, 500);
      this.displayMetrics();
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
