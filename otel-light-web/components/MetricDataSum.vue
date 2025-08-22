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
          id: "sum",
          type: "line",
          animations: { enabled: false },
        },
        xaxis: {
          type: "datetime",
          title: { text: "Timestamp" },
        },
        yaxis: {
          title: { text: "Sum Value" },
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
      },
      chartSeries: [],
    };
  },
  async created() {
    const chartSeriesContainer = {};

    this.metric.data.forEach((data) => {
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
