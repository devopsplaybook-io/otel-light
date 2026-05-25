<template>
  <div class="metric-chart">
    <div v-if="loading" class="loading-indicator"></div>
    <apexchart v-else :options="chartOptions" :series="chartSeries" />
  </div>
</template>

<script>
import { analyticsGet } from "~~/services/AnalyticsQueue";
import VueApexCharts from "vue3-apexcharts";
import {
  UtilsDecompressJson,
  UtilsMetricSampleDataPoints,
} from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
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
          id: "histogram",
          type: "bar",
          animations: { enabled: false },
          toolbar: {
            autoSelected: "selection",
          },
        },
        xaxis: {
          type: "category",
          title: { text: "Buckets" },
          categories: [],
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
      this.chartOptions.xaxis.categories = [];
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
          const response = await analyticsGet(
            url,
            await AuthService.getAuthHeader(),
          );

          if (fetchTime < this.fetchTime) {
            return;
          }

          const batchMetrics = await UtilsDecompressJson(response.data.metrics);

          allMetrics.push(...batchMetrics);

          if (batchMetrics.length < PAGE_SIZE) {
            hasMore = false;
          } else {
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
      const bucketLabels = new Set();

      this.metrics.forEach((data) => {
        data.data.histogram.dataPoints.forEach((point) => {
          const seriesName = this.attributesToString(point.attributes);
          const timestamp = new Date(
            point.timeUnixNano / 1_000_000,
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
          (bucket) => chartSeriesContainer[seriesName][bucket] || 0,
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
            }`,
        )
        .join("-");
    },
  },
};
</script>
