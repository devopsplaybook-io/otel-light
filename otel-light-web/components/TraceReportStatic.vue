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
    <div v-if="generatedAt && groupRows.length > 0" class="report-groups">
      <h4>Top groups</h4>
      <ul>
        <li v-for="row in groupRows" :key="row.key">
          <button
            type="button"
            class="report-group-row"
            :title="`Open ${row.label} in Traces`"
            @click="$emit('drilldown', row)"
          >
            <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
            <span>{{ row.label }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script>
import TraceGroupLineChart from "~/components/TraceGroupLineChart.vue";

export default {
  components: { TraceGroupLineChart },
  emits: ["drilldown"],
  props: {
    title: { type: String, required: true },
    generatedAt: { type: String, default: null },
    periodDays: { type: Number, default: null },
    topN: { type: Number, default: null },
    bucketNs: { type: Number, default: null },
    series: { type: Array, default: () => [] },
    valueLabel: { type: String, default: "Value" },
  },
  computed: {
    groupRows() {
      // Top groups are clickable drilldowns: the series is already ranked by
      // the report generator, so the order is kept.
      return (this.series || []).map((group, index) => {
        const serviceName = group?.serviceName || "";
        const name = group?.name || "";
        return {
          key: `${serviceName}||${name}||${index}`,
          serviceName,
          name,
          label: serviceName ? `${serviceName}: ${name}` : name,
        };
      });
    },
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
.report-groups {
  margin-top: 1rem;
}
.report-groups h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  opacity: 0.7;
}
.report-groups ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: 0.25rem;
}
.report-group-row {
  width: 100%;
  margin: 0;
  padding: 0.35rem 0.6rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  text-align: left;
  background: none;
  border: 1px solid #dfe3eb55;
  border-radius: 0.3rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.report-group-row:hover {
  border-color: #dfe3ebaa;
}
.report-group-row i {
  opacity: 0.5;
}
</style>
