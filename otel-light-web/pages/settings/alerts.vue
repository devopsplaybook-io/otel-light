<template>
  <div>
    <h3>Error Alert Settings</h3>
    <div v-if="statusLoaded && !notificationsEnabled" class="alerts-disabled">
      <i class="bi bi-exclamation-triangle" />
      Notifications integration is disabled (NOTIFICATIONS_API/NOTIFICATIONS_TOKEN not
      configured). Rules are evaluated and their outcomes are shown here, but no
      notifications can be sent.
    </div>
    <p class="alerts-hint">
      A rule notifies when the number of error logs of a service (or of all services)
      is greater than the threshold during the selected period. A breach notifies
      once; it re-arms after an evaluation below the threshold.
    </p>
    <form id="alert-settings">
      <div
        v-for="(rule, idx) in settings.alertRules"
        :key="rule.id || idx"
        class="alert-rule-row"
      >
        <input
          class="alert-rule-enabled"
          type="checkbox"
          v-model="rule.enabled"
          title="Enabled"
        />
        <select class="alert-rule-service" v-model="rule.serviceName">
          <option value="">All services</option>
          <option v-for="svc in services" :key="svc" :value="svc">
            {{ svc }}
          </option>
        </select>
        <input
          class="alert-rule-threshold"
          type="number"
          min="0"
          v-model.number="rule.threshold"
          placeholder="Threshold"
        />
        <span class="alert-rule-label">errors in the last</span>
        <input
          class="alert-rule-amount"
          type="number"
          min="1"
          v-model.number="rule.periodValue"
          placeholder="Value"
        />
        <select class="alert-rule-unit" v-model="rule.periodUnit">
          <option value="days">Days</option>
          <option value="hours">Hours</option>
        </select>
        <button
          class="alert-rule-button"
          type="button"
          @click="removeRule(idx)"
          title="Remove"
        >
          <i class="bi bi-trash" />
        </button>
        <div v-if="ruleIssues(rule).length" class="alert-rule-invalid">
          <i class="bi bi-exclamation-triangle" />
          This rule will be skipped: {{ ruleIssues(rule).join(", ") }}
        </div>
        <div class="alert-rule-outcome">
          {{ outcomeText(rule) }}
        </div>
      </div>
      <button type="button" @click="addRule">Add Rule</button>
      <button type="button" @click="saveSettings">Save</button>
    </form>
  </div>
</template>

<script>
import axios from "axios";
import { analyticsGet } from "~~/services/AnalyticsQueue";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { EventBus, EventTypes, handleError } from "~~/services/EventBus";
import {
  errorAlertRuleIssues,
  validateErrorAlertRules,
} from "~~/services/ErrorAlertRules";
import { UtilsGenerateId } from "~~/services/Utils";

export default {
  data() {
    return {
      services: [],
      notificationsEnabled: true,
      statusLoaded: false,
      evaluations: {},
      settings: {
        alertRules: [],
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
    this.fetchSettings();
    this.fetchServices();
    this.fetchStatus();
  },
  methods: {
    ruleIssues(rule) {
      return errorAlertRuleIssues(rule);
    },
    outcomeText(rule) {
      if (!rule.id) {
        return "New rule (not saved yet)";
      }
      const outcome = this.evaluations[rule.id];
      if (!outcome) {
        return "Not evaluated yet";
      }
      const at = new Date(outcome.at).toLocaleString();
      if (outcome.error && outcome.count === undefined) {
        return `Last evaluation (${at}) failed: ${outcome.error}`;
      }
      if (outcome.breached) {
        const notified = outcome.notified
          ? "alert sent"
          : `not notified (${outcome.error || "unknown reason"})`;
        return `Last check (${at}): ${outcome.count} errors > ${outcome.threshold} — ${notified}`;
      }
      return `Last check (${at}): ${outcome.count} errors ≤ ${outcome.threshold} — OK`;
    },
    addRule() {
      this.settings.alertRules.push({
        id: UtilsGenerateId(),
        serviceName: "",
        threshold: 10,
        periodValue: 24,
        periodUnit: "hours",
        enabled: true,
      });
    },
    removeRule(idx) {
      this.settings.alertRules.splice(idx, 1);
    },
    async fetchServices() {
      try {
        const url = `${SERVER_URL}/analytics/services`;
        const response = await analyticsGet(
          url,
          await AuthService.getAuthHeader(),
        );
        this.services = response.data.services || [];
      } catch {
        // silently ignore — dropdown will just be empty
      }
    },
    async fetchStatus() {
      try {
        const url = `${SERVER_URL}/alerts/status`;
        const response = await axios.get(
          url,
          await AuthService.getAuthHeader(),
        );
        this.notificationsEnabled = response.data.notificationsEnabled;
        this.evaluations = response.data.evaluations || {};
      } catch {
        // Status is decorative: keep defaults instead of blocking the page.
      } finally {
        this.statusLoaded = true;
      }
    },
    async fetchSettings() {
      const url = `${SERVER_URL}/settings/error-alert-rules`;
      axios
        .get(url, await AuthService.getAuthHeader())
        .then((response) => {
          const apiSettings = response.data.settings.content;
          this.settings = {
            alertRules: (apiSettings.alertRules || []).map((rule) => {
              let periodValue, periodUnit;
              if (rule.periodHours % 24 === 0) {
                periodValue = rule.periodHours / 24;
                periodUnit = "days";
              } else {
                periodValue = rule.periodHours;
                periodUnit = "hours";
              }
              return {
                id: rule.id,
                serviceName: rule.serviceName || "",
                threshold: rule.threshold,
                periodValue,
                periodUnit,
                enabled: rule.enabled !== false,
              };
            }),
          };
        })
        .catch(handleError);
    },
    async saveSettings() {
      const issues = validateErrorAlertRules(this.settings.alertRules);
      if (issues.length > 0) {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: issues.join("; "),
        });
        return;
      }
      const url = `${SERVER_URL}/settings/error-alert-rules`;
      const transformed = {
        alertRules: this.settings.alertRules.map((rule) => ({
          id: rule.id,
          serviceName: rule.serviceName || "",
          threshold: Number(rule.threshold),
          periodHours:
            rule.periodUnit === "days"
              ? rule.periodValue * 24
              : rule.periodValue,
          enabled: rule.enabled !== false,
        })),
      };
      axios
        .put(url, { content: transformed }, await AuthService.getAuthHeader())
        .then(() => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: "Settings Updated",
          });
          // The rules apply at the next engine evaluation; refresh the
          // outcomes so brand-new rules show "Not evaluated yet".
          this.fetchStatus();
        })
        .catch(handleError);
    },
  },
};
</script>

<style scoped>
.alerts-disabled {
  color: #b45309;
  background-color: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 4px;
  padding: 0.6rem 0.8rem;
  margin-bottom: 1rem;
  font-size: 0.85rem;
}

.alerts-hint {
  color: #6b7280;
  font-size: 0.8rem;
  margin-bottom: 1.5rem;
}

.alert-rule-row {
  display: grid;
  grid-template-columns: auto 2fr 1fr auto auto 1fr auto;
  gap: 0.5rem;
  row-gap: 0.5rem;
  margin-bottom: 1.5rem;
  align-items: center;
}

.alert-rule-row button,
.alert-rule-row input,
.alert-rule-row select {
  margin-bottom: 0;
  height: 2.5rem;
}
.alert-rule-row button {
  font-size: 0.8rem;
}
.alert-rule-label {
  font-size: 0.8rem;
  white-space: nowrap;
}

.alert-rule-invalid,
.alert-rule-outcome {
  grid-column: 1 / -1;
  font-size: 0.8rem;
}
.alert-rule-invalid {
  color: #b45309;
}
.alert-rule-outcome {
  color: #6b7280;
}

#alert-settings {
  max-width: 100%;
  overflow-x: auto;
}

#alert-settings button {
  margin-right: 0.5rem;
}

#alert-settings input,
#alert-settings select,
#alert-settings option {
  font-size: 0.8rem;
}
#alert-settings input {
  padding: 0.5rem 0.5rem;
}
#alert-settings select {
  padding: 0.5rem 1.3rem 0.5rem 0.5rem;
}
#alert-settings .alert-rule-enabled {
  width: 1.2rem;
}

@media (max-width: 600px) {
  .alert-rule-row {
    grid-template-columns: auto 1fr 1fr auto;
    grid-template-rows: auto auto;
  }
  .alert-rule-row .alert-rule-enabled {
    grid-column: 1;
    grid-row: 1;
  }
  .alert-rule-row .alert-rule-service {
    grid-column: 2;
    grid-row: 1;
  }
  .alert-rule-row .alert-rule-threshold {
    grid-column: 3;
    grid-row: 1;
  }
  .alert-rule-row .alert-rule-button {
    grid-column: 4;
    grid-row: 1;
  }
  .alert-rule-row .alert-rule-amount {
    grid-column: 2;
    grid-row: 2;
  }
  .alert-rule-row .alert-rule-unit {
    grid-column: 3;
    grid-row: 2;
  }
}
</style>
