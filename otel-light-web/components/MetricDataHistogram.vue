<template>
  <apexchart :options="chartOptions" :series="chartSeries" />
</template>

<script>
import VueApexCharts from "vue3-apexcharts";

export default {
  components: {
    apexchart: VueApexCharts,
  },
  props: {
    metric: {
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
      },
      chartSeries: [],
    };
  },
  async created() {
    const chartSeriesContainer = {};
    const bucketLabels = new Set();

    this.metric.data.forEach((data) => {
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
  methods: {
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
