<template>
  <div
    class="loading-indicator"
    :class="{ 'loading-indicator-small': size === 'small' }"
  ></div>
</template>

<script>
export default {
  props: {
    size: {
      type: String,
      default: "",
    },
  },
};
</script>

<style scoped>
.loading-indicator-small {
  width: 3rem !important;
  margin-top: 0.5rem !important;
  margin-bottom: 0.5rem !important;
}
</style>
