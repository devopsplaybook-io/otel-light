import { Span } from "@opentelemetry/sdk-trace";
import {
  AlertAggregation,
  AlertComparison,
  AlertHeartbeatRule,
  AlertLogCountRule,
  AlertMetricThresholdRule,
  AlertRule,
  AlertSignalLink,
  AlertSignalType,
  AlertTraceErrorsRule,
} from "./AlertRules";
import { DbUtilsGetType, DbUtilsQuerySQL } from "../utils-std-ts/DbUtils";

export interface AlertEvaluationResult {
  value: number | null;
  threshold: number | null;
  breached: boolean;
  error?: string;
  signalType: AlertSignalType;
  signalPath: string;
  signalQuery: string;
  message: string;
}

export async function AlertRuleEvaluate(
  span: Span,
  rule: AlertRule,
  nowMs: number,
): Promise<AlertEvaluationResult> {
  switch (rule.type) {
    case "metric-threshold":
      return AlertEvaluateMetricThreshold(span, rule, nowMs);
    case "trace-errors":
      return AlertEvaluateTraceErrors(span, rule, nowMs);
    case "heartbeat":
      return AlertEvaluateHeartbeat(span, rule, nowMs);
    default:
      return AlertEvaluateLogCount(span, rule, nowMs);
  }
}

// Aggregation and comparison helpers (exported for unit tests)

export function AlertComparisonMatches(
  value: number,
  comparison: AlertComparison,
  threshold: number,
): boolean {
  switch (comparison) {
    case ">=":
      return value >= threshold;
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
    default:
      return value > threshold;
  }
}

export function AlertMetricAggregate(
  values: number[],
  aggregation: AlertAggregation,
): number | null {
  if (!values || values.length === 0) {
    return null;
  }
  switch (aggregation) {
    case "avg":
      return values.reduce((total, value) => total + value, 0) / values.length;
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    default:
      return values[values.length - 1];
  }
}

// Numeric values of one raw OTLP metric, ordered by data point time. Gauge
// and sum carry asDouble/asInt, histogram carries the observation sum;
// summary has no numeric scalar and contributes nothing.
export function AlertMetricValuesFromRaw(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any,
  fallbackTime: number,
): { time: number; value: number }[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const isGaugeOrSum = Boolean(raw.gauge || raw.sum);
  const isHistogram = Boolean(raw.histogram || raw.exponentialHistogram);
  const dataPoints =
    raw.gauge?.dataPoints ??
    raw.sum?.dataPoints ??
    raw.histogram?.dataPoints ??
    raw.exponentialHistogram?.dataPoints ??
    raw.summary?.dataPoints ??
    [];
  if (!Array.isArray(dataPoints)) {
    return [];
  }
  const values: { time: number; value: number }[] = [];
  for (const dataPoint of dataPoints) {
    let value: number;
    if (isGaugeOrSum) {
      if (dataPoint?.asDouble !== undefined && dataPoint?.asDouble !== null) {
        value = Number(dataPoint.asDouble);
      } else if (dataPoint?.asInt !== undefined && dataPoint?.asInt !== null) {
        value = Number(dataPoint.asInt);
      } else {
        continue;
      }
    } else if (isHistogram) {
      if (dataPoint?.sum === undefined || dataPoint?.sum === null) {
        continue;
      }
      value = Number(dataPoint.sum);
    } else {
      continue;
    }
    if (!Number.isFinite(value)) {
      continue;
    }
    const pointTime = Number(dataPoint?.timeUnixNano);
    values.push({
      time: Number.isFinite(pointTime) && pointTime > 0 ? pointTime : fallbackTime,
      value,
    });
  }
  values.sort((left, right) => left.time - right.time);
  return values;
}

// Private Functions

function alertWindow(periodHours: number, nowMs: number): {
  startNs: number;
  endNs: number;
} {
  const endNs = nowMs * 1_000_000;
  return {
    startNs: endNs - periodHours * 3_600_000 * 1_000_000,
    endNs,
  };
}

function alertPlaceholder(dbType: string, index: number): string {
  return dbType === "postgres" ? `$${index}` : "?";
}

async function AlertEvaluateLogCount(
  span: Span,
  rule: AlertLogCountRule,
  nowMs: number,
): Promise<AlertEvaluationResult> {
  const link = AlertSignalLink(rule);
  const { startNs, endNs } = alertWindow(rule.periodHours, nowMs);
  const dbType = DbUtilsGetType();
  const severities = rule.severities.length > 0 ? rule.severities : ["ERROR", "FATAL"];
  const params: unknown[] = [startNs, endNs, ...severities];
  const severityPlaceholders = severities
    .map((_, idx) => alertPlaceholder(dbType, idx + 3))
    .join(", ");
  const serviceName = rule.serviceName?.trim() || null;
  if (serviceName) {
    params.push(serviceName);
  }
  const serviceFilter = serviceName
    ? ` AND ${dbType === "postgres" ? '"serviceName"' : "serviceName"} = ${alertPlaceholder(dbType, params.length)}`
    : "";
  const sql =
    dbType === "postgres"
      ? `SELECT COUNT(*) AS count FROM logs WHERE "time" >= $1 AND "time" < $2 AND "severity" IN (${severityPlaceholders})${serviceFilter}`
      : `SELECT COUNT(*) AS count FROM logs WHERE time >= ? AND time < ? AND severity IN (${severityPlaceholders})${serviceFilter}`;
  const rows = await DbUtilsQuerySQL(span, sql, params);
  const count = Number(rows?.[0]?.count || 0);
  const threshold = Number(rule.threshold);
  const breached = count > threshold;
  return {
    value: count,
    threshold,
    breached,
    signalType: link.signalType,
    signalPath: link.signalPath,
    signalQuery: link.signalQuery,
    message: `${count} ${severities.join("+")} logs in the last ${rule.periodHours}h for ${rule.serviceName?.trim() || "all services"} (threshold > ${threshold})`,
  };
}

async function AlertEvaluateMetricThreshold(
  span: Span,
  rule: AlertMetricThresholdRule,
  nowMs: number,
): Promise<AlertEvaluationResult> {
  const link = AlertSignalLink(rule);
  const { startNs, endNs } = alertWindow(rule.periodHours, nowMs);
  const dbType = DbUtilsGetType();
  const serviceName = rule.serviceName?.trim() || null;
  const params: unknown[] = [startNs, endNs, rule.metricName];
  if (serviceName) {
    params.push(serviceName);
  }
  const serviceFilter = serviceName
    ? ` AND ${dbType === "postgres" ? '"serviceName"' : "serviceName"} = ${alertPlaceholder(dbType, 4)}`
    : "";
  const sql =
    dbType === "postgres"
      ? `SELECT "time", "type", "rawMetric" FROM metrics WHERE "time" >= $1 AND "time" < $2 AND "name" = $3${serviceFilter} ORDER BY "time" DESC LIMIT 5000`
      : `SELECT time, type, rawMetric FROM metrics WHERE time >= ? AND time < ? AND name = ?${serviceFilter} ORDER BY time DESC LIMIT 5000`;
  const rows = await DbUtilsQuerySQL(span, sql, params);
  // Rows come newest first; sort every data point so `last` really is the
  // most recent sample across metric records.
  const points: { time: number; value: number }[] = [];
  for (const row of rows || []) {
    let raw: unknown;
    try {
      raw = JSON.parse(String(row.rawMetric));
    } catch {
      continue;
    }
    for (const point of AlertMetricValuesFromRaw(raw, Number(row.time))) {
      if (point.time >= startNs && point.time < endNs) {
        points.push(point);
      }
    }
  }
  points.sort((left, right) => left.time - right.time);
  const values = points.map((point) => point.value);
  const threshold = Number(rule.threshold);
  const value = AlertMetricAggregate(values, rule.aggregation);
  const breached =
    value !== null &&
    AlertComparisonMatches(value, rule.comparison, threshold);
  const serviceLabel = rule.serviceName?.trim() || "all services";
  return {
    value,
    threshold,
    breached,
    signalType: link.signalType,
    signalPath: link.signalPath,
    signalQuery: link.signalQuery,
    message:
      value === null
        ? `No numeric data for metric ${rule.metricName} in the last ${rule.periodHours}h for ${serviceLabel}`
        : `${rule.aggregation} of ${rule.metricName} is ${value} in the last ${rule.periodHours}h for ${serviceLabel} (threshold ${rule.comparison} ${threshold})`,
  };
}

async function AlertEvaluateTraceErrors(
  span: Span,
  rule: AlertTraceErrorsRule,
  nowMs: number,
): Promise<AlertEvaluationResult> {
  const link = AlertSignalLink(rule);
  const { startNs, endNs } = alertWindow(rule.periodHours, nowMs);
  const dbType = DbUtilsGetType();
  const serviceName = rule.serviceName?.trim() || null;
  const params: unknown[] = [startNs, endNs];
  if (serviceName) {
    params.push(serviceName);
  }
  const serviceFilter = serviceName
    ? ` AND ${dbType === "postgres" ? '"serviceName"' : "serviceName"} = ${alertPlaceholder(dbType, 3)}`
    : "";
  const sql =
    dbType === "postgres"
      ? `SELECT COUNT(DISTINCT "traceId") AS total, COUNT(DISTINCT CASE WHEN "statusCode" = 2 THEN "traceId" END) AS errors FROM traces WHERE "startTime" >= $1 AND "startTime" < $2${serviceFilter}`
      : `SELECT COUNT(DISTINCT traceId) AS total, COUNT(DISTINCT CASE WHEN statusCode = 2 THEN traceId END) AS errors FROM traces WHERE startTime >= ? AND startTime < ?${serviceFilter}`;
  const rows = await DbUtilsQuerySQL(span, sql, params);
  const total = Number(rows?.[0]?.total || 0);
  const errors = Number(rows?.[0]?.errors || 0);
  const value =
    rule.mode === "error-rate"
      ? total > 0
        ? Math.round((errors * 10000) / total) / 100
        : 0
      : errors;
  const threshold = Number(rule.threshold);
  const breached = value > threshold;
  const serviceLabel = rule.serviceName?.trim() || "all services";
  const metricLabel =
    rule.mode === "error-rate" ? "trace error rate" : "error traces";
  return {
    value,
    threshold,
    breached,
    signalType: link.signalType,
    signalPath: link.signalPath,
    signalQuery: link.signalQuery,
    message: `${metricLabel} is ${value}${rule.mode === "error-rate" ? "%" : ""} (${errors}/${total} traces) in the last ${rule.periodHours}h for ${serviceLabel} (threshold > ${threshold}${rule.mode === "error-rate" ? "%" : ""})`,
  };
}

async function AlertEvaluateHeartbeat(
  span: Span,
  rule: AlertHeartbeatRule,
  nowMs: number,
): Promise<AlertEvaluationResult> {
  const link = AlertSignalLink(rule);
  const { startNs, endNs } = alertWindow(rule.periodHours, nowMs);
  const dbType = DbUtilsGetType();
  const table =
    rule.signalType === "traces"
      ? "traces"
      : rule.signalType === "logs"
        ? "logs"
        : "metrics";
  const timeColumn = rule.signalType === "traces" ? "startTime" : "time";
  const quote = dbType === "postgres" ? '"' : "";
  const params: unknown[] = [startNs, endNs];
  let filters = "";
  const serviceName = rule.serviceName?.trim() || null;
  if (serviceName) {
    params.push(serviceName);
    filters += ` AND ${quote}serviceName${quote} = ${alertPlaceholder(dbType, params.length)}`;
  }
  if (rule.signalType === "metrics" && rule.metricName) {
    params.push(rule.metricName);
    filters += ` AND ${quote}name${quote} = ${alertPlaceholder(dbType, params.length)}`;
  }
  const sql = `SELECT COUNT(*) AS count FROM ${table} WHERE ${quote}${timeColumn}${quote} >= ${alertPlaceholder(dbType, 1)} AND ${quote}${timeColumn}${quote} < ${alertPlaceholder(dbType, 2)}${filters}`;
  const rows = await DbUtilsQuerySQL(span, sql, params);
  const count = Number(rows?.[0]?.count || 0);
  const signalLabel =
    rule.signalType === "metrics" && rule.metricName
      ? `metric ${rule.metricName}`
      : rule.signalType;
  return {
    value: count,
    threshold: 0,
    breached: count === 0,
    signalType: link.signalType,
    signalPath: link.signalPath,
    signalQuery: link.signalQuery,
    message:
      count === 0
        ? `No ${signalLabel} received for ${serviceName} in the last ${rule.periodHours}h (heartbeat)`
        : `${count} ${signalLabel} received for ${serviceName} in the last ${rule.periodHours}h (heartbeat OK)`,
  };
}
