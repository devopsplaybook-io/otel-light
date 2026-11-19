<template>
  <div class="alert-history-table">
    <table v-if="events.length">
      <thead>
        <tr>
          <th>Time</th>
          <th>Rule</th>
          <th>Service</th>
          <th>Status</th>
          <th>Details</th>
          <th>Signals</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="event in events"
          :key="event.id"
          class="alert-history-row"
          :class="`alert-history-status-${event.status}`"
        >
          <td class="alert-history-time">{{ alertHistoryEventTime(event) }}</td>
          <td class="alert-history-rule">
            {{ event.ruleName || event.ruleId }}
          </td>
          <td class="alert-history-service">
            {{ event.serviceName || "All services" }}
          </td>
          <td>
            <span class="alert-history-status">
              {{ alertEventStatusLabel(event.status) }}
            </span>
          </td>
          <td class="alert-history-details">
            <div>{{ event.message }}</div>
            <div class="alert-history-value">
              {{ alertEventValueText(event) }}
            </div>
            <div v-if="event.error" class="alert-history-error">
              {{ event.error }}
            </div>
          </td>
          <td>
            <NuxtLink
              class="alert-history-link"
              :to="alertHistoryLinkTarget(event)"
            >
              View
            </NuxtLink>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="alert-history-empty">No alert events match the filters.</p>
    <button
      v-if="hasMore"
      type="button"
      class="alert-history-load-more"
      @click="$emit('loadMore')"
    >
      Load more
    </button>
  </div>
</template>

<script setup>
import {
  alertEventStatusLabel,
  alertEventValueText,
  alertHistoryEventTime,
  alertHistoryLinkTarget,
} from "~~/services/AlertHistory";

defineProps({
  events: { type: Array, default: () => [] },
  hasMore: { type: Boolean, default: false },
});

defineEmits(["loadMore"]);
</script>

<style scoped>
.alert-history-table {
  max-width: 100%;
  overflow-x: auto;
}
.alert-history-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
.alert-history-table th,
.alert-history-table td {
  text-align: left;
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid #e5e7eb;
  vertical-align: top;
}
.alert-history-time,
.alert-history-service {
  white-space: nowrap;
}
.alert-history-value,
.alert-history-error {
  color: #6b7280;
  font-size: 0.75rem;
}
.alert-history-error {
  color: #b45309;
}
.alert-history-status {
  font-weight: 600;
}
.alert-history-status-error .alert-history-status {
  color: #b91c1c;
}
.alert-history-status-fired .alert-history-status,
.alert-history-status-suppressed .alert-history-status {
  color: #b45309;
}
.alert-history-status-resolved .alert-history-status {
  color: #047857;
}
.alert-history-empty {
  color: #6b7280;
  font-size: 0.85rem;
}
.alert-history-load-more {
  margin-top: 0.75rem;
  font-size: 0.8rem;
}
</style>
