<template>
  <div class="log-summary">
    <span
      >{{ this.log.serviceName
      }}{{ this.log.serviceVersion ? ":" + this.log.serviceVersion : "" }}</span
    >
    <span>{{ new Date(this.log.time / 1_000_000).toLocaleString() }}</span>
    <span>{{ this.log.severity }}</span>
    <span @click="showLogDialog" style="cursor: pointer">{{
      this.log.logText
    }}</span>
    <dialog ref="logDialog" class="log-dialog">
      <article>
        <header>Log Details</header>
        <section>
          <pre>{{ log.logText }}</pre>
        </section>
        <footer>
          <button @click.stop="closeLogDialog">Close</button>
        </footer>
      </article>
    </dialog>
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
  methods: {
    showLogDialog(event) {
      if (event) event.stopPropagation();
      this.$refs.logDialog.showModal();
    },
    closeLogDialog() {
      this.$refs.logDialog.close();
    },
  },
};
</script>

<style>
.log-dialog pre {
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
