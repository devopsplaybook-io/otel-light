<template>
  <div class="trace-span-list">
    <div
      v-for="(span, index) of sortedTraceSpans"
      :key="span.spanId"
      class="span-bar-container"
      :class="{
        'span-error':
          span.rawSpan && span.rawSpan.status && span.rawSpan.status.code !== 0,
      }"
    >
      <div
        v-if="span.parentSpanId && findParentIndex(span) !== -1"
        class="span-connector"
        :style="getConnectorStyle(span, index)"
      ></div>
      <div class="span-name">
        <i
          v-if="span.spanId == highlightSpanId"
          class="bi bi-arrow-right-circle"
        ></i>
        <kbd
          v-if="
            trace.serviceName != span.serviceName ||
            trace.serviceVersion != span.serviceVersion
          "
          class="span-service"
          >{{ span.serviceName }}:{{ span.serviceVersion }}</kbd
        >
        {{ span.name }}
        <small>({{ span.durationText }})</small>
        <i
          class="span-event-link bi bi-card-text"
          @click="showSpanDetails(span)"
        >
        </i>
      </div>
      <div
        class="span-bar"
        :style="{
          left: span.startPercent + '%',
          width: span.endPercent - span.startPercent + '%',
        }"
      ></div>
    </div>
    <dialog v-if="spanSelected" ref="eventsDialog" class="events-dialog">
      <article>
        <header>Span Details</header>
        <section>
          <kbd>trace.id: {{ spanSelected.rawSpan.traceId }}</kbd>
          <kbd>span.id: {{ spanSelected.rawSpan.spanId }}</kbd>
          <kbd
            v-for="attribute of spanSelected.rawSpan.attributes"
            :key="attribute.key"
            >{{ attribute.key }}:
            {{
              attribute.value.stringValue
                ? attribute.value.stringValue
                : attribute.value.intValue
                ? attribute.value.intValue
                : ""
            }}</kbd
          >
          <p
            v-if="
              spanSelected.rawSpan.events &&
              spanSelected.rawSpan.events.length > 0
            "
          >
            Events for Span:
          </p>
          <pre
            v-for="(event, index) in spanSelected.rawSpan.events"
            :key="index"
            >{{ getSpanEventText(event) }}</pre
          >
          <p v-if="getSpanLogText(spanSelected)">Logs for Span:</p>
          <pre>{{ getSpanLogText(spanSelected) }}</pre>
        </section>
        <footer>
          <button @click="closeEventsDialog">Close</button>
        </footer>
      </article>
    </dialog>
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
    traceLogs: {
      type: Object,
      default: null,
    },
    highlightSpanId: {
      type: String,
      default: null,
    },
  },
  data() {
    return {
      durationText: "",
      spanSelected: null,
    };
  },
  computed: {
    sortedTraceSpans() {
      if (!this.traceSpans || !Array.isArray(this.traceSpans)) return [];
      const minTime = Math.min(
        ...this.traceSpans.map((span) => span.startTime)
      );
      const maxTime = Math.max(...this.traceSpans.map((span) => span.endTime));
      const spans = this.traceSpans.map((span) => ({ ...span }));
      spans.forEach((span) => {
        span.startPercent = (
          (100 * (span.startTime - minTime)) /
          (maxTime - minTime)
        ).toFixed(0);
        span.endPercent = (
          (100 * (span.endTime - minTime)) /
          (maxTime - minTime)
        ).toFixed(0);
        if (span.endPercent === span.startPercent) {
          span.endPercent = Number(span.endPercent) + 0.5;
        }
        span.durationText = getDurationText(span.endTime - span.startTime);
      });
      return buildSpanTree(spans);
    },
  },
  methods: {
    findParentIndex(span) {
      if (!span.parentSpanId) return -1;
      return this.sortedTraceSpans.findIndex(
        (s) => s.spanId === span.parentSpanId
      );
    },
    getConnectorStyle(span, currentIndex) {
      const parentIndex = this.findParentIndex(span);
      if (parentIndex === -1) return {};
      const lineHeight = 1.5;
      const marginBottom = 0.5;
      const height = (currentIndex - parentIndex) * (lineHeight + marginBottom);
      return {
        left: `${span.startPercent}%`,
        height: height + "rem",
        top: -height + "rem",
      };
    },
    showSpanDetails(span) {
      this.spanSelected = span;
      this.$nextTick(() => {
        if (this.$refs.eventsDialog) {
          this.$refs.eventsDialog.showModal();
        }
      });
    },
    closeEventsDialog() {
      if (this.$refs.eventsDialog) {
        this.$refs.eventsDialog.close();
      }
      this.spanSelected = null;
    },
    getSpanEventText(event) {
      let text = event.name + "\n";
      for (const attribute of event.attributes) {
        text += `  ${attribute.key}: ${attribute.value.stringValue}\n`;
      }
      return text;
    },
    getSpanEventText(event) {
      let text = event.name + "\n";
      for (const attribute of event.attributes) {
        text += `  ${attribute.key}: ${attribute.value.stringValue}\n`;
      }
      return text;
    },
    getSpanLogText(span) {
      let text = "";
      for (const log of this.traceLogs) {
        if (log.spanId !== span.spanId) {
          continue;
        }
        text +=
          new Date(log.time / 1_000_000).toISOString() +
          ": " +
          log.logText +
          "\n";
      }
      return text;
    },
  },
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
  margin-bottom: 0.5rem;
  margin-left: 1rem;
  margin-right: 1rem;
  overflow: visible;
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
.span-error .span-bar {
  background: #d93526;
}
.span-event-link {
  margin-left: 0.5em;
  cursor: pointer;
}
.span-connector {
  position: absolute;
  z-index: 0;
  opacity: 0.5;
  border-left: 1px dashed red;
  width: 2px;
}

.events-dialog pre {
  word-break: break-all;
  white-space: pre-wrap;
  max-width: 90vw;
  overflow-wrap: anywhere;
}

.span-service {
  opacity: 0.5;
  font-size: 0.5rem;
}
</style>
