<template>
  <div class="log-summary">
    <span
      >{{ this.log.serviceName
      }}{{ this.log.serviceVersion ? ":" + this.log.serviceVersion : "" }}</span
    >
    <span>{{ new Date(this.log.time / 1_000_000).toLocaleString() }}</span>
    <span>{{ this.log.severity }}</span>
    <span @click="showLogDialog" style="cursor: pointer">{{
      this.log.logText
    }}</span>
    <dialog ref="logDialog" class="log-dialog">
      <article>
        <header>Log Details</header>
        <section>
          <pre>{{ log.logText }}</pre>
          <kbd v-for="attribute of log.attributes" :key="attribute.key"
            >{{ attribute.key }}: {{ attribute.value.stringValue }}</kbd
          >
          <div class="log-dialog-traces" v-if="trace">
            <LazyTrace
              :trace="trace"
              class="trace-expanded"
              hydrate-on-visible
            />
            <LazyTraceSpan
              v-if="traceSpans"
              :trace="trace"
              :traceSpans="traceSpans"
              :traceLogs="traceLogs"
              :highlightSpanId="logSpanId"
              class="trace-span-expanded"
              hydrate-on-visible
            />
          </div>
        </section>
        <footer>
          <button @click.stop="closeLogDialog">Close</button>
        </footer>
      </article>
    </dialog>
  </div>
</template>

<script>
import axios from "axios";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { UtilsDecompressJson } from "~/services/Utils";

export default {
  props: {
    log: {
      type: Object,
      default: null,
    },
  },
  data() {
    return {
      trace: null,
      traceSpans: [],
      isShowDialog: false,
      logSpanId: null,
      traceLogs: [],
    };
  },
  methods: {
    async showLogDialog(event) {
      this.isShowDialog = true;
      if (event) event.stopPropagation();
      this.$refs.logDialog.showModal();
      if (!this.log.attributes) {
        return;
      }
      const traceIdAttr = this.log.attributes.find(
        (attr) => attr.key === "trace.id"
      );
      const spanIdAttr = this.log.attributes.find(
        (attr) => attr.key === "span.id"
      );
      this.logSpanId =
        spanIdAttr && spanIdAttr.value.stringValue
          ? spanIdAttr.value.stringValue
          : null;
      if (traceIdAttr && traceIdAttr.value.stringValue) {
        await axios
          .get(
            `${(await Config.get()).SERVER_URL}/analytics/traces?traceId=${
              traceIdAttr.value.stringValue
            }`,
            await AuthService.getAuthHeader()
          )
          .then(async (response) => {
            const traces = await UtilsDecompressJson(response.data.traces);
            this.trace = traces && traces.length === 1 ? traces[0] : null;
            return axios.get(
              `${(await Config.get()).SERVER_URL}/analytics/traces/${
                traceIdAttr.value.stringValue
              }/spans`,
              await AuthService.getAuthHeader()
            );
          })
          .then(async (response) => {
            this.traceSpans = response.data.spans;
            return await axios.get(
              `${
                (
                  await Config.get()
                ).SERVER_URL
              }/analytics/traces/${traceId}/logs`,
              await AuthService.getAuthHeader()
            );
          })
          .then((response) => {
            return response.data.logs;
          })
          .catch(handleError);
      }
    },
    closeLogDialog() {
      this.isShowDialog = false;
      this.$refs.logDialog.close();
    },
  },
};
</script>

<style>
.log-dialog pre {
  white-space: pre-wrap;
  word-break: break-all;
}

.log-dialog kbd {
  font-size: 0.7em;
  margin-right: 0.5em;
  margin-bottom: 0.5em;
}
</style>
