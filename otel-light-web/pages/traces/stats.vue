<template>
  <div id="traces-page" class="signals-page">
    <ReportTabs :tabs="reports" :active="activeReport" @select="onTabSelect" />
    <NuxtPage />
    <button class="fab-button" @click="goToTraces" title="Go to Analytics">
      <i class="bi bi-arrow-return-left"></i>&nbsp;Back
    </button>
  </div>
</template>

<script>
import ReportTabs from "~/components/ReportTabs.vue";

export default {
  components: { ReportTabs },
  data() {
    return {
      reports: [
        { id: "aggregated", label: "Aggregated Traces" },
        { id: "longest", label: "Longest Traces" },
        { id: "most-called", label: "Most Called Traces" },
      ],
    };
  },
  computed: {
    activeReport() {
      const path = this.$route.path;
      if (path.endsWith("/longest")) return "longest";
      if (path.endsWith("/most-called")) return "most-called";
      return "aggregated";
    },
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
  },
  methods: {
    onTabSelect(tabId) {
      const pathMap = {
        aggregated: "/traces/stats",
        longest: "/traces/stats/longest",
        "most-called": "/traces/stats/most-called",
      };
      this.$router.push({ path: pathMap[tabId] });
    },
    goToTraces() {
      this.$router.push({ path: "/traces/", query: this.$route.query });
    },
  },
};
</script>

<style scoped></style>
