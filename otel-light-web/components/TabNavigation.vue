<template>
  <div class="tab-navigation">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.id"
      :to="{ path: tab.to, query: route.query }"
      :class="['tab', { active: isActive(tab) }]"
    >
      <span class="tab-label">{{ tab.label }}</span>
    </NuxtLink>
  </div>
</template>

<script setup>
import { useRoute } from "vue-router";

defineProps({
  tabs: {
    type: Array,
    required: true,
  },
});

const route = useRoute();

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
