<script setup>
/**
 * /settings has no content of its own: it immediately lands on the first
 * settings tab (Profile). The redirect runs as a route middleware so it
 * happens before the route renders, with no flash of an empty shell.
 */
definePageMeta({
  middleware: [
    () => navigateTo("/settings/profile"),
  ],
});
</script>

<template>
  <div></div>
</template>
