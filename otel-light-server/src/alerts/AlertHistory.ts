import { v4 as uuidv4 } from "uuid";
import { OTelLogger, OTelTracer } from "../OTelContext";
import {
  AlertEventStatus,
  AlertSeverity,
  AlertSignalType,
} from "./AlertRules";
import { DbUtilsExecSQL, DbUtilsGetType, DbUtilsQuerySQL } from "../utils-std-ts/DbUtils";

const logger = OTelLogger().createModuleLogger("AlertHistory");

export const ALERT_HISTORY_MAX_LIMIT = 500;
export const ALERT_HISTORY_DEFAULT_LIMIT = 100;

export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: string;
  serviceName: string;
  status: AlertEventStatus;
  severity: AlertSeverity;
  observedValue: number | null;
  thresholdValue: number | null;
  message: string;
  signalType: AlertSignalType;
  signalPath: string;
  signalQuery: string;
  eventTime: string;
  notifiedAt: string | null;
  error: string | null;
}

export interface AlertEventInput {
  id?: string;
  ruleId: string;
  ruleName: string;
  ruleType: string;
  serviceName: string;
  status: AlertEventStatus;
  severity: AlertSeverity;
  observedValue?: number | null;
  thresholdValue?: number | null;
  message: string;
  signalType: AlertSignalType;
  signalPath: string;
  signalQuery: string;
  eventTime: string;
  notifiedAt?: string | null;
  error?: string | null;
}

export interface AlertHistoryFilters {
  ruleId?: string;
  serviceName?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AlertHistoryPage {
  events: AlertEvent[];
  hasMore: boolean;
}

export function AlertHistoryClampLimit(limit: unknown): number {
  const value = Number(limit);
  if (!Number.isFinite(value)) {
    return ALERT_HISTORY_DEFAULT_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(value), 1), ALERT_HISTORY_MAX_LIMIT);
}

// Best-effort: history persistence must never break an evaluation.
export async function AlertHistoryInsert(input: AlertEventInput): Promise<void> {
  const span = OTelTracer().startSpan("AlertHistoryInsert");
  try {
    await DbUtilsExecSQL(
      span,
      SQL_QUERIES.INSERT[DbUtilsGetType()],
      [
        input.id || uuidv4(),
        input.ruleId,
        input.ruleName.substring(0, 200),
        input.ruleType,
        (input.serviceName || "").substring(0, 2000),
        input.status,
        input.severity,
        input.observedValue === undefined ? null : input.observedValue,
        input.thresholdValue === undefined ? null : input.thresholdValue,
        (input.message || "").substring(0, 2000),
        input.signalType,
        input.signalPath,
        (input.signalQuery || "").substring(0, 2000),
        input.eventTime,
        input.notifiedAt ?? null,
        input.error ? input.error.substring(0, 2000) : null,
      ],
    );
  } catch (err) {
    logger.error("Error while persisting alert history event", err, span);
  } finally {
    span.end();
  }
}

export async function AlertHistoryList(
  filters: AlertHistoryFilters,
): Promise<AlertHistoryPage> {
  const span = OTelTracer().startSpan("AlertHistoryList");
  try {
    const dbType = DbUtilsGetType();
    const quote = dbType === "postgres" ? '"' : "";
    const where: string[] = [];
    const params: unknown[] = [];
    const addFilter = (
      column: string,
      operator: "=" | ">=" | "<=",
      value: unknown,
    ): void => {
      params.push(value);
      where.push(
        `${quote}${column}${quote} ${operator} ${dbType === "postgres" ? `$${params.length}` : "?"}`,
      );
    };
    if (filters.ruleId) {
      addFilter("ruleId", "=", filters.ruleId);
    }
    if (filters.serviceName) {
      addFilter("serviceName", "=", filters.serviceName);
    }
    if (filters.status) {
      addFilter("status", "=", filters.status);
    }
    if (filters.from) {
      addFilter("eventTime", ">=", filters.from);
    }
    if (filters.to) {
      addFilter("eventTime", "<=", filters.to);
    }
    const limit = AlertHistoryClampLimit(filters.limit);
    const offset = Math.max(Math.trunc(Number(filters.offset) || 0), 0);
    params.push(limit + 1);
    const limitPlaceholder =
      dbType === "postgres" ? `$${params.length}` : "?";
    params.push(offset);
    const offsetPlaceholder =
      dbType === "postgres" ? `$${params.length}` : "?";
    const sql =
      `SELECT * FROM alert_events` +
      (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY ${quote}eventTime${quote} DESC, ${quote}id${quote} DESC` +
      ` LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`;
    const rows = await DbUtilsQuerySQL(span, sql, params);
    const events = (rows || []).slice(0, limit).map(alertHistoryRowToEvent);
    return { events, hasMore: (rows || []).length > limit };
  } finally {
    span.end();
  }
}

export async function AlertHistoryPrune(beforeIso: string): Promise<void> {
  const span = OTelTracer().startSpan("AlertHistoryPrune");
  try {
    const dbType = DbUtilsGetType();
    await DbUtilsExecSQL(
      span,
      SQL_QUERIES.PRUNE[dbType],
      [beforeIso],
    );
  } catch (err) {
    logger.error("Error while pruning alert history", err, span);
  } finally {
    span.end();
  }
}

// Private Functions

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function alertHistoryRowToEvent(row: any): AlertEvent {
  return {
    id: row.id,
    ruleId: row.ruleId,
    ruleName: row.ruleName,
    ruleType: row.ruleType,
    serviceName: row.serviceName,
    status: row.status as AlertEventStatus,
    severity: row.severity as AlertSeverity,
    observedValue:
      row.observedValue === null || row.observedValue === undefined
        ? null
        : Number(row.observedValue),
    thresholdValue:
      row.thresholdValue === null || row.thresholdValue === undefined
        ? null
        : Number(row.thresholdValue),
    message: row.message,
    signalType: row.signalType as AlertSignalType,
    signalPath: row.signalPath,
    signalQuery: row.signalQuery,
    eventTime: row.eventTime,
    notifiedAt: row.notifiedAt ?? null,
    error: row.error ?? null,
  };
}

// SQL

const SQL_QUERIES = {
  INSERT: {
    postgres:
      'INSERT INTO alert_events ("id", "ruleId", "ruleName", "ruleType", "serviceName", "status", "severity", "observedValue", "thresholdValue", "message", "signalType", "signalPath", "signalQuery", "eventTime", "notifiedAt", "error")' +
      " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
    sqlite:
      "INSERT INTO alert_events (id, ruleId, ruleName, ruleType, serviceName, status, severity, observedValue, thresholdValue, message, signalType, signalPath, signalQuery, eventTime, notifiedAt, error)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  },
  PRUNE: {
    postgres: 'DELETE FROM alert_events WHERE "eventTime" < $1',
    sqlite: "DELETE FROM alert_events WHERE eventTime < ?",
  },
};
