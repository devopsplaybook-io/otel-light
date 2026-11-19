<template>
  <div>
    <h3>Alert History</h3>
    <p class="alert-history-hint">
      Breaches, notifications, recoveries and suppression by maintenance windows are
      recorded here (90 days retention). Each entry links to the matching signals
      over the rule period.
    </p>
    <div class="alert-history-filters">
      <select
        class="alert-history-filter-rule"
        v-model="filters.ruleId"
        @change="loadEvents(true)"
      >
        <option value="">All rules</option>
        <option v-for="rule in rules" :key="rule.id" :value="rule.id">
          {{ rule.label }}
        </option>
      </select>
      <select
        class="alert-history-filter-service"
        v-model="filters.serviceName"
        @change="loadEvents(true)"
      >
        <option value="">All services</option>
        <option v-for="svc in services" :key="svc" :value="svc">
          {{ svc }}
        </option>
      </select>
      <select
        class="alert-history-filter-status"
        v-model="filters.status"
        @change="loadEvents(true)"
      >
        <option value="">All statuses</option>
        <option
          v-for="status in ALERT_EVENT_STATUSES"
          :key="status"
          :value="status"
        >
          {{ alertEventStatusLabel(status) }}
        </option>
      </select>
      <input
        class="alert-history-filter-from"
        type="datetime-local"
        v-model="filters.from"
        @change="loadEvents(true)"
      />
      <span class="alert-history-separator">to</span>
      <input
        class="alert-history-filter-to"
        type="datetime-local"
        v-model="filters.to"
        @change="loadEvents(true)"
      />
      <button
        type="button"
        class="alert-history-refresh"
        :disabled="loading"
        @click="loadEvents(true)"
      >
        Refresh
      </button>
    </div>
    <AlertHistoryTable
      :events="events"
      :has-more="hasMore"
      @load-more="loadEvents(false)"
    />
  </div>
</template>

<script>
import axios from "axios";
import { analyticsGet } from "~~/services/AnalyticsQueue";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { handleError } from "~~/services/EventBus";
import {
  ALERT_EVENT_STATUSES,
  AlertRuleToForm,
  alertInputValueToIso,
} from "~~/services/AlertRules";
import { alertEventStatusLabel } from "~~/services/AlertHistory";
import AlertHistoryTable from "~/components/AlertHistoryTable.vue";

const PAGE_SIZE = 50;

export default {
  components: { AlertHistoryTable },
  data() {
    return {
      ALERT_EVENT_STATUSES,
      services: [],
      rules: [],
      events: [],
      hasMore: false,
      loading: false,
      filters: {
        ruleId: "",
        serviceName: "",
        status: "",
        from: "",
        to: "",
      },
    };
  },
  async created() {
    if (
      !(await AuthenticationStore().ensureAuthenticated()) ||
      !AuthenticationStore().isAdmin
    ) {
      // The settings layout page owns the redirect to the first allowed tab.
      return;
    }
    await Promise.all([this.fetchRules(), this.fetchServices()]);
    await this.loadEvents(true);
  },
  methods: {
    alertEventStatusLabel,
    async fetchRules() {
      try {
        const response = await axios.get(
          `${SERVER_URL}/settings/error-alert-rules`,
          await AuthService.getAuthHeader(),
        );
        const content = response.data.settings.content || {};
        this.rules = (content.alertRules || []).map((raw) => {
          const form = AlertRuleToForm(raw);
          return {
            id: form.id,
            label: form.description || form.id,
          };
        });
      } catch {
        // the rule filter is optional: keep the endpoint error non-blocking
      }
    },
    async fetchServices() {
      try {
        const response = await analyticsGet(
          `${SERVER_URL}/analytics/services`,
          await AuthService.getAuthHeader(),
        );
        this.services = response.data.services || [];
      } catch {
        // the service filter is optional
      }
    },
    buildQuery(offset) {
      const params = new URLSearchParams();
      if (this.filters.ruleId) params.set("ruleId", this.filters.ruleId);
      if (this.filters.serviceName) {
        params.set("serviceName", this.filters.serviceName);
      }
      if (this.filters.status) params.set("status", this.filters.status);
      const from = alertInputValueToIso(this.filters.from);
      const to = alertInputValueToIso(this.filters.to);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      return params.toString();
    },
    async loadEvents(reset) {
      if (this.loading) {
        return;
      }
      this.loading = true;
      const offset = reset ? 0 : this.events.length;
      try {
        const response = await axios.get(
          `${SERVER_URL}/alerts/history?${this.buildQuery(offset)}`,
          await AuthService.getAuthHeader(),
        );
        const page = response.data || {};
        const events = page.events || [];
        this.events = reset ? events : [...this.events, ...events];
        this.hasMore = Boolean(page.hasMore);
      } catch (err) {
        if (reset) {
          this.events = [];
          this.hasMore = false;
        }
        handleError(err);
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>

<style scoped>
.alert-history-hint {
  color: #6b7280;
  font-size: 0.8rem;
  margin-bottom: 1rem;
}

.alert-history-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 1rem;
  font-size: 0.8rem;
}
.alert-history-filters select,
.alert-history-filters input,
.alert-history-filters button {
  font-size: 0.8rem;
  height: 2.2rem;
  margin-bottom: 0;
}
.alert-history-separator {
  font-size: 0.8rem;
}
</style>
