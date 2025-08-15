<template>
  <div>work in progress</div>
</template>

<script>
export default {
  data() {
    return {};
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
  },
  mounted() {},
  beforeUnmount() {},
  watch: {},
  methods: {},
};
</script>

<style scoped></style>
