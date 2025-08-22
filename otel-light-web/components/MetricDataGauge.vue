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
      durationText: "",
      chartOptions: {
        chart: { id: "line", animations: { enabled: false } },
        xaxis: { type: "datetime", title: { text: "Timestamp" } },
      },
      chartSeries: [],
    };
  },
  async created() {
    const chartSeriesContainer = {};
    this.metric.data.forEach((data) => {
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
  methods: {
    attributesToString(attributes) {
      return attributes
        .map((item) => `${item.key}:${item.value.stringValue}`)
        .join("-");
    },
  },
};
</script>
