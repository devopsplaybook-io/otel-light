<template>
  <div id="search-options" :class="{ 'filters-collapsed': !filtersExpanded }">
    <div class="search-keywords">
      <input
        type="search"
        v-model="keywords"
        placeholder="Search"
        aria-label="Search"
        @input="onKeywordsInput"
      />
      <span class="search-button" @click="onRefreshClick" title="Refresh">
        <i
          class="bi bi-arrow-clockwise"
          :class="{ spinning: isRefreshing }"
        ></i>
      </span>
      <span
        class="search-button collapse-button"
        @click="toggleFilters"
        :title="filtersExpanded ? 'Collapse filters' : 'Expand filters'"
      >
        <i
          :class="filtersExpanded ? 'bi bi-chevron-up' : 'bi bi-chevron-down'"
        ></i>
      </span>
    </div>
    <div v-if="type === 'traces' && name" class="search-chips">
      <span class="search-chip" :title="`Exact trace name: ${name}`">
        <span class="search-chip-text">name: <strong>{{ name }}</strong></span>
        <button
          type="button"
          class="search-chip-clear"
          aria-label="Clear name filter"
          title="Clear name filter"
          @click="clearName"
        >
          <i class="bi bi-x" aria-hidden="true"></i>
        </button>
      </span>
    </div>
    <div class="search-collapsible" :class="{ collapsed: !filtersExpanded }">
      <div class="search-attributes">
        <select
          class="filter-select filter-service"
          v-model="serviceName"
          @change="onServiceNameChange"
        >
          <option value="">All Services</option>
          <option v-for="svc in servicesStore.services" :key="svc" :value="svc">
            {{ svc }}
          </option>
        </select>
        <select
          v-if="type !== 'metrics'"
          class="filter-select filter-service-version"
          v-model="serviceVersion"
          :disabled="!serviceName"
          @change="emitFilterChanged"
        >
          <option value="">Any Version</option>
          <option v-for="ver in availableVersions" :key="ver" :value="ver">
            {{ ver }}
          </option>
        </select>
        <select
          class="filter-select filter-status-error"
          v-if="type === 'traces'"
          v-model="errorsOnly"
          @change="emitFilterChanged"
        >
          <option value="">Any Status</option>
          <option value="true">Errors</option>
        </select>
        <select
          class="filter-select filter-status-severity"
          v-if="type === 'logs'"
          v-model="severity"
          @change="emitFilterChanged"
        >
          <option value="">Any Severity</option>
          <option value="TRACE">Trace</option>
          <option value="DEBUG">Debug</option>
          <option value="INFO">Info</option>
          <option value="WARN">Warn</option>
          <option value="ERROR">Error</option>
          <option value="FATAL">Fatal</option>
        </select>
      </div>
      <div id="search-options-dates">
        <select v-model="from" @change="emitFilterChanged">
          <option
            v-for="option in timeOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
        <span><i class="bi bi-chevron-double-right" /></span>
        <select v-model="to" @change="emitFilterChanged">
          <option
            v-for="option in timeOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </div>
    </div>
  </div>
</template>

<script>
import {
  TimeWindowOptions,
  getDefaultTimeWindow,
} from "~/services/PreferencesService";
import { ServicesStore } from "~/stores/ServicesStore";
export default {
  name: "SearchOptions",
  emits: ["filterChanged"],
  props: {
    type: {
      type: String,
      default: "traces",
    },
  },
  setup() {
    const servicesStore = ServicesStore();
    servicesStore.startAutoRefresh();
    return { servicesStore };
  },
  data() {
    const defaultFrom = getDefaultTimeWindow(this.type);
    const savedExpanded = localStorage.getItem("searchOptions.filtersExpanded");
    return {
      keywords: "",
      from: defaultFrom,
      to: 0,
      errorsOnly: "",
      severity: "",
      serviceName: "",
      serviceVersion: "",
      name: "",
      filtersExpanded: savedExpanded === null ? true : savedExpanded === "true",
      isRefreshing: false,
    };
  },
  computed: {
    timeOptions() {
      return TimeWindowOptions;
    },
    availableVersions() {
      if (!this.serviceName) return [];
      return this.servicesStore.versionsForService(this.serviceName);
    },
  },
  created() {
    const query = this.$route.query;
    if (query.keywords) this.keywords = query.keywords;
    if (query.from && !isNaN(parseInt(query.from, 10)))
      this.from = parseInt(query.from, 10);
    if (query.to && !isNaN(parseInt(query.to, 10)))
      this.to = parseInt(query.to, 10);
    if (query.errorsOnly === "true") this.errorsOnly = "true";
    if (query.severity) this.severity = query.severity;
    if (query.serviceName) this.serviceName = query.serviceName;
    if (query.serviceVersion) this.serviceVersion = query.serviceVersion;
    if (this.type === "traces" && query.name) this.name = query.name;
    this.emitFilterChanged = this._debounce(
      this.emitFilterChangedRaw.bind(this),
      500,
    );
    this.emitFilterChangedRaw();
  },
  methods: {
    _debounce(fn, delay) {
      let timer = null;
      return function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          fn(...args);
          timer = null;
        }, delay);
      };
    },
    onServiceNameChange() {
      this.serviceVersion = "";
      this.emitFilterChanged();
    },
    // Editing the free-text keywords starts a new search scope, so an exact
    // trace-name drilldown no longer applies.
    onKeywordsInput() {
      if (this.name) {
        this.name = "";
      }
      this.emitFilterChanged();
    },
    clearName() {
      this.name = "";
      this.emitFilterChangedRaw();
    },
    emitFilterChangedRaw() {
      function toNanoseconds(secondsAgo) {
        if (!secondsAgo) return 0;
        const nowNs = Date.now() * 1e6;
        return nowNs - secondsAgo * 1e9;
      }

      const params = {};
      if (this.keywords) {
        params.keywords = this.keywords;
      }

      const fromNs = toNanoseconds(this.from);
      const toNs = toNanoseconds(this.to);

      if (fromNs > 0) params.from = fromNs;
      if (toNs > 0) params.to = toNs;
      if (this.errorsOnly === "true") params.errorsOnly = "true";
      if (this.severity) params.severity = this.severity;
      if (this.serviceName) params.serviceName = this.serviceName;
      if (this.serviceVersion && this.type !== "metrics")
        params.serviceVersion = this.serviceVersion;
      if (this.type === "traces" && this.name) params.name = this.name;

      const queryString = new URLSearchParams(params).toString();

      const urlQuery = {};
      if (this.keywords) urlQuery.keywords = this.keywords;
      if (this.from) urlQuery.from = String(this.from);
      if (this.to) urlQuery.to = String(this.to);
      if (this.errorsOnly === "true") urlQuery.errorsOnly = "true";
      if (this.severity) urlQuery.severity = this.severity;
      if (this.serviceName) urlQuery.serviceName = this.serviceName;
      if (this.serviceVersion && this.type !== "metrics")
        urlQuery.serviceVersion = this.serviceVersion;
      if (this.type === "traces" && this.name) urlQuery.name = this.name;
      this.$router.replace({ query: urlQuery }).catch(() => {});

      this.$emit("filterChanged", {
        queryString,
      });
    },
    emitFilterChanged() {
      // Placeholder, replaced in created() with debounced version
    },
    toggleFilters() {
      this.filtersExpanded = !this.filtersExpanded;
      localStorage.setItem(
        "searchOptions.filtersExpanded",
        String(this.filtersExpanded),
      );
    },
    onRefreshClick() {
      this.isRefreshing = true;
      setTimeout(() => {
        this.isRefreshing = false;
      }, 600);
      this.emitFilterChangedRaw();
    },
  },
};
</script>

<style scoped>
#search-options {
  display: grid;
  grid-template-rows: auto auto;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.88em;
  margin-bottom: 1rem;
}
#search-options.filters-collapsed {
  gap: 0;
  margin-bottom: 0.35rem;
}
#search-options input,
#search-options select {
  padding-top: 0.3em;
  padding-bottom: 0.3em;
  height: 2.1rem;
  font-size: 1em;
  margin-bottom: 0.3rem;
}
#search-options input,
#search-options select {
  width: 100%;
}
.search-keywords {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 1rem;
}
.search-button {
  height: 2.1rem;
  font-size: 1.3em;
  padding-right: 0.5rem;
  padding-top: 0.3rem;
}
#search-options-dates {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.35rem;
}
#search-options-dates span {
  padding-bottom: 0.4rem;
}
.filter-service-version:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.search-attributes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(6rem, auto));
  gap: 0.5rem;
}
.search-collapsible {
  display: grid;
  max-height: 200px;
  overflow: hidden;
  transition:
    max-height 0.3s ease,
    opacity 0.3s ease;
  opacity: 1;
}
.search-collapsible.collapsed {
  max-height: 0;
  opacity: 0;
}
.collapse-button {
  padding-right: 0;
}
.search-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding-bottom: 0.3rem;
}
.search-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.1rem 0.5rem;
  border: 1px solid #dfe3eb88;
  border-radius: 999px;
  font-size: 0.85em;
  background: #dfe3eb22;
}
.search-chip-text {
  max-width: 32rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-chip-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  width: 1.2rem;
  height: 1.2rem;
  margin: 0;
  border: none;
  border-radius: 50%;
  background: none;
  cursor: pointer;
  line-height: 1;
}
.search-chip-clear:hover {
  background: #dfe3eb55;
}
@keyframes spin-once {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.spinning {
  display: inline-block;
  animation: spin-once 0.6s ease;
}
</style>
