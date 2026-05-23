<template>
  <div id="search-options" :class="{ 'filters-collapsed': !filtersExpanded }">
    <div class="search-keywords">
      <input
        type="search"
        v-model="keywords"
        placeholder="Search"
        aria-label="Search"
        @input="emitFilterChanged"
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
      filtersExpanded: savedExpanded === null ? true : savedExpanded === "true",
      isRefreshing: false,
    };
  },
  computed: {
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
