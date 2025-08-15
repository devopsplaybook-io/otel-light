<template>
  <div>
    <div class="trace-summary">
      <span>{{ this.trace.name }}</span>
      <span>{{ this.trace.traceId }}</span>
      <span>{{
        new Date(this.trace.startTime / 1_000_000).toLocaleString()
      }}</span>
      <span>{{ durationText }}</span>
      <span
        >{{ this.trace.spanCount }} span{{
          this.trace.spanCount === 1 ? "" : "s"
        }}</span
      >
    </div>
  </div>
</template>

<script>
import { getDurationText } from "../services/Utils";

export default {
  props: {
    trace: {
      type: Object,
      default: null,
    },
  },
  data() {
    return {
      durationText: "",
    };
  },
  async created() {
    this.durationText = getDurationText(
      this.trace.endTime - this.trace.startTime
    );
  },
  methods: {},
};
</script>

<style>
.trace-summary {
  display: grid;
  grid-template-columns: 3fr 3fr 3fr 1fr 1fr;
  gap: 1rem;
  width: 100%;
}
.trace-summary span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
