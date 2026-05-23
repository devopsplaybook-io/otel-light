<template>
  <div class="report-tabs">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      @click="$emit('select', tab.id)"
      :class="['report-tab', { active: active === tab.id }]"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<script>
export default {
  props: {
    tabs: {
      type: Array,
      required: true,
    },
    active: {
      type: String,
      required: true,
    },
  },
  emits: ["select"],
};
</script>

<style scoped>
.report-tabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid #ffffff22;
  padding-bottom: 0;
}
.report-tab {
  background: none;
  border: none;
  color: #aaa;
  padding: 0.5rem 1rem;
  cursor: pointer;
  font-size: 0.9rem;
  border-bottom: 2px solid transparent;
  transition:
    color 0.2s,
    border-color 0.2s;
}
.report-tab:hover {
  color: #ddd;
}
.report-tab.active {
  color: #fff;
  border-bottom-color: #4a9eff;
}
</style>
