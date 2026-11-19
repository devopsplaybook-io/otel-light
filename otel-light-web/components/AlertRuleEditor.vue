<template>
  <div class="alert-rule-row">
    <div class="alert-rule-header">
      <input
        class="alert-rule-enabled"
        type="checkbox"
        v-model="model.enabled"
        title="Enabled"
      />
      <select class="alert-rule-type" v-model="model.type">
        <option v-for="type in ALERT_RULE_TYPES" :key="type" :value="type">
          {{ alertRuleTypeLabel(type) }}
        </option>
      </select>
      <input
        class="alert-rule-description"
        type="text"
        v-model="model.description"
        placeholder="Description (optional)"
      />
      <select class="alert-rule-severity" v-model="model.severity">
        <option
          v-for="severity in ALERT_SEVERITIES"
          :key="severity"
          :value="severity"
        >
          {{ alertSeverityLabel(severity) }}
        </option>
      </select>
      <button
        class="alert-rule-button"
        type="button"
        @click="$emit('remove')"
        title="Remove"
      >
        <i class="bi bi-trash" />
      </button>
    </div>

    <div class="alert-rule-common">
      <select class="alert-rule-service" v-model="model.serviceName">
        <option value="">All services</option>
        <option v-for="svc in services" :key="svc" :value="svc">
          {{ svc }}
        </option>
      </select>
      <span class="alert-rule-label">over the last</span>
      <input
        class="alert-rule-amount"
        type="number"
        min="1"
        v-model.number="model.periodValue"
        placeholder="Value"
      />
      <select class="alert-rule-unit" v-model="model.periodUnit">
        <option value="hours">Hours</option>
        <option value="days">Days</option>
      </select>
      <label class="alert-rule-repeat">
        Repeat every
        <input
          class="alert-rule-repeat-input"
          type="number"
          min="0"
          v-model.number="model.repeatIntervalMinutes"
        />
        min (0 = once)
      </label>
      <label class="alert-rule-recovery">
        <input type="checkbox" v-model="model.notifyOnRecovery" />
        Notify on recovery
      </label>
    </div>

    <div v-if="model.type === 'log-count'" class="alert-rule-fields">
      <span class="alert-rule-label">When more than</span>
      <input
        class="alert-rule-threshold"
        type="number"
        min="0"
        v-model.number="model.threshold"
        placeholder="Threshold"
      />
      <span class="alert-rule-label">logs with severity</span>
      <span class="alert-rule-severities">
        <label v-for="severity in ALERT_LOG_SEVERITIES" :key="severity">
          <input
            type="checkbox"
            :value="severity"
            v-model="model.severities"
          />
          {{ severity }}
        </label>
      </span>
    </div>

    <div v-else-if="model.type === 'metric-threshold'" class="alert-rule-fields">
      <input
        class="alert-rule-metric-name"
        type="text"
        v-model="model.metricName"
        placeholder="Metric name"
      />
      <select class="alert-rule-aggregation" v-model="model.aggregation">
        <option
          v-for="aggregation in ALERT_AGGREGATIONS"
          :key="aggregation"
          :value="aggregation"
        >
          {{ aggregation }}
        </option>
      </select>
      <select class="alert-rule-comparison" v-model="model.comparison">
        <option
          v-for="comparison in ALERT_COMPARISONS"
          :key="comparison"
          :value="comparison"
        >
          {{ comparison }}
        </option>
      </select>
      <input
        class="alert-rule-threshold"
        type="number"
        v-model.number="model.threshold"
        placeholder="Threshold"
      />
    </div>

    <div v-else-if="model.type === 'trace-errors'" class="alert-rule-fields">
      <select class="alert-rule-mode" v-model="model.mode">
        <option value="error-rate">Error rate (%)</option>
        <option value="error-count">Error count</option>
      </select>
      <span class="alert-rule-label">greater than</span>
      <input
        class="alert-rule-threshold"
        type="number"
        min="0"
        v-model.number="model.threshold"
        placeholder="Threshold"
      />
    </div>

    <div v-else-if="model.type === 'heartbeat'" class="alert-rule-fields">
      <select class="alert-rule-signal-type" v-model="model.signalType">
        <option
          v-for="signalType in ALERT_SIGNAL_TYPES"
          :key="signalType"
          :value="signalType"
        >
          {{ signalType }}
        </option>
      </select>
      <input
        v-if="model.signalType === 'metrics'"
        class="alert-rule-metric-name"
        type="text"
        v-model="model.metricName"
        placeholder="Metric name (optional)"
      />
      <span class="alert-rule-label">
        alerts when no signal is received in the period
      </span>
    </div>

    <div v-if="issues.length" class="alert-rule-invalid">
      <i class="bi bi-exclamation-triangle" />
      This rule cannot be saved: {{ issues.join(", ") }}
    </div>
    <div class="alert-rule-outcome">{{ alertOutcomeText(outcome) }}</div>
  </div>
</template>

<script setup>
import { reactive, watch } from "vue";
import {
  ALERT_AGGREGATIONS,
  ALERT_COMPARISONS,
  ALERT_LOG_SEVERITIES,
  ALERT_RULE_TYPES,
  ALERT_SEVERITIES,
  ALERT_SIGNAL_TYPES,
  alertOutcomeText,
  alertRuleTypeLabel,
  alertSeverityLabel,
} from "~~/services/AlertRules";

const props = defineProps({
  rule: { type: Object, required: true },
  services: { type: Array, default: () => [] },
  issues: { type: Array, default: () => [] },
  outcome: { type: Object, default: null },
});

const emit = defineEmits(["remove", "update:rule"]);

// Edit a local copy and emit a snapshot: the page owns the rule array, so the
// schema validation and save logic always see the last edit.
const model = reactive({ ...props.rule });

watch(
  () => props.rule,
  (value) => {
    for (const key of Object.keys(value)) {
      if (Array.isArray(value[key]) && Array.isArray(model[key])) {
        const same =
          value[key].length === model[key].length &&
          value[key].every((entry, idx) => entry === model[key][idx]);
        if (!same) {
          model[key] = [...value[key]];
        }
      } else if (model[key] !== value[key]) {
        model[key] = value[key];
      }
    }
  },
);

watch(
  model,
  () => {
    emit("update:rule", {
      ...model,
      severities: [...(model.severities || [])],
    });
  },
  { deep: true },
);
</script>

<style scoped>
.alert-rule-row {
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 1rem;
  margin-bottom: 1rem;
}

.alert-rule-header,
.alert-rule-common,
.alert-rule-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.alert-rule-header .alert-rule-description {
  flex: 1 1 16rem;
}
.alert-rule-header .alert-rule-enabled {
  width: 1.2rem;
  height: 1.2rem;
}
.alert-rule-fields .alert-rule-metric-name {
  flex: 1 1 14rem;
}
.alert-rule-recovery,
.alert-rule-repeat,
.alert-rule-severities label {
  font-size: 0.8rem;
  white-space: nowrap;
}
.alert-rule-severities {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.alert-rule-repeat-input {
  width: 4.5rem;
}

.alert-rule-row input,
.alert-rule-row select {
  font-size: 0.8rem;
  height: 2.2rem;
  margin-bottom: 0;
}
.alert-rule-row input[type="checkbox"] {
  height: auto;
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
  font-size: 0.8rem;
}
.alert-rule-invalid {
  color: #b45309;
}
.alert-rule-outcome {
  color: #6b7280;
}
</style>
