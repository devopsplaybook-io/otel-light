<template>
  <div class="trace-summary">
    <span>{{ this.trace.serviceName }}</span
    ><span>{{ this.trace.name }}</span>
    <span>{{
      new Date(this.trace.startTime / 1_000_000).toLocaleString()
    }}</span>
    <span>{{ durationText }}</span>
    <span>{{ this.trace.traceId }}</span>
    <span
      >{{ this.trace.spanCount }} span{{
        this.trace.spanCount === 1 ? "" : "s"
      }}</span
    >
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

<style></style>
