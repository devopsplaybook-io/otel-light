<template>
  <div id="search-options">
    <input
      type="search"
      v-model="keywords"
      placeholder="Search"
      aria-label="Search"
      @input="emitFilterChanged"
    />
    <div class="status-filter">
      <label v-if="type === 'traces'" class="filter-checkbox">
        <input
          type="checkbox"
          v-model="errorsOnly"
          @change="emitFilterChanged"
        />
        Errors only
      </label>
      <select
        class="filter-select"
        v-if="type === 'logs'"
        v-model="severity"
        @change="emitFilterChanged"
      >
        <option value="">All severities</option>
        <option value="TRACE">Trace</option>
        <option value="DEBUG">Debug</option>
        <option value="INFO">Info</option>
        <option value="WARN">Warn</option>
        <option value="ERROR">Error</option>
        <option value="FATAL">Fatal</option>
      </select>
    </div>
    <span class="search-button" @click="emitFilterChangedRaw" title="Refresh">
      <i class="bi bi-arrow-clockwise"></i>
    </span>
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
</template>

<script>
import { debounce } from "lodash";
import { getDefaultTimeWindow } from "~/services/PreferencesService";
export default {
  name: "SearchOptions",
  emits: ["filterChanged"],
  props: {
    type: {
      type: String,
      default: "traces",
    },
  },
  data() {
    const defaultFrom = getDefaultTimeWindow(this.type);
    return {
      keywords: "",
      from: defaultFrom,
      to: 0,
      errorsOnly: false,
      severity: "",
      timeOptions: [
        { label: "now", value: 0 },
        { label: "5 min ago", value: 5 * 60 },
        { label: "10 min ago", value: 10 * 60 },
        { label: "30 min ago", value: 30 * 60 },
        { label: "1 h ago", value: 1 * 60 * 60 },
        { label: "2 h ago", value: 2 * 60 * 60 },
        { label: "6 h ago", value: 6 * 60 * 60 },
        { label: "12 h ago", value: 12 * 60 * 60 },
        { label: "1 day ago", value: 24 * 60 * 60 },
        { label: "2 days ago", value: 2 * 24 * 60 * 60 },
        { label: "5 days ago", value: 5 * 24 * 60 * 60 },
        { label: "10 days ago", value: 10 * 24 * 60 * 60 },
        { label: "30 days ago", value: 30 * 24 * 60 * 60 },
        { label: "90 days ago", value: 90 * 24 * 60 * 60 },
        { label: "180 days ago", value: 180 * 24 * 60 * 60 },
        { label: "1 year ago", value: 365 * 24 * 60 * 60 },
        { label: "all", value: 99999 * 24 * 60 * 60 },
      ],
    };
  },
  created() {
    const query = this.$route.query;
    if (query.keywords) this.keywords = query.keywords;
    if (query.from && !isNaN(parseInt(query.from, 10)))
      this.from = parseInt(query.from, 10);
    if (query.to && !isNaN(parseInt(query.to, 10)))
      this.to = parseInt(query.to, 10);
    if (query.errorsOnly === "true") this.errorsOnly = true;
    if (query.severity) this.severity = query.severity;
    this.emitFilterChanged = debounce(this.emitFilterChangedRaw, 500);
    this.emitFilterChangedRaw();
  },
  methods: {
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
      if (this.errorsOnly) params.errorsOnly = "true";
      if (this.severity) params.severity = this.severity;

      const queryString = new URLSearchParams(params).toString();

      const urlQuery = {};
      if (this.keywords) urlQuery.keywords = this.keywords;
      if (this.from) urlQuery.from = String(this.from);
      if (this.to) urlQuery.to = String(this.to);
      if (this.errorsOnly) urlQuery.errorsOnly = "true";
      if (this.severity) urlQuery.severity = this.severity;
      this.$router.replace({ query: urlQuery }).catch(() => {});

      this.$emit("filterChanged", {
        queryString,
      });
    },
    emitFilterChanged() {
      // Placeholder, replaced in created() with debounced version
    },
  },
};
</script>

<style scoped>
#search-options {
  display: grid;
  grid-template-columns: 3fr auto auto;
  align-items: center;
  gap: 0.5rem;
}
#search-options input {
  padding-top: 0.5em;
  padding-bottom: 0.5em;
  height: 2.6rem;
}
.search-button {
  height: 2.6rem;
  padding: 0 0.5em;
  font-size: 1.2em;
}
#search-options-dates {
  grid-column: 1/-1;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.5rem;
}
#search-options-dates span {
  padding-bottom: 0.6rem;
}
.filter-checkbox {
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
  user-select: none;
}
.filter-checkbox input {
  margin: 0;
  margin-right: 0.5rem;
  width: 1.5rem;
  height: 1.5rem !important;
}
select {
  padding: 0.5em 1em;
  height: 2.6rem;
}
.status-filter {
  margin-left: 1rem;
  margin-right: 1rem;
}
.filter-select {
  width: 10rem;
}
</style>
