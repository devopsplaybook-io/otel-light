<template>
  <div id="settings-page">
    <h3>Signal Deletion Settings</h3>
    <form id="settings">
      <div
        v-for="(rule, idx) in settings.deleteRules"
        :key="idx"
        class="delete-rule-row"
      >
        <select v-model="rule.signalType">
          <option disabled value="">Signal Type</option>
          <option value="traces">Trace</option>
          <option value="metrics">Metric</option>
          <option value="logs">Log</option>
        </select>
        <input
          type="number"
          min="1"
          v-model.number="rule.periodValue"
          placeholder="Value"
        />
        <select v-model="rule.periodUnit">
          <option value="days">Days</option>
          <option value="hours">Hours</option>
        </select>
        <input type="text" v-model="rule.pattern" placeholder="Pattern" />
        <button type="button" @click="removeRule(idx)" title="Remove">
          <i class="bi bi-trash" />
        </button>
      </div>
      <button type="button" @click="addRule">Add Rule</button>
      <button type="button" @click="saveSettings">Save</button>
    </form>
  </div>
</template>

<script>
import axios from "axios";
import SearchOptions from "~/components/SearchOptions.vue";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { EventBus, EventTypes, handleError } from "~~/services/EventBus";

export default {
  components: { SearchOptions },
  data() {
    return {
      settings: {
        deleteRules: [],
      },
    };
  },
  async created() {
    if (!(await AuthenticationStore().ensureAuthenticated())) {
      useRouter().push({ path: "/users" });
    }
    this.fetchSettings();
  },
  methods: {
    addRule() {
      this.settings.deleteRules.push({
        signalType: "",
        periodValue: 30,
        periodUnit: "days",
        pattern: "*",
      });
    },
    removeRule(idx) {
      this.settings.deleteRules.splice(idx, 1);
    },
    async fetchSettings() {
      const url = `${
        (await Config.get()).SERVER_URL
      }/settings/signal-cleanup-rules`;
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
              };
            }),
          };
        })
        .catch(handleError);
    },
    async saveSettings() {
      const url = `${
        (await Config.get()).SERVER_URL
      }/settings/signal-cleanup-rules`;
      const transformed = {
        deleteRules: this.settings.deleteRules.map((rule) => ({
          signalType: rule.signalType,
          periodHours:
            rule.periodUnit === "days"
              ? rule.periodValue * 24
              : rule.periodValue,
          pattern: rule.pattern,
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

<style>
.delete-rule-row {
  display: grid;
  grid-template-columns: auto 1fr auto 2fr auto;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
</style>

<style scoped>
#settings-page {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
}

#settings {
  max-width: 100%;
  overflow-x: auto;
}

#settings button {
  margin-right: 0.5rem;
}

.log-expanded {
  background-color: #dfe3eb22;
}
.log-span-expanded {
  background-color: #dfe3eb11;
}
</style>
