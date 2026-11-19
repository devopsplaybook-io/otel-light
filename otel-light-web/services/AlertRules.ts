export type AlertRuleType =
  | "log-count"
  | "metric-threshold"
  | "trace-errors"
  | "heartbeat";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertSignalType = "metrics" | "logs" | "traces";
export type AlertEventStatus =
  | "fired"
  | "notified"
  | "resolved"
  | "suppressed"
  | "error";

export const ALERT_RULE_TYPES: AlertRuleType[] = [
  "log-count",
  "metric-threshold",
  "trace-errors",
  "heartbeat",
];
export const ALERT_SEVERITIES: AlertSeverity[] = [
  "info",
  "warning",
  "critical",
];
export const ALERT_LOG_SEVERITIES = [
  "TRACE",
  "DEBUG",
  "INFO",
  "WARN",
  "ERROR",
  "FATAL",
];
export const ALERT_AGGREGATIONS = ["last", "avg", "max", "min"];
export const ALERT_COMPARISONS = [">", ">=", "<", "<="];
export const ALERT_TRACE_MODES = ["error-count", "error-rate"];
export const ALERT_SIGNAL_TYPES: AlertSignalType[] = [
  "metrics",
  "logs",
  "traces",
];
export const ALERT_EVENT_STATUSES: AlertEventStatus[] = [
  "fired",
  "notified",
  "resolved",
  "suppressed",
  "error",
];

// Form model: the page edits numbers/dates as the user types them, the
// converters below produce the API payload (periodHours, ISO dates).
export interface AlertRuleForm {
  id?: string;
  type?: AlertRuleType;
  description?: string;
  serviceName?: string;
  enabled?: boolean;
  periodValue?: number | string;
  periodUnit?: "hours" | "days";
  severity?: AlertSeverity;
  repeatIntervalMinutes?: number | string;
  notifyOnRecovery?: boolean;
  threshold?: number | string;
  severities?: string[];
  metricName?: string;
  aggregation?: string;
  comparison?: string;
  mode?: string;
  signalType?: AlertSignalType;
}

export interface MaintenanceWindowForm {
  id?: string;
  ruleId?: string;
  serviceName?: string;
  start?: string;
  end?: string;
  enabled?: boolean;
}

export interface AlertRulesContentForm {
  alertRules: AlertRuleForm[];
  maintenanceWindows: MaintenanceWindowForm[];
}

export interface AlertRuleOutcome {
  at?: string;
  count?: number;
  value?: number | null;
  threshold?: number | null;
  breached?: boolean;
  notified?: boolean;
  suppressed?: boolean;
  error?: string;
  ruleType?: string;
  notifiedAt?: string | null;
}

// API -> form

export function AlertRuleToForm(raw: Record<string, unknown>): AlertRuleForm {
  const periodHours = Number(raw.periodHours);
  let periodValue: number = Number.isFinite(periodHours) ? periodHours : 1;
  let periodUnit: "hours" | "days" = "hours";
  if (periodValue > 0 && periodValue % 24 === 0) {
    periodValue = periodValue / 24;
    periodUnit = "days";
  }
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    type: (raw.type as AlertRuleType) || "log-count",
    description: typeof raw.description === "string" ? raw.description : "",
    serviceName: typeof raw.serviceName === "string" ? raw.serviceName : "",
    enabled: raw.enabled !== false,
    periodValue,
    periodUnit,
    severity: (raw.severity as AlertSeverity) || "warning",
    repeatIntervalMinutes:
      raw.repeatIntervalMinutes === undefined || raw.repeatIntervalMinutes === null
        ? 0
        : Number(raw.repeatIntervalMinutes),
    notifyOnRecovery: raw.notifyOnRecovery !== false,
    threshold:
      raw.threshold === undefined || raw.threshold === null
        ? ""
        : (raw.threshold as number),
    severities: Array.isArray(raw.severities)
      ? (raw.severities as string[])
      : ["ERROR", "FATAL"],
    metricName: typeof raw.metricName === "string" ? raw.metricName : "",
    aggregation: typeof raw.aggregation === "string" ? raw.aggregation : "last",
    comparison: typeof raw.comparison === "string" ? raw.comparison : ">",
    mode: typeof raw.mode === "string" ? raw.mode : "error-rate",
    signalType: (raw.signalType as AlertSignalType) || "metrics",
  };
}

export function newAlertRuleForm(type: AlertRuleType = "log-count"): AlertRuleForm {
  const base: AlertRuleForm = {
    id: "",
    type,
    description: "",
    serviceName: "",
    enabled: true,
    periodValue: 1,
    periodUnit: "hours",
    severity: "warning",
    repeatIntervalMinutes: 0,
    notifyOnRecovery: true,
    threshold: 10,
    severities: ["ERROR", "FATAL"],
    metricName: "",
    aggregation: "last",
    comparison: ">",
    mode: "error-rate",
    signalType: "metrics",
  };
  if (type === "metric-threshold") {
    base.threshold = 0;
    base.periodValue = 24;
  } else if (type === "trace-errors") {
    base.threshold = 10;
    base.mode = "error-rate";
  } else if (type === "heartbeat") {
    base.threshold = "";
    base.periodValue = 1;
  } else {
    base.periodValue = 24;
  }
  return base;
}

export function AlertPeriodHours(rule: AlertRuleForm): number {
  const value = Number(rule.periodValue);
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }
  return rule.periodUnit === "days" ? value * 24 : value;
}

// Form -> API

export function AlertRuleFromForm(
  form: AlertRuleForm,
): Record<string, unknown> {
  const type = form.type || "log-count";
  const base = {
    id: String(form.id || "").trim(),
    type,
    description: String(form.description || "").trim(),
    serviceName: String(form.serviceName || "").trim(),
    enabled: form.enabled !== false,
    periodHours: AlertPeriodHours(form),
    severity: form.severity || "warning",
    repeatIntervalMinutes: Number(form.repeatIntervalMinutes) || 0,
    notifyOnRecovery: form.notifyOnRecovery !== false,
  };
  switch (type) {
    case "metric-threshold":
      return {
        ...base,
        metricName: String(form.metricName || "").trim(),
        aggregation: form.aggregation || "last",
        comparison: form.comparison || ">",
        threshold: Number(form.threshold),
      };
    case "trace-errors":
      return {
        ...base,
        mode: form.mode || "error-rate",
        threshold: Number(form.threshold),
      };
    case "heartbeat":
      return {
        ...base,
        signalType: form.signalType || "metrics",
        metricName: String(form.metricName || "").trim(),
      };
    default: {
      const severities = Array.from(
        new Set(
          (form.severities && form.severities.length > 0
            ? form.severities
            : ["ERROR", "FATAL"]
          ).map(AlertCanonicalSeverity),
        ),
      );
      return {
        ...base,
        type: "log-count",
        threshold: Number(form.threshold),
        severities,
      };
    }
  }
}

function AlertCanonicalSeverity(value: unknown): string {
  const severity = String(value || "").trim().toUpperCase();
  return severity === "CRITICAL" ? "FATAL" : severity;
}

// Validation mirrors the server PUT checks so users learn at save time that a
// rule could not run (the server returns the same messages).

function AlertIsFiniteNumber(value: unknown): boolean {
  if (value === "" || value === null || value === undefined) {
    return false;
  }
  return Number.isFinite(Number(value));
}

export function alertRuleIssues(rule: AlertRuleForm): string[] {
  const issues: string[] = [];
  if (typeof rule.id !== "string" || !rule.id.trim()) {
    issues.push("id must be a non-empty string");
  } else if (rule.id.length > 80) {
    issues.push("id must be at most 80 characters");
  }
  const type = rule.type || "log-count";
  if (!ALERT_RULE_TYPES.includes(type)) {
    issues.push(`type must be one of: ${ALERT_RULE_TYPES.join(", ")}`);
  }
  if (
    type === "heartbeat" &&
    (typeof rule.serviceName !== "string" || !rule.serviceName.trim())
  ) {
    issues.push("serviceName is required for heartbeat rules");
  }
  if (rule.description !== undefined && typeof rule.description !== "string") {
    issues.push("description must be a string");
  }
  const periodHours = AlertPeriodHours(rule);
  if (!AlertIsFiniteNumber(rule.periodValue) || periodHours <= 0) {
    issues.push("period must be a positive number");
  }
  if (typeof rule.enabled !== "boolean") {
    issues.push("enabled must be a boolean");
  }
  if (
    rule.severity !== undefined &&
    !ALERT_SEVERITIES.includes(rule.severity)
  ) {
    issues.push(`severity must be one of: ${ALERT_SEVERITIES.join(", ")}`);
  }
  if (
    rule.repeatIntervalMinutes !== undefined &&
    rule.repeatIntervalMinutes !== null &&
    (!AlertIsFiniteNumber(rule.repeatIntervalMinutes) ||
      Number(rule.repeatIntervalMinutes) < 0)
  ) {
    issues.push("repeatIntervalMinutes must be a number >= 0");
  }
  if (
    rule.notifyOnRecovery !== undefined &&
    typeof rule.notifyOnRecovery !== "boolean"
  ) {
    issues.push("notifyOnRecovery must be a boolean");
  }

  switch (type) {
    case "log-count": {
      if (!AlertIsFiniteNumber(rule.threshold) || Number(rule.threshold) < 0) {
        issues.push("threshold must be a number >= 0");
      }
      if (rule.severities !== undefined) {
        if (!Array.isArray(rule.severities) || rule.severities.length === 0) {
          issues.push("severities must be a non-empty array");
        } else if (
          rule.severities.some(
            (severity) =>
              !ALERT_LOG_SEVERITIES.includes(AlertCanonicalSeverity(severity)),
          )
        ) {
          issues.push(
            `severities must only contain: ${ALERT_LOG_SEVERITIES.join(", ")}`,
          );
        }
      }
      break;
    }
    case "metric-threshold": {
      if (typeof rule.metricName !== "string" || !rule.metricName.trim()) {
        issues.push("metricName must be a non-empty string");
      }
      if (
        rule.aggregation !== undefined &&
        !ALERT_AGGREGATIONS.includes(rule.aggregation)
      ) {
        issues.push(
          `aggregation must be one of: ${ALERT_AGGREGATIONS.join(", ")}`,
        );
      }
      if (
        rule.comparison !== undefined &&
        !ALERT_COMPARISONS.includes(rule.comparison)
      ) {
        issues.push(
          `comparison must be one of: ${ALERT_COMPARISONS.join(", ")}`,
        );
      }
      if (!AlertIsFiniteNumber(rule.threshold)) {
        issues.push("threshold must be a finite number");
      }
      break;
    }
    case "trace-errors": {
      if (rule.mode !== undefined && !ALERT_TRACE_MODES.includes(rule.mode)) {
        issues.push(`mode must be one of: ${ALERT_TRACE_MODES.join(", ")}`);
      }
      if (!AlertIsFiniteNumber(rule.threshold)) {
        issues.push("threshold must be a finite number");
      } else if (
        (rule.mode || "error-rate") === "error-rate" &&
        (Number(rule.threshold) < 0 || Number(rule.threshold) > 100)
      ) {
        issues.push("threshold must be between 0 and 100 for error-rate rules");
      }
      break;
    }
    case "heartbeat": {
      if (
        rule.signalType !== undefined &&
        !ALERT_SIGNAL_TYPES.includes(rule.signalType)
      ) {
        issues.push(
          `signalType must be one of: ${ALERT_SIGNAL_TYPES.join(", ")}`,
        );
      }
      if (
        rule.metricName !== undefined &&
        typeof rule.metricName !== "string"
      ) {
        issues.push("metricName must be a string");
      }
      break;
    }
  }
  return issues;
}

export function validateAlertRules(rules: AlertRuleForm[] | undefined): string[] {
  const messages: string[] = [];
  (rules || []).forEach((rule, idx) => {
    for (const issue of alertRuleIssues(rule)) {
      messages.push(`Rule ${idx + 1}: ${issue}`);
    }
  });
  return messages;
}

// Maintenance windows

export function alertDateToInputValue(value: unknown): string {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) {
    return "";
  }
  const date = new Date(time);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function alertInputValueToIso(value: unknown): string {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

export function newMaintenanceWindowForm(): MaintenanceWindowForm {
  const now = Date.now();
  return {
    id: "",
    ruleId: "",
    serviceName: "",
    start: alertDateToInputValue(new Date(now).toISOString()),
    end: alertDateToInputValue(new Date(now + 3_600_000).toISOString()),
    enabled: true,
  };
}

export function MaintenanceWindowToForm(
  raw: Record<string, unknown>,
): MaintenanceWindowForm {
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    ruleId: typeof raw.ruleId === "string" ? raw.ruleId : "",
    serviceName: typeof raw.serviceName === "string" ? raw.serviceName : "",
    start: alertDateToInputValue(raw.start),
    end: alertDateToInputValue(raw.end),
    enabled: raw.enabled !== false,
  };
}

export function MaintenanceWindowFromForm(
  form: MaintenanceWindowForm,
): Record<string, unknown> {
  return {
    id: String(form.id || "").trim(),
    ruleId: String(form.ruleId || "").trim(),
    serviceName: String(form.serviceName || "").trim(),
    start: alertInputValueToIso(form.start),
    end: alertInputValueToIso(form.end),
    enabled: form.enabled !== false,
  };
}

export function maintenanceWindowIssues(
  window: MaintenanceWindowForm,
): string[] {
  const issues: string[] = [];
  if (typeof window.id !== "string" || !window.id.trim()) {
    issues.push("id must be a non-empty string");
  } else if (window.id.length > 80) {
    issues.push("id must be at most 80 characters");
  }
  if (window.ruleId !== undefined && typeof window.ruleId !== "string") {
    issues.push("ruleId must be a string (empty = all rules)");
  }
  if (
    window.serviceName !== undefined &&
    typeof window.serviceName !== "string"
  ) {
    issues.push("serviceName must be a string (empty = all services)");
  }
  if (window.enabled !== undefined && typeof window.enabled !== "boolean") {
    issues.push("enabled must be a boolean");
  }
  const start = Date.parse(String(window.start || ""));
  const end = Date.parse(String(window.end || ""));
  if (!Number.isFinite(start)) {
    issues.push("start must be a valid date");
  }
  if (!Number.isFinite(end)) {
    issues.push("end must be a valid date");
  }
  if (Number.isFinite(start) && Number.isFinite(end) && start >= end) {
    issues.push("start must be before end");
  }
  return issues;
}

export function validateAlertingContent(
  content: AlertRulesContentForm | undefined,
): string[] {
  if (!content || !Array.isArray(content.alertRules)) {
    return ["alertRules must be an array of alert rules"];
  }
  const messages = validateAlertRules(content.alertRules);
  (content.maintenanceWindows || []).forEach((window, idx) => {
    for (const issue of maintenanceWindowIssues(window)) {
      messages.push(`Maintenance window ${idx + 1}: ${issue}`);
    }
  });
  return messages;
}

// Labels

export function alertRuleTypeLabel(type: string | undefined): string {
  switch (type) {
    case "metric-threshold":
      return "Metric threshold";
    case "trace-errors":
      return "Trace errors";
    case "heartbeat":
      return "Heartbeat";
    default:
      return "Log count";
  }
}

export function alertSeverityLabel(severity: string | undefined): string {
  switch (severity) {
    case "critical":
      return "Critical";
    case "info":
      return "Info";
    default:
      return "Warning";
  }
}

export function alertOutcomeText(
  outcome: AlertRuleOutcome | null | undefined,
): string {
  if (!outcome) {
    return "Not evaluated yet";
  }
  const parsed = outcome.at ? new Date(outcome.at) : null;
  const at =
    parsed && !Number.isNaN(parsed.getTime())
      ? parsed.toLocaleString()
      : String(outcome.at || "never");
  const value = outcome.value ?? outcome.count;
  if (outcome.error && value === undefined) {
    return `Last evaluation (${at}) failed: ${outcome.error}`;
  }
  if (outcome.breached) {
    const status = outcome.suppressed
      ? "suppressed by a maintenance window"
      : outcome.notified
        ? "alert sent"
        : `not notified (${outcome.error || "unknown reason"})`;
    return `Last check (${at}): ${value ?? "—"} / threshold ${
      outcome.threshold ?? "—"
    } — ${status}`;
  }
  return `Last check (${at}): ${value ?? "—"} within threshold ${
    outcome.threshold ?? "—"
  } — OK`;
}
