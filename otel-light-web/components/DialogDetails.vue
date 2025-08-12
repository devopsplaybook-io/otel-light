<template>
  <div>
    <dialog id="dialog-details" open>
      <article>
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            v-on:click="clickClose()"
          ></a>
          {{ title }}
        </header>
        <pre id="dialog-details-text">{{ text }}</pre>
      </article>
    </dialog>
  </div>
</template>

<script>
export default {
  props: {
    title: "",
    text: "",
  },
  data() {
    return {};
  },
  async created() {},
  methods: {
    async clickClose(namespace, podname) {
      this.$emit("onClose", {});
    },
  },
};
</script>

<style scoped>
#dialog-details article {
  min-width: 90dvw;
  height: 90dvh;
  display: grid;
  grid-template-rows: auto 1fr;
}
#dialog-details-text {
  overflow: auto;
}
</style>
