<template>
  <div id="settings-page">
    <TabNavigation :tabs="visibleTabs" />
    <div class="settings-page-content">
      <NuxtPage />
    </div>
  </div>
</template>

<script setup>
import {
  resolveSettingsRedirect,
  visibleSettingsTabs,
} from "~~/services/SettingsTabs";

const route = useRoute();
const router = useRouter();
const authStore = AuthenticationStore();

const ready = ref(false);

const visibleTabs = computed(() => visibleSettingsTabs(authStore.isAdmin));

function enforceAccess() {
  if (!ready.value) return;
  const target = resolveSettingsRedirect(route.path, {
    isAuthenticated: authStore.isAuthenticated,
    isAdmin: authStore.isAdmin,
  });
  if (target) {
    router.push(target);
  }
}

onMounted(async () => {
  await authStore.ensureAuthenticated();
  ready.value = true;
  enforceAccess();
});

watch([() => route.path, () => authStore.isAdmin, ready], enforceAccess);
</script>

<style scoped>
/* Full-height shell: the tab bar stays pinned while the active settings page
   scrolls in the row below (same pattern as the signals pages). The content
   row must be `minmax(0, 1fr)`, not plain `1fr`: a `1fr` row has an implicit
   min-content minimum, so a page taller than the viewport (e.g. Profile)
   would expand the grid and crush the tab bar row down to its border,
   hiding the tabs. */
#settings-page {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
}

.settings-page-content {
  min-height: 0;
  overflow-y: auto;
}
</style>
