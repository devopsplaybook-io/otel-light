<template>
  <div>
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
          id: "histogram",
          type: "bar",
          animations: { enabled: false },
        },
        xaxis: {
          type: "category",
          title: { text: "Buckets" },
          categories: [],
        },
        yaxis: {
          title: { text: "Count" },
        },
        plotOptions: {
          bar: {
            horizontal: false,
            columnWidth: "90%",
          },
        },
        dataLabels: {
          enabled: false,
        },
        tooltip: {
          y: {
            formatter: function (val) {
              return val + " occurrences";
            },
          },
        },
        legend: {
          height: "100",
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
      const bucketLabels = new Set();

      this.metrics.forEach((data) => {
        data.data.histogram.dataPoints.forEach((point) => {
          const seriesName = this.attributesToString(point.attributes);
          const timestamp = new Date(
            point.timeUnixNano / 1_000_000
          ).toISOString();

          if (!chartSeriesContainer[seriesName]) {
            chartSeriesContainer[seriesName] = {};
          }

          // Process bucket counts
          if (point.bucketCounts && point.explicitBounds) {
            point.explicitBounds.forEach((bound, index) => {
              const bucketLabel =
                index < point.explicitBounds.length - 1
                  ? `≤${bound}`
                  : `≤${bound}+`;
              bucketLabels.add(bucketLabel);

              if (!chartSeriesContainer[seriesName][bucketLabel]) {
                chartSeriesContainer[seriesName][bucketLabel] = 0;
              }
              chartSeriesContainer[seriesName][bucketLabel] +=
                point.bucketCounts[index] || 0;
            });

            // Handle the last bucket (infinity)
            if (point.bucketCounts.length > point.explicitBounds.length) {
              const bucketLabel = ">∞";
              bucketLabels.add(bucketLabel);
              if (!chartSeriesContainer[seriesName][bucketLabel]) {
                chartSeriesContainer[seriesName][bucketLabel] = 0;
              }
              chartSeriesContainer[seriesName][bucketLabel] +=
                point.bucketCounts[point.bucketCounts.length - 1] || 0;
            }
          }
        });
      });

      // Convert bucketLabels to sorted array
      const sortedBuckets = Array.from(bucketLabels).sort((a, b) => {
        if (a === ">∞") return 1;
        if (b === ">∞") return -1;
        const aNum = parseFloat(a.substring(1));
        const bNum = parseFloat(b.substring(1));
        return aNum - bNum;
      });

      this.chartOptions.xaxis.categories = sortedBuckets;

      // Create series for each attribute combination
      Object.keys(chartSeriesContainer).forEach((seriesName) => {
        const data = sortedBuckets.map(
          (bucket) => chartSeriesContainer[seriesName][bucket] || 0
        );

        this.chartSeries.push({
          name: seriesName,
          data: data,
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
