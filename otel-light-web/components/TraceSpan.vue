<template>
  <div class="trace-span-list">
    <div
      v-for="span of sortedTraceSpans"
      :key="span.spanId"
      class="span-bar-container"
    >
      <div class="span-name">
        {{ span.name }}
        <small>({{ span.durationText }})</small>
      </div>
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

function buildSpanTree(spans) {
  const spanMap = {};
  spans.forEach((span) => {
    span.children = [];
    spanMap[span.spanId] = span;
  });
  const roots = [];
  spans.forEach((span) => {
    if (span.parentSpanId && spanMap[span.parentSpanId]) {
      spanMap[span.parentSpanId].children.push(span);
    } else {
      roots.push(span);
    }
  });
  function flatten(spanList) {
    let result = [];
    spanList
      .sort((a, b) => a.startTime - b.startTime)
      .forEach((span) => {
        result.push(span);
        if (span.children && span.children.length > 0) {
          result = result.concat(flatten(span.children));
        }
      });
    return result;
  }
  return flatten(roots);
}

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
  computed: {
    sortedTraceSpans() {
      if (!this.traceSpans || !Array.isArray(this.traceSpans)) return [];
      // Clone to avoid mutating original
      const spans = this.traceSpans.map((span) => ({ ...span }));
      spans.forEach((span) => {
        span.startPercent = (
          (100 * (span.startTime - this.trace.startTime)) /
          (this.trace.endTime - this.trace.startTime)
        ).toFixed(0);
        span.endPercent = (
          (100 * (span.endTime - this.trace.startTime)) /
          (this.trace.endTime - this.trace.startTime)
        ).toFixed(0);
        if (span.endPercent === span.startPercent) {
          span.endPercent = span.endPercent + 1;
        }
        span.durationText = getDurationText(span.endTime - span.startTime);
      });
      return buildSpanTree(spans);
    },
  },
  methods: {},
};
</script>

<style>
.trace-span-list {
  padding-top: 1rem;
  padding-bottom: 0.5rem;
  margin-bottom: 0.5rem;
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
