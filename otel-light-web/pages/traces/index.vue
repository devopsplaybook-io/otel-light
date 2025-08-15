<template>
  <div id="object-layout">
    <input
      id="object-search"
      type="search"
      v-model="searchFilter"
      placeholder="Search"
      aria-label="Search"
      v-on:input="filterChanged"
    />
    <div v-for="trace of tracesStore.traces" :key="trace.traceId">
      <Trace
        @click="toggleTrace(trace.traceId)"
        style="cursor: pointer"
        :trace="trace"
      />
      <TraceSpan
        v-if="traceSpans[trace.traceId]"
        :trace="trace"
        :traceSpans="traceSpans[trace.traceId]"
      />
    </div>
  </div>
</template>

<script setup>
const tracesStore = TracesStore();
</script>

<script>
import { debounce } from "lodash";
import { AuthService } from "~~/services/AuthService";
import { RefreshIntervalService } from "~~/services/RefreshIntervalService";
import Config from "~~/services/Config";
import axios from "axios";

export default {
  data() {
    return {
      objectType: "pod",
      searchFilter: "",
      refreshIntervalId: null,
      refreshIntervalValue: RefreshIntervalService.get(),
      traceSpans: {},
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
    this.refreshIntervalValue = RefreshIntervalService.get();
    TracesStore().getTraces();
  },
  mounted() {
    const interval = parseInt(this.refreshIntervalValue, 10);
  },
  beforeUnmount() {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
  },
  watch: {
    objectType(newType) {
      const router = useRouter();
      const route = useRoute();
      router.replace({
        path: route.path,
        query: {
          ...route.query,
          objectType: newType,
          ...(this.searchFilter ? { search: this.searchFilter } : {}),
        },
      });
    },
    searchFilter(newFilter) {
      const router = useRouter();
      const route = useRoute();
      const query = { ...route.query, objectType: this.objectType };
      if (newFilter) {
        query.search = newFilter;
      } else {
        delete query.search;
      }
      router.replace({
        path: route.path,
        query,
      });
    },
  },
  methods: {
    async getTraceSpans(traceId) {
      return await axios
        .get(
          `${
            (
              await Config.get()
            ).SERVER_URL
          }/analytics/traces/${traceId}/spans`,
          await AuthService.getAuthHeader()
        )
        .then((response) => {
          return response.data.spans;
        });
    },
    async toggleTrace(traceId) {
      if (this.traceSpans[traceId]) {
        delete this.traceSpans[traceId];
      } else {
        if (!this.traceSpans[traceId]) {
          const spans = await this.getTraceSpans(traceId);
          this.traceSpans[traceId] = spans;
        }
      }
    },
    refreshObject() {
      KubernetesObjectStore().refreshLast();
    },
    filterChanged: debounce(async function (e) {
      KubernetesObjectStore().setFilter(this.searchFilter);
    }, 500),
  },
};
</script>

<style>
select {
  padding: 0.5em 1em;
  height: 2.6rem;
}
#object-layout {
  display: grid;
  max-height: 100%;
  height: auto;
  grid-template-rows: auto auto 1fr;
}
#object-actions {
  display: grid;
  grid-template-columns: 1fr auto;
}
#object-actions span {
  padding-top: 0.3rem;
}
#object-search {
  padding-top: 0.5em;
  padding-bottom: 0.5em;
  padding-left: 3em;
  height: 2.6rem;
}

#object-list {
  overflow-x: auto;
  overflow-y: auto;
  height: 100%;
  width: 100%;
}
#object-list td {
  white-space: nowrap;
}

#object-list td,
#object-list pre,
#object-list div,
#object-list span,
#object-list p {
  font-size: 0.9em;
}
</style>
