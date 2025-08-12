<template>
  <div class="page"></div>
</template>

<script>
export default {
  data() {
    return {};
  },
  async created() {
    if (await AuthenticationStore().ensureAuthenticated()) {
      useRouter().push({ path: "/kubernetes" });
    } else {
      useRouter().push({ path: "/users" });
    }
  },
};
</script>

<style scoped></style>
