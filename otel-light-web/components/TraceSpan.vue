<template>
  <div class="trace-span-list">
    <div
      v-for="span of traceSpans"
      :key="span.spanId"
      class="span-bar-container"
    >
      <div class="span-name">{{ span.name }} {{ span.durationText }}</div>
      <div
        class="span-bar"
        :style="{
          left: span.startPercent + '%',
          width: span.endPercent - span.startPercent + '%',
        }"
      ></div>
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
    traceSpans: {
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
    this.traceSpans.forEach((span) => {
      span.startPercent = (
        (100 * (span.startTime - this.trace.startTime)) /
        (this.trace.endTime - this.trace.startTime)
      ).toFixed(0);
      span.endPercent = (
        (100 * (span.endTime - this.trace.startTime)) /
        (this.trace.endTime - this.trace.startTime)
      ).toFixed(0);
      span.durationText = getDurationText(span.endTime - span.startTime);
    });
  },
  methods: {},
};
</script>

<style>
.trace-span-list {
  width: 100%;
}

.span-bar-container {
  position: relative;
  width: 94%;
  overflow: hidden;
  margin-bottom: 0.5rem;
  margin-left: 3%;
}
.span-bar-container,
.span-name {
  height: 1.5rem;
  line-height: 1.5rem;
}
.span-name {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  z-index: 2;
  padding-left: 0.5rem;
}
.span-bar {
  position: absolute;
  top: 0;
  height: 100%;
  background: #017fc0dd;
  z-index: 1;
}
</style>
