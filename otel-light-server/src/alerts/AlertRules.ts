import { SignalNormalizationSeverity } from "../SignalNormalization";

// Alerting 2.0 rule model. The content of the `error-alert-rules` settings
// category is extended additively: a rule without `type` is a legacy
// log-count rule and keeps working with ERROR + FATAL severities.
export type AlertRuleType =
  | "log-count"
  | "metric-threshold"
  | "trace-errors"
  | "heartbeat";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertSignalType = "logs" | "traces" | "metrics";
export type AlertAggregation = "last" | "avg" | "max" | "min";
export type AlertComparison = ">" | ">=" | "<" | "<=";
export type AlertTraceMode = "error-count" | "error-rate";
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
export const ALERT_AGGREGATIONS: AlertAggregation[] = [
  "last",
  "avg",
  "max",
  "min",
];
export const ALERT_COMPARISONS: AlertComparison[] = [">", ">=", "<", "<="];
export const ALERT_TRACE_MODES: AlertTraceMode[] = [
  "error-count",
  "error-rate",
];
export const ALERT_SIGNAL_TYPES: AlertSignalType[] = [
  "logs",
  "traces",
  "metrics",
];

export const ALERT_MAX_RULES = 100;
export const ALERT_MAX_MAINTENANCE_WINDOWS = 200;
export const ALERT_HISTORY_RETENTION_DAYS = 90;

export interface AlertRuleBase {
  id: string;
  type: AlertRuleType;
  description: string;
  serviceName: string;
  enabled: boolean;
  periodHours: number;
  severity: AlertSeverity;
  repeatIntervalMinutes: number;
  notifyOnRecovery: boolean;
}

export interface AlertLogCountRule extends AlertRuleBase {
  type: "log-count";
  threshold: number;
  severities: string[];
}

export interface AlertMetricThresholdRule extends AlertRuleBase {
  type: "metric-threshold";
  metricName: string;
  aggregation: AlertAggregation;
  comparison: AlertComparison;
  threshold: number;
}

export interface AlertTraceErrorsRule extends AlertRuleBase {
  type: "trace-errors";
  mode: AlertTraceMode;
  threshold: number;
}

export interface AlertHeartbeatRule extends AlertRuleBase {
  type: "heartbeat";
  signalType: AlertSignalType;
  metricName: string;
}

export type AlertRule =
  | AlertLogCountRule
  | AlertMetricThresholdRule
  | AlertTraceErrorsRule
  | AlertHeartbeatRule;

export interface AlertMaintenanceWindow {
  id: string;
  ruleId: string;
  serviceName: string;
  start: string;
  end: string;
  enabled: boolean;
}

// Helpers

function alertObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function alertIsFiniteNumber(value: unknown): boolean {
  if (value === "" || value === null || value === undefined) {
    return false;
  }
  return Number.isFinite(Number(value));
}

export function AlertRuleTypeOf(raw: unknown): AlertRuleType {
  const rule = alertObject(raw);
  if (!rule || rule.type === undefined || rule.type === null || rule.type === "") {
    return "log-count";
  }
  return String(rule.type) as AlertRuleType;
}

function alertSeveritiesNormalize(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return ["ERROR", "FATAL"];
  }
  const severities: string[] = [];
  for (const entry of raw) {
    const canonical = SignalNormalizationSeverity(entry);
    if (ALERT_LOG_SEVERITIES.includes(canonical) && !severities.includes(canonical)) {
      severities.push(canonical);
    }
  }
  return severities.length > 0 ? severities : ["ERROR", "FATAL"];
}

export function AlertRuleNormalize(raw: unknown): AlertRule {
  const rule = alertObject(raw) || {};
  const type = AlertRuleTypeOf(rule);
  const base: AlertRuleBase = {
    id: typeof rule.id === "string" ? rule.id.trim() : "",
    type,
    description:
      typeof rule.description === "string" ? rule.description.trim() : "",
    serviceName:
      typeof rule.serviceName === "string" ? rule.serviceName.trim() : "",
    enabled: rule.enabled !== false,
    periodHours: Number(rule.periodHours),
    severity: ALERT_SEVERITIES.includes(rule.severity as AlertSeverity)
      ? (rule.severity as AlertSeverity)
      : "warning",
    repeatIntervalMinutes:
      rule.repeatIntervalMinutes === undefined ||
      rule.repeatIntervalMinutes === null
        ? 0
        : Number(rule.repeatIntervalMinutes),
    notifyOnRecovery: rule.notifyOnRecovery !== false,
  };
  switch (type) {
    case "metric-threshold":
      return {
        ...base,
        type: "metric-threshold",
        metricName:
          typeof rule.metricName === "string" ? rule.metricName.trim() : "",
        aggregation: ALERT_AGGREGATIONS.includes(
          rule.aggregation as AlertAggregation,
        )
          ? (rule.aggregation as AlertAggregation)
          : "last",
        comparison: ALERT_COMPARISONS.includes(rule.comparison as AlertComparison)
          ? (rule.comparison as AlertComparison)
          : ">",
        threshold: Number(rule.threshold),
      };
    case "trace-errors":
      return {
        ...base,
        type: "trace-errors",
        mode: ALERT_TRACE_MODES.includes(rule.mode as AlertTraceMode)
          ? (rule.mode as AlertTraceMode)
          : "error-rate",
        threshold: Number(rule.threshold),
      };
    case "heartbeat":
      return {
        ...base,
        type: "heartbeat",
        signalType: ALERT_SIGNAL_TYPES.includes(rule.signalType as AlertSignalType)
          ? (rule.signalType as AlertSignalType)
          : "metrics",
        metricName:
          typeof rule.metricName === "string" ? rule.metricName.trim() : "",
      };
    default:
      return {
        ...base,
        type: "log-count",
        threshold: Number(rule.threshold),
        severities: alertSeveritiesNormalize(rule.severities),
      };
  }
}

// Validation
//
// These checks mirror the engine's normalization: a rule reported here could
// not run as configured. Messages keep the `Rule N: ...` prefix style added
// by ValidateAlertRulesContent.

export function AlertRuleIssues(raw: unknown): string[] {
  const issues: string[] = [];
  const rule = alertObject(raw);
  if (!rule) {
    return ["rule must be an object"];
  }
  if (typeof rule.id !== "string" || !rule.id.trim()) {
    issues.push("id must be a non-empty string");
  } else if (rule.id.length > 80) {
    issues.push("id must be at most 80 characters");
  }
  let type: AlertRuleType = "log-count";
  if (rule.type !== undefined && rule.type !== null && rule.type !== "") {
    if (!ALERT_RULE_TYPES.includes(rule.type as AlertRuleType)) {
      issues.push(`type must be one of: ${ALERT_RULE_TYPES.join(", ")}`);
    } else {
      type = rule.type as AlertRuleType;
    }
  }
  if (rule.serviceName !== undefined && typeof rule.serviceName !== "string") {
    issues.push("serviceName must be a string (empty = all services)");
  }
  if (type === "heartbeat" && !String(rule.serviceName || "").trim()) {
    issues.push("serviceName is required for heartbeat rules");
  }
  if (
    rule.description !== undefined &&
    typeof rule.description !== "string"
  ) {
    issues.push("description must be a string");
  }
  if (!alertIsFiniteNumber(rule.periodHours) || Number(rule.periodHours) <= 0) {
    issues.push("periodHours must be a positive number");
  }
  if (typeof rule.enabled !== "boolean") {
    issues.push("enabled must be a boolean");
  }
  if (
    rule.severity !== undefined &&
    !ALERT_SEVERITIES.includes(rule.severity as AlertSeverity)
  ) {
    issues.push(`severity must be one of: ${ALERT_SEVERITIES.join(", ")}`);
  }
  if (
    rule.repeatIntervalMinutes !== undefined &&
    rule.repeatIntervalMinutes !== null &&
    (!alertIsFiniteNumber(rule.repeatIntervalMinutes) ||
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
    case "log-count":
      if (!alertIsFiniteNumber(rule.threshold) || Number(rule.threshold) < 0) {
        issues.push("threshold must be a number >= 0");
      }
      if (rule.severities !== undefined) {
        if (!Array.isArray(rule.severities) || rule.severities.length === 0) {
          issues.push("severities must be a non-empty array");
        } else {
          const invalid = rule.severities.filter(
            (severity) =>
              !ALERT_LOG_SEVERITIES.includes(
                SignalNormalizationSeverity(severity),
              ),
          );
          if (invalid.length > 0) {
            issues.push(
              `severities must only contain: ${ALERT_LOG_SEVERITIES.join(", ")}`,
            );
          }
        }
      }
      break;
    case "metric-threshold":
      if (
        typeof rule.metricName !== "string" ||
        !rule.metricName.trim()
      ) {
        issues.push("metricName must be a non-empty string");
      }
      if (
        rule.aggregation !== undefined &&
        !ALERT_AGGREGATIONS.includes(rule.aggregation as AlertAggregation)
      ) {
        issues.push(
          `aggregation must be one of: ${ALERT_AGGREGATIONS.join(", ")}`,
        );
      }
      if (
        rule.comparison !== undefined &&
        !ALERT_COMPARISONS.includes(rule.comparison as AlertComparison)
      ) {
        issues.push(`comparison must be one of: ${ALERT_COMPARISONS.join(", ")}`);
      }
      if (!alertIsFiniteNumber(rule.threshold)) {
        issues.push("threshold must be a finite number");
      }
      break;
    case "trace-errors":
      if (
        rule.mode !== undefined &&
        !ALERT_TRACE_MODES.includes(rule.mode as AlertTraceMode)
      ) {
        issues.push(`mode must be one of: ${ALERT_TRACE_MODES.join(", ")}`);
      }
      if (!alertIsFiniteNumber(rule.threshold)) {
        issues.push("threshold must be a finite number");
      } else if (
        AlertRuleTypeOf(rule) === "trace-errors" &&
        (rule.mode === undefined ? "error-rate" : rule.mode) === "error-rate" &&
        (Number(rule.threshold) < 0 || Number(rule.threshold) > 100)
      ) {
        issues.push("threshold must be between 0 and 100 for error-rate rules");
      }
      break;
    case "heartbeat":
      if (
        rule.signalType !== undefined &&
        !ALERT_SIGNAL_TYPES.includes(rule.signalType as AlertSignalType)
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
  return issues;
}

export function AlertMaintenanceWindowIssues(raw: unknown): string[] {
  const issues: string[] = [];
  const window = alertObject(raw);
  if (!window) {
    return ["maintenance window must be an object"];
  }
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
  const start = typeof window.start === "string" ? Date.parse(window.start) : NaN;
  const end = typeof window.end === "string" ? Date.parse(window.end) : NaN;
  if (!Number.isFinite(start)) {
    issues.push("start must be a valid ISO date");
  }
  if (!Number.isFinite(end)) {
    issues.push("end must be a valid ISO date");
  }
  if (Number.isFinite(start) && Number.isFinite(end) && start >= end) {
    issues.push("start must be before end");
  }
  return issues;
}

export function ValidateAlertRulesContent(content: unknown): string[] {
  const root = alertObject(content);
  if (!root) {
    return ["alertRules must be an array of alert rules"];
  }
  if (!Array.isArray(root.alertRules)) {
    return ["alertRules must be an array of alert rules"];
  }
  const issues: string[] = [];
  if (root.alertRules.length > ALERT_MAX_RULES) {
    issues.push(`alertRules must contain at most ${ALERT_MAX_RULES} rules`);
  }
  root.alertRules.forEach((rule, idx) => {
    for (const issue of AlertRuleIssues(rule)) {
      issues.push(`Rule ${idx + 1}: ${issue}`);
    }
  });
  if (root.maintenanceWindows !== undefined) {
    if (!Array.isArray(root.maintenanceWindows)) {
      issues.push("maintenanceWindows must be an array of maintenance windows");
    } else {
      if (root.maintenanceWindows.length > ALERT_MAX_MAINTENANCE_WINDOWS) {
        issues.push(
          `maintenanceWindows must contain at most ${ALERT_MAX_MAINTENANCE_WINDOWS} windows`,
        );
      }
      root.maintenanceWindows.forEach((window, idx) => {
        for (const issue of AlertMaintenanceWindowIssues(window)) {
          issues.push(`Maintenance window ${idx + 1}: ${issue}`);
        }
      });
    }
  }
  return issues;
}

export function AlertMaintenanceWindowsOf(content: unknown): AlertMaintenanceWindow[] {
  const root = alertObject(content);
  if (!root || !Array.isArray(root.maintenanceWindows)) {
    return [];
  }
  return root.maintenanceWindows
    .filter((window) => alertObject(window))
    .map((window) => ({
      id: String(window.id || "").trim(),
      ruleId: typeof window.ruleId === "string" ? window.ruleId.trim() : "",
      serviceName:
        typeof window.serviceName === "string" ? window.serviceName.trim() : "",
      start: String(window.start || ""),
      end: String(window.end || ""),
      enabled: window.enabled !== false,
    }));
}

export function AlertServiceLabel(rule: AlertRule): string {
  return rule.serviceName?.trim() || "All services";
}

export function AlertRuleLabel(rule: AlertRule): string {
  if (rule.description?.trim()) {
    return rule.description.trim();
  }
  const service = AlertServiceLabel(rule);
  switch (rule.type) {
    case "log-count":
      return `${service}: ${rule.severities.join("+")} logs > ${rule.threshold}`;
    case "metric-threshold":
      return `${service}: ${rule.metricName} ${rule.aggregation} ${rule.comparison} ${rule.threshold}`;
    case "trace-errors":
      return rule.mode === "error-rate"
        ? `${service}: trace error rate > ${rule.threshold}%`
        : `${service}: trace errors > ${rule.threshold}`;
    case "heartbeat":
      return `${service}: no ${rule.signalType}${
        rule.metricName ? ` (${rule.metricName})` : ""
      }`;
  }
}

export interface AlertSignalLink {
  signalType: AlertSignalType;
  signalPath: string;
  signalQuery: string;
}

// Links follow the web search pages convention: `from` is a number of
// seconds ago (the pages convert it to nanoseconds), so a history entry opens
// the matching signals over the rule period.
export function AlertSignalLink(rule: AlertRule): AlertSignalLink {
  const params = new URLSearchParams();
  params.set("from", String(Math.round(rule.periodHours * 3600)));
  if (rule.serviceName?.trim()) {
    params.set("serviceName", rule.serviceName.trim());
  }
  switch (rule.type) {
    case "log-count":
      if (rule.severities.length === 1) {
        params.set("severity", rule.severities[0]);
      }
      return {
        signalType: "logs",
        signalPath: "/logs",
        signalQuery: params.toString(),
      };
    case "metric-threshold":
      params.set("keywords", rule.metricName);
      return {
        signalType: "metrics",
        signalPath: "/metrics",
        signalQuery: params.toString(),
      };
    case "trace-errors":
      params.set("errorsOnly", "true");
      return {
        signalType: "traces",
        signalPath: "/traces",
        signalQuery: params.toString(),
      };
    case "heartbeat":
      if (rule.signalType === "metrics" && rule.metricName) {
        params.set("keywords", rule.metricName);
      }
      return {
        signalType: rule.signalType,
        signalPath: `/${rule.signalType}`,
        signalQuery: params.toString(),
      };
  }
}

export function AlertMaintenanceWindowActive(
  windows: AlertMaintenanceWindow[],
  rule: AlertRule,
  nowMs: number,
): boolean {
  const serviceName = rule.serviceName?.trim() || "";
  for (const window of windows) {
    if (window.enabled === false) {
      continue;
    }
    if (window.ruleId && window.ruleId !== rule.id) {
      continue;
    }
    // An all-services rule is not partially muted by a service-scoped window.
    if (window.serviceName && window.serviceName !== serviceName) {
      continue;
    }
    const start = Date.parse(window.start);
    const end = Date.parse(window.end);
    if (Number.isFinite(start) && Number.isFinite(end) && start <= nowMs && nowMs < end) {
      return true;
    }
  }
  return false;
}
