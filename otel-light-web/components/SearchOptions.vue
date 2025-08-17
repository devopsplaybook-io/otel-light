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
      <input
        type="number"
        min="0"
        v-model.number="fromValue"
        @input="emitFilterChanged"
      />
      <select v-model="fromUnit" @change="emitFilterChanged">
        <option value="minutes">min. ago</option>
        <option value="hours">h ago</option>
        <option value="days">days ago</option>
      </select>
      <span><i class="bi bi-chevron-double-right" /></span>
      <input
        type="number"
        min="0"
        v-model.number="toValue"
        @input="emitFilterChanged"
      />
      <select v-model="toUnit" @change="emitFilterChanged">
        <option value="minutes">min. ago</option>
        <option value="hours">h ago</option>
        <option value="days">days ago</option>
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
      fromValue: 10,
      fromUnit: "minutes",
      toValue: 0,
      toUnit: "minutes",
    };
  },
  created() {
    // Bind debounced version to instance
    this.emitFilterChanged = debounce(this.emitFilterChangedRaw, 500);
    this.emitFilterChangedRaw();
  },
  methods: {
    emitFilterChangedRaw() {
      function toNanoseconds(value, unit) {
        if (!value) return 0;
        const multipliers = {
          minutes: 60,
          hours: 60 * 60,
          days: 24 * 60 * 60,
        };
        const secondsAgo = value * (multipliers[unit] || 1);
        const nowNs = Date.now() * 1e6;
        return nowNs - secondsAgo * 1e9;
      }

      const params = {};
      if (this.keywords) {
        params.keywords = this.keywords;
      }

      const fromNs = toNanoseconds(this.fromValue, this.fromUnit);
      const toNs = toNanoseconds(this.toValue, this.toUnit);

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
  grid-template-columns: 1fr auto auto 1fr auto;
  align-items: center;
  gap: 0.5rem;
}
select {
  padding: 0.5em 1em;
  height: 2.6rem;
}
</style>
