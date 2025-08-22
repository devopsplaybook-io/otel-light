<template></template>

<script>
export default {
  data() {
    return {};
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
    useRouter().push({ path: "/settings/maintenance" });
  },
  methods: {},
};
</script>

<style>
.delete-rule-row {
  display: grid;
  grid-template-columns: auto 1fr auto 2fr auto;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
</style>

<style scoped>
#settings-page {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
}

#settings {
  max-width: 100%;
  overflow-x: auto;
}

#settings button {
  margin-right: 0.5rem;
}

#settings input,
#settings select,
#settings select,
#settings option {
  font-size: 0.8rem;
}
#settings input {
  padding: 0.5rem 0.5rem;
}
#settings select {
  padding: 0.5rem 1.3rem 0.5rem 0.5rem;
}

.log-expanded {
  background-color: #dfe3eb22;
}
.log-span-expanded {
  background-color: #dfe3eb11;
}
</style>
