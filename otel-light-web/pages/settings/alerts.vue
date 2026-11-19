<template>
  <div>
    <h3>Alert Settings</h3>
    <div v-if="statusLoaded && !notificationsEnabled" class="alerts-disabled">
      <i class="bi bi-exclamation-triangle" />
      Notifications integration is disabled (NOTIFICATIONS_API/NOTIFICATIONS_TOKEN not
      configured). Rules are evaluated and their outcomes are shown here, but no
      notifications can be sent.
    </div>
    <p class="alerts-hint">
      Rules are evaluated at every engine run. A breach notifies once (and repeats
      every configured interval while it lasts); when the condition clears a recovery
      notification is sent. Maintenance windows suppress notifications (the rule is
      still evaluated and the suppression is recorded in the alert history). Log
      count rules count ERROR and FATAL severities by default.
    </p>
    <form id="alert-settings">
      <h4>Alert rules</h4>
      <AlertRuleEditor
        v-for="(rule, idx) in settings.alertRules"
        :key="rule.id || idx"
        :rule="rule"
        :services="services"
        :issues="ruleIssues(rule)"
        :outcome="outcomeFor(rule)"
        @remove="removeRule(idx)"
        @update:rule="updateRule(idx, $event)"
      />
      <button type="button" class="alert-add-rule" @click="addRule">
        Add Rule
      </button>
      <button type="button" class="alert-save" @click="saveSettings">
        Save
      </button>

      <h4>Maintenance windows</h4>
      <p class="alerts-hint">
        During a window notifications are suppressed for the matching rules (empty
        rule = all rules, empty service = all services). Evaluation and history
        recording continue.
      </p>
      <div
        v-for="(window, idx) in settings.maintenanceWindows"
        :key="window.id || idx"
        class="maintenance-window-row"
      >
        <input
          class="maintenance-window-enabled"
          type="checkbox"
          v-model="window.enabled"
          title="Enabled"
        />
        <select class="maintenance-window-rule" v-model="window.ruleId">
          <option value="">All rules</option>
          <option
            v-for="rule in settings.alertRules"
            :key="rule.id"
            :value="rule.id"
          >
            {{ rule.description || rule.id }}
          </option>
        </select>
        <select class="maintenance-window-service" v-model="window.serviceName">
          <option value="">All services</option>
          <option v-for="svc in services" :key="svc" :value="svc">
            {{ svc }}
          </option>
        </select>
        <input
          class="maintenance-window-start"
          type="datetime-local"
          v-model="window.start"
        />
        <span class="alert-rule-label">to</span>
        <input
          class="maintenance-window-end"
          type="datetime-local"
          v-model="window.end"
        />
        <button
          class="maintenance-window-button"
          type="button"
          @click="removeWindow(idx)"
          title="Remove"
        >
          <i class="bi bi-trash" />
        </button>
        <div
          v-if="windowIssues(window).length"
          class="alert-rule-invalid"
        >
          <i class="bi bi-exclamation-triangle" />
          This window cannot be saved: {{ windowIssues(window).join(", ") }}
        </div>
      </div>
      <button type="button" class="maintenance-add-window" @click="addWindow">
        Add Maintenance Window
      </button>
    </form>

    <div class="test-notification">
      <h4>Test notification</h4>
      <select
        class="test-notification-severity"
        v-model="testSeverity"
      >
        <option v-for="severity in ALERT_SEVERITIES" :key="severity" :value="severity">
          {{ alertSeverityLabel(severity) }}
        </option>
      </select>
      <button
        class="test-notification-button"
        type="button"
        :disabled="testing"
        @click="sendTestNotification"
      >
        Send test notification
      </button>
      <span v-if="testResult" class="test-notification-result">
        {{ testResultText }}
      </span>
    </div>
  </div>
</template>

<script>
import axios from "axios";
import { analyticsGet } from "~~/services/AnalyticsQueue";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { EventBus, EventTypes, handleError } from "~~/services/EventBus";
import {
  ALERT_SEVERITIES,
  AlertRuleFromForm,
  AlertRuleToForm,
  MaintenanceWindowFromForm,
  MaintenanceWindowToForm,
  alertRuleIssues,
  alertSeverityLabel,
  maintenanceWindowIssues,
  newAlertRuleForm,
  newMaintenanceWindowForm,
  validateAlertingContent,
} from "~~/services/AlertRules";
import { UtilsGenerateId } from "~~/services/Utils";
import AlertRuleEditor from "~/components/AlertRuleEditor.vue";

export default {
  components: { AlertRuleEditor },
  data() {
    return {
      ALERT_SEVERITIES,
      services: [],
      notificationsEnabled: true,
      statusLoaded: false,
      evaluations: {},
      testSeverity: "info",
      testing: false,
      testResult: null,
      settings: {
        alertRules: [],
        maintenanceWindows: [],
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
  computed: {
    testResultText() {
      if (!this.testResult) {
        return "";
      }
      return this.testResult.sent
        ? `Test notification sent (${this.testResult.severity})`
        : `Test notification failed (${this.testResult.severity}): ${
            this.testResult.error || "unknown error"
          }`;
    },
  },
  methods: {
    alertSeverityLabel,
    ruleIssues(rule) {
      return alertRuleIssues(rule);
    },
    windowIssues(window) {
      return maintenanceWindowIssues(window);
    },
    outcomeFor(rule) {
      return rule.id ? this.evaluations[rule.id] || null : null;
    },
    addRule() {
      this.settings.alertRules.push({
        ...newAlertRuleForm("log-count"),
        id: UtilsGenerateId(),
      });
    },
    removeRule(idx) {
      this.settings.alertRules.splice(idx, 1);
    },
    updateRule(idx, rule) {
      this.settings.alertRules.splice(idx, 1, rule);
    },
    addWindow() {
      this.settings.maintenanceWindows.push({
        ...newMaintenanceWindowForm(),
        id: UtilsGenerateId(),
      });
    },
    removeWindow(idx) {
      this.settings.maintenanceWindows.splice(idx, 1);
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
          const apiSettings = response.data.settings.content || {};
          this.settings = {
            alertRules: (apiSettings.alertRules || []).map(AlertRuleToForm),
            maintenanceWindows: (apiSettings.maintenanceWindows || []).map(
              MaintenanceWindowToForm,
            ),
          };
        })
        .catch(handleError);
    },
    async saveSettings() {
      const issues = validateAlertingContent(this.settings);
      if (issues.length > 0) {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: issues.join("; "),
        });
        return;
      }
      const url = `${SERVER_URL}/settings/error-alert-rules`;
      const transformed = {
        alertRules: this.settings.alertRules.map(AlertRuleFromForm),
        maintenanceWindows: this.settings.maintenanceWindows.map(
          MaintenanceWindowFromForm,
        ),
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
    async sendTestNotification() {
      this.testing = true;
      this.testResult = null;
      try {
        const response = await axios.post(
          `${SERVER_URL}/alerts/test`,
          { severity: this.testSeverity },
          await AuthService.getAuthHeader(),
        );
        this.testResult = response.data;
      } catch (err) {
        this.testResult = {
          sent: false,
          severity: this.testSeverity,
          error: err?.response?.data?.error || err?.message || "request failed",
        };
      } finally {
        this.testing = false;
      }
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
  margin-bottom: 1rem;
}

#alert-settings h4 {
  margin: 1.2rem 0 0.6rem;
  font-size: 0.95rem;
}

#alert-settings {
  max-width: 100%;
  overflow-x: auto;
}

#alert-settings > button {
  margin-right: 0.5rem;
  margin-top: 0.5rem;
}

.alert-rule-label {
  font-size: 0.8rem;
  white-space: nowrap;
}

.maintenance-window-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
}
.maintenance-window-row input,
.maintenance-window-row select {
  font-size: 0.8rem;
  height: 2.2rem;
  margin-bottom: 0;
}
.maintenance-window-row input[type="checkbox"] {
  height: auto;
}
.maintenance-window-row .alert-rule-invalid {
  flex-basis: 100%;
  color: #b45309;
  font-size: 0.8rem;
}

.test-notification {
  margin-top: 2rem;
}
.test-notification h4 {
  margin: 0 0 0.6rem;
  font-size: 0.95rem;
}
.test-notification select,
.test-notification button {
  font-size: 0.8rem;
  height: 2.2rem;
  margin-right: 0.5rem;
}
.test-notification-result {
  font-size: 0.8rem;
  color: #374151;
}
</style>
