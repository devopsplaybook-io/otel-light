<template>
  <div class="report-static">
    <div class="report-header">
      <div class="report-title-section">
        <h3>{{ title }}</h3>
        <span v-if="generatedAt" class="report-meta">
          Generated {{ formatDate(generatedAt) }} &mdash; Top {{ topN }} &mdash;
          Last {{ periodDays }} days
        </span>
        <span v-else class="report-meta report-pending">Generating…</span>
      </div>
    </div>
    <div v-if="series && series.length > 0">
      <TraceGroupLineChart
        :series="series"
        :bucket-ns="bucketNs"
        :value-label="valueLabel"
      />
    </div>
    <div v-else class="report-empty">
      No data yet. The report is generated once daily.
    </div>
  </div>
</template>

<script>
import TraceGroupLineChart from "~/components/TraceGroupLineChart.vue";

export default {
  components: { TraceGroupLineChart },
  props: {
    title: { type: String, required: true },
    generatedAt: { type: String, default: null },
    periodDays: { type: Number, default: null },
    topN: { type: Number, default: null },
    bucketNs: { type: Number, default: null },
    series: { type: Array, default: () => [] },
    valueLabel: { type: String, default: "Value" },
  },
  methods: {
    formatDate(isoString) {
      if (!isoString) return "";
      const d = new Date(isoString);
      return d.toLocaleString();
    },
  },
};
</script>

<style scoped>
.report-static {
  width: 100%;
}
.report-header {
  margin-bottom: 1rem;
}
.report-title-section h3 {
  margin: 0 0 0.25rem 0;
  font-size: 1rem;
  font-weight: 600;
}
.report-meta {
  font-size: 0.8rem;
  color: #888;
}
.report-pending {
  font-style: italic;
}
.report-empty {
  padding: 2rem;
  text-align: center;
  color: #888;
  font-style: italic;
}
</style>
