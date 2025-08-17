<template>
  <div class="log-summary">
    <span
      >{{ this.log.serviceName
      }}{{ this.log.serviceVersion ? ":" + this.log.serviceVersion : "" }}</span
    >
    <span>{{ new Date(this.log.time / 1_000_000).toLocaleString() }}</span>
    <span>{{ this.log.severity }}</span>
    <span>{{ this.log.logText }}</span>
  </div>
</template>

<script>
export default {
  props: {
    log: {
      type: Object,
      default: null,
    },
  },
  data() {
    return {};
  },
  async created() {},
  methods: {},
};
</script>

<style></style>
