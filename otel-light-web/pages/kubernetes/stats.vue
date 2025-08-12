<template>
  <div id="stats-layout">
    <apexchart
      width="100%"
      type="line"
      :options="cpuChartOptions"
      :series="cpuChartSeries"
    />
    <apexchart
      width="100%"
      type="line"
      :options="memoryChartOptions"
      :series="memoryChartSeries"
    />
    <apexchart
      width="100%"
      type="line"
      :options="podsChartOptions"
      :series="podsChartSeries"
    />
  </div>
</template>

<script>
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";
import { AuthService } from "~~/services/AuthService";
import { handleError } from "~~/services/EventBus";
import axios from "axios";
import Config from "~~/services/Config.ts";
import VueApexCharts from "vue3-apexcharts";

export default {
  components: {
    apexchart: VueApexCharts,
  },
  data() {
    return {
      stats: [],
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      cpuChartOptions: {
        chart: { id: "cpu-line" },
        xaxis: { type: "datetime", title: { text: "Timestamp" } },
        yaxis: { min: 0, max: 100 },
        title: { text: "CPU Usage (%)" },
      },
      cpuChartSeries: [],
      memoryChartOptions: {
        chart: { id: "memory-line" },
        xaxis: { type: "datetime", title: { text: "Timestamp" } },
        yaxis: { min: 0, max: 100 },
        title: { text: "Memory Usage (%)" },
      },
      memoryChartSeries: [],
      podsChartOptions: {
        chart: { id: "pods-line" },
        xaxis: { type: "datetime", title: { text: "Timestamp" } },
        yaxis: { min: 0 },
        title: { text: "Pods per Node" },
      },
      podsChartSeries: [],
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
    this.refreshStats();
    this.refreshIntervalValue = RefreshIntervalService.get();
  },
  mounted() {
    const interval = parseInt(this.refreshIntervalValue, 10);
    if (interval > 0) {
      this.refreshIntervalId = setInterval(() => {
        this.refreshStats();
      }, interval);
    }
  },
  beforeUnmount() {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
  },
  methods: {
    async refreshStats() {
      await axios
        .get(
          `${(await Config.get()).SERVER_URL}/stats/nodes`,
          await AuthService.getAuthHeader()
        )
        .then(async (res) => {
          this.stats = res.data.stats;
          this.updateCharts();
        })
        .catch(handleError);
    },
    updateCharts() {
      const statsByNode = {};
      for (const s of this.stats) {
        if (!statsByNode[s.node]) statsByNode[s.node] = [];
        statsByNode[s.node].push(s);
      }

      Object.values(statsByNode).forEach((arr) =>
        arr.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      );

      this.cpuChartSeries = Object.keys(statsByNode).map((node) => ({
        name: node,
        data: statsByNode[node].map((s) => [
          new Date(s.timestamp).getTime(),
          Number(s.cpuUsage?.toFixed(2) || 0),
        ]),
      }));
      this.memoryChartSeries = Object.keys(statsByNode).map((node) => ({
        name: node,
        data: statsByNode[node].map((s) => [
          new Date(s.timestamp).getTime(),
          Number(s.memoryUsage?.toFixed(2) || 0),
        ]),
      }));
      this.podsChartSeries = Object.keys(statsByNode).map((node) => ({
        name: node,
        data: statsByNode[node].map((s) => [
          new Date(s.timestamp).getTime(),
          s.pods || 0,
        ]),
      }));
    },
  },
};
</script>

<style scoped>
#stats-layout {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(25em, 1fr));
  gap: 2em;
}
</style>

<style>
.apexcharts-tooltip {
  color: #333;
}
</style>
