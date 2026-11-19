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
      <div class="saved-views" v-if="type !== 'metrics'">
        <select
          v-model="selectedViewId"
          class="filter-select saved-view-select"
          @change="onSavedViewSelected"
          aria-label="Saved views"
        >
          <option value="">Saved views…</option>
          <option v-for="view in savedViews" :key="view.id" :value="view.id">
            {{ view.name }}{{ view.shared ? " (shared)" : "" }}
          </option>
        </select>
        <input
          v-model="savedViewName"
          class="saved-view-name"
          placeholder="View name"
          aria-label="View name"
        />
        <label class="inline-check">
          <input type="checkbox" v-model="savedViewShared" /> Shared
        </label>
        <button
          type="button"
          class="secondary compact-button"
          :disabled="!savedViewName.trim()"
          @click="saveCurrentView"
        >
          Save
        </button>
        <button
          type="button"
          class="secondary compact-button"
          v-if="selectedViewOwned"
          @click="renameSelectedView"
        >
          Rename
        </button>
        <button
          type="button"
          class="secondary compact-button"
          v-if="selectedViewOwned"
          @click="deleteSelectedView"
        >
          Delete
        </button>
      </div>
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
          class="filter-select filter-status-code"
          v-if="type === 'traces'"
          v-model="status"
          @change="emitFilterChanged"
        >
          <option value="">Root status: any</option>
          <option value="unset">Unset</option>
          <option value="ok">OK</option>
          <option value="error">Error</option>
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
      <div class="attribute-filters" v-if="type !== 'metrics'">
        <div
          v-for="(attribute, index) in attributes"
          :key="index"
          class="attribute-row"
        >
          <input
            v-model="attribute.key"
            class="attribute-key"
            placeholder="Attribute key"
            aria-label="Attribute key"
            @input="emitFilterChanged"
          />
          <select
            v-model="attribute.operator"
            class="attribute-operator"
            aria-label="Attribute operator"
            @change="onAttributeOperatorChange(attribute)"
          >
            <option value="=">=</option>
            <option value="!=">!=</option>
            <option value="contains">contains</option>
            <option value="exists">exists</option>
          </select>
          <input
            v-if="attribute.operator !== 'exists'"
            v-model="attribute.value"
            class="attribute-value"
            placeholder="Value"
            aria-label="Attribute value"
            @input="emitFilterChanged"
          />
          <span
            class="search-button remove-attribute"
            role="button"
            title="Remove attribute filter"
            @click="removeAttribute(index)"
          >
            <i class="bi bi-x-lg"></i>
          </span>
        </div>
        <button
          type="button"
          class="secondary compact-button add-attribute"
          @click="addAttribute"
        >
          <i class="bi bi-plus-lg"></i>&nbsp;Attribute
        </button>
        <div class="duration-filters" v-if="type === 'traces'">
          <input
            type="number"
            min="0"
            v-model="durationMin"
            placeholder="Min duration (ms)"
            aria-label="Minimum duration in milliseconds"
            @input="emitFilterChanged"
          />
          <input
            type="number"
            min="0"
            v-model="durationMax"
            placeholder="Max duration (ms)"
            aria-label="Maximum duration in milliseconds"
            @input="emitFilterChanged"
          />
        </div>
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
import { AuthService } from "~/services/AuthService";
import { SavedViewsService } from "~/services/SavedViewsService";
import {
  SearchQueryEmptyState,
  SearchQueryFromRouteQuery,
  SearchQueryStateFromParams,
  SearchQueryToParams,
  SearchQueryToRouteQuery,
} from "~/services/SearchQuery";
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
      status: "",
      serviceName: "",
      serviceVersion: "",
      durationMin: "",
      durationMax: "",
      attributes: [],
      savedViews: [],
      selectedViewId: "",
      savedViewName: "",
      savedViewShared: false,
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
    selectedView() {
      return this.savedViews.find(
        (view) => view.id === this.selectedViewId,
      );
    },
    selectedViewOwned() {
      const userId = AuthService.getTokenInfo()?.userId;
      return !!this.selectedView && !!userId && this.selectedView.userId === userId;
    },
  },
  created() {
    const query = this.$route.query;
    const state = SearchQueryFromRouteQuery(query, this.type);
    this.keywords = state.keywords;
    if (query.from) this.from = state.from;
    if (query.to) this.to = state.to;
    this.errorsOnly = state.errorsOnly ? "true" : "";
    this.severity = state.severity;
    this.status = state.status;
    this.serviceName = state.serviceName;
    this.serviceVersion = state.serviceVersion;
    this.name = state.name;
    this.durationMin = state.durationMin;
    this.durationMax = state.durationMax;
    this.attributes = state.attributes;
    this.emitFilterChanged = this._debounce(
      this.emitFilterChangedRaw.bind(this),
      500,
    );
    this.emitFilterChangedRaw();
  },
  async mounted() {
    await this.loadSavedViews();
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
    onAttributeOperatorChange(attribute) {
      if (attribute.operator === "exists") {
        attribute.value = "";
      }
      this.emitFilterChanged();
    },
    addAttribute() {
      this.attributes.push({ key: "", operator: "=", value: "" });
    },
    removeAttribute(index) {
      this.attributes.splice(index, 1);
      this.emitFilterChanged();
    },
    currentState() {
      return {
        ...SearchQueryEmptyState(),
        keywords: this.keywords,
        from: this.from,
        to: this.to,
        errorsOnly: this.errorsOnly === "true",
        severity: this.severity,
        status: this.status,
        serviceName: this.serviceName,
        serviceVersion: this.serviceVersion,
        name: this.type === "traces" ? this.name : "",
        durationMin: this.durationMin,
        durationMax: this.durationMax,
        attributes: this.attributes
          .filter((attribute) => attribute.key)
          .map((attribute) => ({ ...attribute })),
      };
    },
    emitFilterChangedRaw() {
      const state = this.currentState();
      const params = SearchQueryToParams(state, this.type);
      const queryString = params.toString();
      this.$router
        .replace({ query: SearchQueryToRouteQuery(state, this.type) })
        .catch(() => {});
      this.$emit("filterChanged", { queryString });
    },
    emitFilterChanged() {
      // Placeholder, replaced in created() with debounced version
    },
    async loadSavedViews() {
      if (this.type === "metrics" || !AuthService.isAuthenticated()) {
        return;
      }
      try {
        this.savedViews = await SavedViewsService.list(this.type);
      } catch {
        // Saved views are an optional convenience: keep the plain search
        // usable when the backend rejects the listing.
        this.savedViews = [];
      }
    },
    onSavedViewSelected() {
      const view = this.selectedView;
      if (!view) return;
      const state = SearchQueryStateFromParams(view.query, this.type);
      this.keywords = state.keywords;
      this.from = state.from || getDefaultTimeWindow(this.type);
      this.to = state.to;
      this.errorsOnly = state.errorsOnly ? "true" : "";
      this.severity = state.severity;
      this.status = state.status;
      this.serviceName = state.serviceName;
      this.serviceVersion = state.serviceVersion;
      this.name = state.name;
      this.durationMin = state.durationMin;
      this.durationMax = state.durationMax;
      this.attributes = state.attributes;
      this.savedViewName = view.name;
      this.savedViewShared = view.shared;
      this.emitFilterChangedRaw();
    },
    async saveCurrentView() {
      const name = this.savedViewName.trim();
      if (!name) return;
      try {
        const params = SearchQueryToParams(this.currentState(), this.type);
        const view = await SavedViewsService.create({
          name,
          signalType: this.type,
          query: params.toString(),
          shared: this.savedViewShared,
        });
        await this.loadSavedViews();
        this.selectedViewId = view.id;
      } catch (err) {
        this.reportViewError(err);
      }
    },
    async renameSelectedView() {
      if (!this.selectedView) return;
      const name = window.prompt("New view name", this.selectedView.name);
      if (!name || !name.trim()) return;
      try {
        await SavedViewsService.update(this.selectedView.id, {
          name: name.trim(),
          shared: this.savedViewShared,
        });
        await this.loadSavedViews();
        this.savedViewName = name.trim();
      } catch (err) {
        this.reportViewError(err);
      }
    },
    async deleteSelectedView() {
      if (!this.selectedView) return;
      if (!window.confirm(`Delete saved view "${this.selectedView.name}"?`)) {
        return;
      }
      try {
        await SavedViewsService.remove(this.selectedView.id);
        this.selectedViewId = "";
        this.savedViewName = "";
        this.savedViewShared = false;
        await this.loadSavedViews();
      } catch (err) {
        this.reportViewError(err);
      }
    },
    reportViewError() {
      this.savedViews = [];
      this.selectedViewId = "";
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
.saved-views {
  display: grid;
  grid-template-columns: minmax(8rem, 1.2fr) minmax(6rem, 1fr) auto auto auto auto;
  gap: 0.5rem;
  align-items: center;
}
.saved-views input[type="checkbox"] {
  width: auto;
  height: auto;
  margin: 0;
}
.inline-check {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  white-space: nowrap;
}
.compact-button {
  height: 2.1rem;
  margin: 0;
  padding: 0 0.7rem;
  font-size: 0.9em;
  white-space: nowrap;
}
.attribute-filters {
  display: block;
  margin-top: 0.4rem;
}
.attribute-row {
  display: grid;
  grid-template-columns: minmax(7rem, 1.3fr) 7rem minmax(7rem, 1.3fr) auto;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.4rem;
}
.attribute-row input,
.attribute-row select {
  width: 100%;
  margin-bottom: 0;
}
.add-attribute {
  margin-bottom: 0.4rem;
}
.duration-filters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  max-width: 26rem;
}
.duration-filters input {
  margin-bottom: 0.2rem;
}
.remove-attribute {
  padding-right: 0.3rem;
  cursor: pointer;
}
.search-collapsible {
  display: grid;
  max-height: 480px;
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
