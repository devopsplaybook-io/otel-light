<template>
  <div id="settings-page">
    <TabNavigation :tabs="visibleTabs" />
    <NuxtPage />
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
#settings-page {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
}
</style>
