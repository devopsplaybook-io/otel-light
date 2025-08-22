<template>
  <div>
    <div v-for="message in messages" v-bind:key="message.text">
      <div :class="'message message-' + message.type">
        <b>{{ message.type }}</b>
        {{ message.text }}
      </div>
    </div>
  </div>
</template>

<script>
import { EventBus, EventTypes } from "../services/EventBus";

export default {
  name: "AlertMessages",
  data() {
    return {
      messages: [],
    };
  },
  async created() {
    EventBus.on(EventTypes.ALERT_MESSAGE, (message) => {
      this.messages.push(message);
      setTimeout(() => {
        this.messages.splice(0, 1);
      }, 5000);
    });
  },
};
</script>
<style>
.message {
  padding: 1rem;
  margin: 1rem;
  color: #eee;
}
.message {
  background-color: #546e7a;
}
.message-info {
  background-color: #43a047;
}
.message-error {
  background-color: #e53935;
}
</style>
