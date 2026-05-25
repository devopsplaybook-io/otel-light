<template>
  <div class="trace-group-chart">
    <apexchart
      :options="chartOptions"
      :series="chartSeries"
      :height="chartHeight"
    />
  </div>
</template>

<script>
import VueApexCharts from "vue3-apexcharts";

export default {
  components: {
    apexchart: VueApexCharts,
  },
  props: {
    series: {
      type: Array,
      default: () => [],
    },
    bucketNs: {
      type: Number,
      default: 86_400_000_000_000,
    },
    valueLabel: {
      type: String,
      default: "Value",
    },
  },
  data() {
    return {
      chartHeight: 400,
      chartSeries: [],
      chartOptions: {
        chart: {
          type: "line",
          animations: { enabled: false },
          toolbar: {
            autoSelected: "selection",
          },
        },
        xaxis: {
          type: "datetime",
          labels: {
            datetimeUTC: false,
          },
        },
        yaxis: {
          title: { text: this.valueLabel },
          labels: {
            formatter: (val) =>
              val != null ? Number(val.toFixed(2)).toString() : "",
          },
        },
        stroke: {
          width: 2,
          curve: "straight",
        },
        tooltip: {
          x: { format: "dd MMM yyyy" },
        },
        legend: {
          position: "bottom",
          horizontalAlign: "left",
          showForSingleSeries: false,
        },
        dataLabels: {
          enabled: false,
        },
      },
    };
  },
  watch: {
    series() {
      this.buildSeries();
    },
    valueLabel() {
      this.chartOptions = {
        ...this.chartOptions,
        yaxis: { title: { text: this.valueLabel } },
      };
      this.buildSeries();
    },
  },
  mounted() {
    this.updateHeight();
    window.addEventListener("resize", this.updateHeight);
    this.buildSeries();
  },
  beforeUnmount() {
    window.removeEventListener("resize", this.updateHeight);
  },
  methods: {
    updateHeight() {
      const vh = window.visualViewport?.height ?? window.innerHeight;
      this.chartHeight = Math.max(300, vh * 0.7 - 120);
    },
    buildSeries() {
      if (!this.series || this.series.length === 0) {
        this.chartSeries = [];
        return;
      }
      this.chartSeries = this.series.map((group) => ({
        name: `${group.serviceName}: ${group.name}`,
        data: (group.dataPoints || []).map((pt) => [
          pt.bucket / 1_000_000,
          pt.value,
        ]),
      }));
    },
  },
};
</script>

<style scoped>
.trace-group-chart {
  width: 100%;
  min-height: 300px;
  margin-bottom: 1rem;
}
</style>
