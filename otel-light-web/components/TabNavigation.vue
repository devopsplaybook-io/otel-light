<template>
  <div class="tab-navigation">
    <NuxtLink
      v-for="tab in visibleTabs"
      :key="tab.id"
      :to="tab.to"
      :class="['tab', { active: isActive(tab) }]"
    >
      {{ tab.label }}
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

function isActive(tab) {
  return route.path === tab.to || route.path.startsWith(tab.to + "/");
}
</script>
