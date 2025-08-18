<template>
  <div
    class="trace-summary"
    :class="{ 'trace-summary-errors': trace.statusCodeSum > 0 }"
  >
    <span
      >{{ trace.serviceName
      }}{{ trace.serviceVersion ? ":" + trace.serviceVersion : "" }}</span
    ><span>{{ trace.name }}</span>
    <span>{{ new Date(trace.startTime / 1_000_000).toLocaleString() }}</span>
    <span>{{ durationText }}</span>
    <span>{{ trace.traceId }}</span>
    <span>{{ trace.statusCodeSum > 0 ? "Yes" : "No" }}</span>
    <span
      >{{ trace.spanCount }} span{{ trace.spanCount === 1 ? "" : "s" }}</span
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
    console.log(this.trace);
    this.durationText = getDurationText(
      this.trace.endTime - this.trace.startTime
    );
  },
  methods: {},
};
</script>

<style scoped>
.trace-summary-errors {
  background-color: #d9352622;
}
</style>
