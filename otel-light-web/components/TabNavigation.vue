<template>
  <div class="tab-navigation">
    <NuxtLink
      v-for="tab in visibleTabs"
      :key="tab.id"
      :to="{ path: tab.to, query: route.query }"
      :class="['tab', { active: isActive(tab) }]"
    >
      <span class="tab-label">{{ tab.label }}</span>
    </NuxtLink>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";

const props = defineProps({
  tabs: {
    type: Array,
    required: true,
  },
});

const route = useRoute();

const visibleTabs = computed(() => {
  if (!props.tabs) return [];
  return props.tabs.filter((tab) => {
    if (typeof tab.show === "function") return tab.show();
    return tab.show !== false;
  });
});

function normalizePath(path) {
  return String(path || "").replace(/\/+$/, "") || "/";
}

function isActive(tab) {
  const currentPath = normalizePath(route.path);
  const tabPath = normalizePath(tab.to);
  if (tab.exact) {
    return currentPath === tabPath;
  }
  return currentPath === tabPath || currentPath.startsWith(tabPath + "/");
}
</script>
