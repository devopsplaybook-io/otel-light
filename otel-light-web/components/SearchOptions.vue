<template>
  <div id="search-options">
    <input
      type="search"
      v-model="keywords"
      placeholder="Search"
      aria-label="Search"
      @input="emitFilterChanged"
    />
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
export default {
  name: "SearchOptions",
  emits: ["filterChanged"],
  data() {
    return {
      keywords: "",
      from: 30 * 60, // 10 min ago (in seconds)
      to: 0, // now (0 seconds ago)
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
        { label: "5 days ago", value: 3 * 24 * 60 * 60 },
        { label: "10 days ago", value: 3 * 24 * 60 * 60 },
        { label: "30 days ago", value: 3 * 24 * 60 * 60 },
        { label: "90 days ago", value: 90 * 24 * 60 * 60 },
        { label: "180 days ago", value: 180 * 24 * 60 * 60 },
        { label: "1 year ago", value: 365 * 24 * 60 * 60 },
        { label: "all", value: 99999 * 24 * 60 * 60 },
      ],
    };
  },
  created() {
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

      const queryString = new URLSearchParams(params).toString();

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
#search-options input {
  padding-top: 0.5em;
  padding-bottom: 0.5em;
  height: 2.6rem;
}
#search-options-dates {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.5rem;
}
#search-options-dates span {
  padding-bottom: 0.6rem;
}
select {
  padding: 0.5em 1em;
  height: 2.6rem;
}
</style>
