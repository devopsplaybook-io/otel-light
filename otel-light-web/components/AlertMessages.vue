<template>
  <div>
    <div v-for="message in messages" v-bind:key="message.id">
      <div :class="'message message-' + message.type">
        <b>{{ message.type }}</b>
        {{ message.text }}
      </div>
    </div>
  </div>
</template>

<script>
import { EventBus, EventTypes } from "../services/EventBus";

const DISMISS_DELAY_MS = 5000;

export default {
  name: "AlertMessages",
  data() {
    return {
      messages: [],
    };
  },
  created() {
    this._nextMessageId = 0;
    this._dismissTimers = new Map();
    this._onAlertMessage = (message) => {
      const entry = { ...message, id: this._nextMessageId++ };
      this.messages.push(entry);
      const timer = setTimeout(() => this.removeMessage(entry), DISMISS_DELAY_MS);
      this._dismissTimers.set(entry.id, timer);
    };
    EventBus.on(EventTypes.ALERT_MESSAGE, this._onAlertMessage);
  },
  beforeUnmount() {
    EventBus.off(EventTypes.ALERT_MESSAGE, this._onAlertMessage);
    for (const timer of this._dismissTimers.values()) {
      clearTimeout(timer);
    }
    this._dismissTimers.clear();
  },
  methods: {
    removeMessage(message) {
      const index = this.messages.indexOf(message);
      if (index !== -1) {
        this.messages.splice(index, 1);
      }
      const timer = this._dismissTimers.get(message.id);
      if (timer) {
        clearTimeout(timer);
      }
      this._dismissTimers.delete(message.id);
    },
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
