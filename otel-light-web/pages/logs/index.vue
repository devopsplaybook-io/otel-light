<template>
  <div id="logs-page">
    <SearchOptions
      ref="searchOptions"
      @filterChanged="onFilterChanged"
      type="logs"
    />
    <div id="logs">
      <div class="log-summary">
        <b>Service</b>
        <b>Time</b>
        <b>Severity</b>
        <b>Log</b>
      </div>
      <div v-for="log of logs" :key="log.serviceName + log.time">
        <LazyLog :log="log" hydrate-on-visible />
      </div>
    </div>
  </div>
</template>

<script>
import axios from "axios";
import SearchOptions from "~/components/SearchOptions.vue";
import { UtilsDecompressJson } from "~/services/Utils";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";

export default {
  components: { SearchOptions },
  data() {
    return {
      logs: [],
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      logSpans: {},
      filter: {
        queryString: "",
      },
      selectedLog: null,
      fetchTime: null,
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
    this.refreshIntervalValue = RefreshIntervalService.get();
  },
  mounted() {
    const interval = parseInt(this.refreshIntervalValue, 10);
    if (interval > 0) {
      this.refreshIntervalId = setInterval(() => {
        if (
          this.$refs.searchOptions &&
          this.$refs.searchOptions.emitFilterChangedRaw
        ) {
          this.$refs.searchOptions.emitFilterChangedRaw();
        }
      }, interval);
    }
  },
  beforeUnmount() {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
  },
  methods: {
    onFilterChanged(filter) {
      this.filter.queryString = filter.queryString;
      this.fetchLogs();
    },
    async fetchLogs() {
      const fetchTime = new Date();
      this.fetchTime = fetchTime;
      const url = `${(await Config.get()).SERVER_URL}/analytics/logs${
        this.filter.queryString ? "?" + this.filter.queryString : ""
      }`;
      axios
        .get(url, await AuthService.getAuthHeader())
        .then(async (response) => {
          if (fetchTime < this.fetchTime) {
            return;
          }
          this.logs = await UtilsDecompressJson(response.data.logs);
          if (response.data.warning) {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              type: "warning",
              text: response.data.warning,
            });
          }
        })
        .catch(handleError);
    },
  },
};
</script>

<style>
.log-summary {
  min-width: 1200px;
  display: grid;
  grid-template-columns: 2fr 2fr 1fr 9fr;
  gap: 1rem;
  width: 100%;
}
.log-summary span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

<style scoped>
#logs-page {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
}

#logs {
  max-width: 100%;
  overflow-x: auto;
}

.log-expanded {
  background-color: #dfe3eb22;
}
.log-span-expanded {
  background-color: #dfe3eb11;
}
</style>
