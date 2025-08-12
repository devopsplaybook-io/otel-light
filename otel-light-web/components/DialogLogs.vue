<template>
  <div>
    <dialog id="dialog-details-logs" open>
      <article>
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            v-on:click="clickClose()"
          ></a>
          Pod Log: {{ podname }} ({{ namespace }})
        </header>
        <section>
          <label>
            <input type="checkbox" v-model="wrapText" />
            Wrap text
          </label>
          <select v-model="logTime" @change="fetchLogs">
            <option value="all">All</option>
            <option value="10m">Last 10min</option>
            <option value="1h">Last 1h</option>
            <option value="24h">Last 1 day</option>
          </select>
          <span class="actions"
            ><i class="bi bi-arrow-clockwise" v-on:click="fetchLogs"></i
          ></span>
        </section>
        <pre
          id="dialog-details-logs-text"
          :style="{ whiteSpace: wrapText ? 'pre-wrap' : 'pre' }"
          >{{ text }}</pre
        >
      </article>
    </dialog>
  </div>
</template>

<script>
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { UtilsDecompressData } from "~/services/Utils";
import axios from "axios";
import Config from "~~/services/Config.ts";

export default {
  props: {
    podname: "",
    namespace: "",
    title: "",
  },
  data() {
    return {
      text: "",
      wrapText: false,
      logTime: "all",
    };
  },
  async created() {
    await this.fetchLogs();
  },
  methods: {
    async clickClose(namespace, podname) {
      this.$emit("onClose", {});
    },
    async fetchLogs() {
      const payload = { namespace: this.namespace, pod: this.podname };
      if (this.logTime !== "all") {
        payload.argument = `--since=${this.logTime}`;
      }
      this.text = "Loading logs...";
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/kubectl/logs`,
          payload,
          await AuthService.getAuthHeader()
        )
        .then(async (res) => {
          this.text = await UtilsDecompressData(res.data.result);
        })
        .catch(handleError);
    },
  },
};
</script>

<style scoped>
#dialog-details-logs article {
  min-width: 90dvw;
  height: 90dvh;
  display: grid;
  grid-template-rows: auto auto 1fr;
}
#dialog-details-logs-text {
  overflow: auto;
}
#dialog-details-logs section {
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-gap: 1rem;
  margin: 0;
  margin-bottom: 1rem;
  align-items: center;
}
#dialog-details-logs section select {
  margin: 0;
}
</style>
