<template>
  <div>
    <h3>Signal Deletion Settings</h3>
    <div class="cleanup-run-status">{{ lastRunText() }}</div>
    <form id="settings">
      <div
        v-for="(rule, idx) in settings.deleteRules"
        :key="idx"
        class="delete-rule-row"
      >
        <select class="delete-rule-type" v-model="rule.signalType">
          <option disabled value="">Type</option>
          <option value="traces">Trace</option>
          <option value="metrics">Metric</option>
          <option value="logs">Log</option>
        </select>
        <input
          class="delete-rule-amount"
          type="number"
          min="1"
          v-model.number="rule.periodValue"
          placeholder="Value"
        />
        <select class="delete-rule-unit" v-model="rule.periodUnit">
          <option value="days">Days</option>
          <option value="hours">Hours</option>
        </select>
        <input
          class="delete-rule-pattern"
          type="text"
          v-model="rule.pattern"
          placeholder="Pattern"
        />
        <select class="delete-rule-service" v-model="rule.serviceName">
          <option value="">All services</option>
          <option v-for="svc in services" :key="svc" :value="svc">
            {{ svc }}
          </option>
        </select>
        <button
          class="delete-rule-button"
          type="button"
          @click="removeRule(idx)"
          title="Remove"
        >
          <i class="bi bi-trash" />
        </button>
        <div class="cleanup-rule-run">{{ ruleRunText(rule) }}</div>
        <div v-if="ruleIssues(rule).length" class="delete-rule-invalid">
          <i class="bi bi-exclamation-triangle" />
          This rule will be skipped: {{ ruleIssues(rule).join(", ") }}
          <button
            type="button"
            class="delete-rule-fix"
            @click="fixRule(idx)"
          >
            Fix
          </button>
        </div>
      </div>
      <button type="button" @click="addRule">Add Rule</button>
      <button type="button" @click="saveSettings">Save</button>
    </form>
  </div>
</template>

<script>
import { analyticsGet } from "~~/services/AnalyticsQueue";
import axios from "axios";
import SearchOptions from "~/components/SearchOptions.vue";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { EventBus, EventTypes, handleError } from "~~/services/EventBus";
import { cleanupRuleIssues, validateCleanupRules, cleanupRuleFix, cleanupRuleKey, CLEANUP_RUN_STATUS_CATEGORY } from "~~/services/CleanupRules";

export default {
  components: { SearchOptions },
  data() {
    return {
      services: [],
      settings: {
        deleteRules: [],
      },
      runStatus: null,
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
    this.fetchRunStatus();
    this.fetchServices();
  },
  methods: {
    ruleIssues(rule) {
      return cleanupRuleIssues(rule);
    },
    lastRunText() {
      const runAt = this.runStatus?.runAt;
      if (!runAt) {
        return "No cleanup run recorded yet";
      }
      const date = new Date(runAt);
      if (!Number.isFinite(date.getTime())) {
        return "No cleanup run recorded yet";
      }
      return `Last cleanup run: ${date.toLocaleString()}`;
    },
    ruleRunText(rule) {
      const key = cleanupRuleKey(rule);
      const outcome = (this.runStatus?.rules || []).find(
        (item) => item.key === key,
      );
      if (!outcome) {
        return "No run recorded for this rule yet";
      }
      if (outcome.status === "deleted") {
        return `Last run: deleted ${outcome.deletedRows} row(s)`;
      }
      if (outcome.status === "skipped") {
        return `Last run skipped: ${outcome.message}`;
      }
      if (outcome.status === "error") {
        return `Last run failed: ${outcome.message}`;
      }
      return "No run recorded for this rule yet";
    },
    fixRule(idx) {
      this.settings.deleteRules.splice(
        idx,
        1,
        cleanupRuleFix(this.settings.deleteRules[idx]),
      );
      EventBus.emit(EventTypes.ALERT_MESSAGE, {
        type: "info",
        text: `Rule ${idx + 1} fixed — review and Save`,
      });
    },
    addRule() {
      this.settings.deleteRules.push({
        signalType: "",
        periodValue: 30,
        periodUnit: "days",
        pattern: "*",
        serviceName: "",
      });
    },
    removeRule(idx) {
      this.settings.deleteRules.splice(idx, 1);
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
    async fetchSettings() {
      const url = `${SERVER_URL}/settings/signal-cleanup-rules`;
      axios
        .get(url, await AuthService.getAuthHeader())
        .then((response) => {
          const apiSettings = response.data.settings.content;
          this.settings = {
            deleteRules: (apiSettings.deleteRules || []).map((rule) => {
              let periodValue, periodUnit;
              if (rule.periodHours % 24 === 0) {
                periodValue = rule.periodHours / 24;
                periodUnit = "days";
              } else {
                periodValue = rule.periodHours;
                periodUnit = "hours";
              }
              return {
                signalType: rule.signalType,
                periodValue,
                periodUnit,
                pattern: rule.pattern,
                serviceName: rule.serviceName || "",
              };
            }),
          };
        })
        .catch(handleError);
    },
    async fetchRunStatus() {
      try {
        const response = await axios.get(
          `${SERVER_URL}/settings/${CLEANUP_RUN_STATUS_CATEGORY}`,
          await AuthService.getAuthHeader(),
        );
        this.runStatus = response.data.settings.content || {};
      } catch (err) {
        handleError(err);
      }
    },
    async saveSettings() {
      const issues = validateCleanupRules(this.settings.deleteRules);
      if (issues.length > 0) {
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "error",
          text: issues.join("; "),
        });
        return;
      }
      const url = `${SERVER_URL}/settings/signal-cleanup-rules`;
      const transformed = {
        deleteRules: this.settings.deleteRules.map((rule) => ({
          signalType: rule.signalType,
          periodHours:
            rule.periodUnit === "days"
              ? rule.periodValue * 24
              : rule.periodValue,
          pattern: rule.pattern,
          ...(rule.serviceName ? { serviceName: rule.serviceName } : {}),
        })),
      };
      axios
        .put(url, { content: transformed }, await AuthService.getAuthHeader())
        .then(() => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: "Settings Updated",
          });
        })
        .catch(handleError);
    },
  },
};
</script>

<style scoped>
.delete-rule-row {
  display: grid;
  grid-template-columns: auto 1fr auto 2fr 2fr auto;
  gap: 0.5rem;
  row-gap: 0.5rem;
  margin-bottom: 2rem;
  align-items: center;
}

.delete-rule-row button,
.delete-rule-row input,
.delete-rule-row select {
  margin-bottom: 0;
  height: 2.5rem;
}
.delete-rule-row button {
  font-size: 0.8rem;
}

.delete-rule-invalid {
  grid-column: 1 / -1;
  color: #b45309;
  font-size: 0.8rem;
}

.delete-rule-fix {
  margin: 0 0 0 0.5rem;
  padding: 0.1rem 0.6rem;
  width: auto;
  font-size: 0.8rem;
  line-height: 1.4;
}

.cleanup-run-status {
  font-size: 0.8rem;
  opacity: 0.7;
  margin-bottom: 1rem;
}

.cleanup-rule-run {
  grid-column: 1 / -1;
  font-size: 0.8rem;
  opacity: 0.65;
}

@media (max-width: 600px) {
  .delete-rule-invalid {
    grid-column: 1 / -1;
  }
  .delete-rule-row {
    grid-template-columns: auto 1fr 1fr auto;
    grid-template-rows: auto auto;
  }
  .delete-rule-row .delete-rule-type {
    grid-column: 1;
    grid-row: 1;
  }
  .delete-rule-row .delete-rule-amount {
    grid-column: 2;
    grid-row: 1;
  }
  .delete-rule-row .delete-rule-unit {
    grid-column: 3;
    grid-row: 1;
  }
  .delete-rule-row .delete-rule-button {
    grid-column: 4;
    grid-row: 1;
  }
  .delete-rule-row .delete-rule-service {
    grid-column: 3;
    grid-row: 2;
  }
  .delete-rule-row .delete-rule-pattern {
    grid-column: 2;
    grid-row: 2;
  }
}

#settings {
  max-width: 100%;
  overflow-x: auto;
}

#settings button {
  margin-right: 0.5rem;
}

#settings input,
#settings select,
#settings option {
  font-size: 0.8rem;
}
#settings input {
  padding: 0.5rem 0.5rem;
}
#settings select {
  padding: 0.5rem 1.3rem 0.5rem 0.5rem;
}
</style>
