<template>
  <div
    class="trace-summary"
    :class="{ 'trace-summary-errors': trace.nbErrors > 0 }"
  >
    <span
      >{{ trace.serviceName
      }}{{ trace.serviceVersion ? ":" + trace.serviceVersion : "" }}</span
    ><span>{{ trace.name }}</span>
    <span>{{ new Date(trace.startTime / 1_000_000).toLocaleString() }}</span>
    <span>{{ durationText }}</span>
    <span>
      {{ trace.traceId }}
      <i
        class="bi bi-box-arrow-up-right trace-open-icon"
        title="Open trace page"
        @click.stop="openTracePage"
      ></i>
    </span>
    <span>{{ trace.nbErrors }}</span>
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
    this.durationText = getDurationText(
      this.trace.endTime - this.trace.startTime
    );
  },
  methods: {
    openTracePage() {
      this.$router.push("/traces/" + this.trace.traceId);
    },
  },
};
</script>

<style scoped>
.trace-open-icon {
  cursor: pointer;
  margin-left: 0.35rem;
  opacity: 0.6;
}
.trace-open-icon:hover {
  opacity: 1;
}
</style>
