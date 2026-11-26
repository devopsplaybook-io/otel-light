<template>
  <AppUpdateNotice
    :visible="updateVisible"
    @reload="onReload"
    @later="onLater"
  />
</template>

<script setup>
import { computed, watch } from "vue";
import AppUpdateNotice from "@devopsplaybook.io/common-web/components/AppUpdateNotice.vue";
import { useAppUpdate } from "@devopsplaybook.io/common-web/composables/useAppUpdate";
import { createBuildVersionProbe } from "@devopsplaybook.io/common-web/services/BuildVersionProbe";

const { $pwa } = useNuxtApp();
const config = useRuntimeConfig();

// The query string keeps the probe URL out of the service-worker precache: a
// plain fetch would be answered by the active (old) worker with the stale
// manifest, so a new build would never be detected.
const fetchLatestBuildId = createBuildVersionProbe({
  manifestUrl: "/_nuxt/builds/latest.json?probe=1",
});

const { updateAvailable, reload, dismiss } = useAppUpdate({
  currentBuildId: String(config.app.buildId ?? ""),
  fetchLatestBuildId,
});

const serviceWorkerUpdate = computed(() => Boolean($pwa?.needRefresh));
const updateVisible = computed(
  () => updateAvailable.value || serviceWorkerUpdate.value,
);

// A new build ships a new sw.js: ask the browser to fetch it so a waiting
// worker (and $pwa.needRefresh) appears.
watch(updateVisible, (visible) => {
  if (visible) void refreshServiceWorker();
});

async function refreshServiceWorker() {
  const registration = await navigator.serviceWorker?.getRegistration();
  await registration?.update();
}

async function onReload() {
  const registration = navigator.serviceWorker
    ? await navigator.serviceWorker.getRegistration()
    : undefined;
  if (registration?.waiting && $pwa?.updateServiceWorker) {
    // Activates the waiting worker and reloads exactly once.
    await $pwa.updateServiceWorker(true);
    return;
  }
  // No waiting worker yet (probe-only detection): plain shared reload.
  await reload();
}

async function onLater() {
  await $pwa?.cancelPrompt();
  dismiss();
}
</script>
