import { SpanStatusCode } from "@opentelemetry/api";
import { Span } from "@opentelemetry/sdk-trace";
import { Config } from "../Config";
import { Settings } from "../model/Settings";
import { OTelLogger, OTelTracer } from "../OTelContext";
import {
  AlertNotificationItem,
  NotificationIsEnabled,
  NotificationSendAlertGroup,
  NotificationSendRecoveryGroup,
} from "../NotificationService";
import {
  ALERT_HISTORY_RETENTION_DAYS,
  AlertEventStatus,
  AlertMaintenanceWindow,
  AlertMaintenanceWindowActive,
  AlertMaintenanceWindowsOf,
  AlertRule,
  AlertRuleIssues,
  AlertRuleLabel,
  AlertRuleNormalize,
  AlertRuleTypeOf,
  AlertServiceLabel,
  AlertSeverity,
  AlertSignalType,
} from "./AlertRules";
import { AlertEvaluationResult, AlertRuleEvaluate } from "./AlertEvaluators";
import {
  AlertEventInput,
  AlertHistoryInsert,
  AlertHistoryPrune,
} from "./AlertHistory";
import {
  DbUtilsExecSQL,
  DbUtilsGetType,
  DbUtilsQuerySQL,
} from "../utils-std-ts/DbUtils";

const logger = OTelLogger().createModuleLogger("ErrorAlerts");

let config: Config;
let lastEvaluatedAt: string | null = null;
let lastHistoryPruneAt = 0;

const SETTINGS_CATEGORY = "error-alert-rules";
const OUTCOME_KEY_PREFIX = "error-alert-outcome-";
const OUTCOME_MAX_LENGTH = 200;
const HISTORY_PRUNE_INTERVAL_MS = 3_600_000;

// Full lifecycle state, persisted in alert_rule_state (one row per rule).
export interface AlertRuleState {
  at: string;
  ruleType: string;
  value: number | null;
  threshold: number | null;
  breached: boolean;
  notified: boolean;
  notifiedAt: string | null;
  breachStartedAt: string | null;
  lastNotifiedAt: string | null;
  lastError: string | null;
  suppressed: boolean;
}

// Compact outcome kept in maintenance_state for backward compatibility with
// existing consumers of GET /api/alerts/status (and SqlIntegration tests).
export interface ErrorAlertOutcome {
  at: string;
  count?: number;
  threshold?: number;
  breached?: boolean;
  notified?: boolean;
  error?: string;
  ruleType?: string;
  value?: number | null;
  suppressed?: boolean;
  notifiedAt?: string | null;
}

export interface ErrorAlertsStatus {
  notificationsEnabled: boolean;
  evaluatedAt: string | null;
  evaluations: Record<string, ErrorAlertOutcome>;
}

export async function ErrorAlertsInit(
  context: Span,
  configIn: Config,
): Promise<void> {
  const span = OTelTracer().startSpan("ErrorAlertsInit", context);
  config = configIn;
  const delayMinutes = Math.max(
    Number(configIn.ERROR_ALERTS_STARTUP_DELAY_MINUTES) || 0,
    0,
  );
  logger.info(
    `Error alerts engine initialized: first evaluation in ${delayMinutes} minute(s)`,
    span,
  );
  setTimeout(() => {
    ErrorAlertsEvaluate().catch((err) =>
      logger.error("Error during error alerts evaluation", err),
    );
  }, delayMinutes * 60 * 1000).unref();
  span.end();
}

export async function ErrorAlertsEvaluate(): Promise<void> {
  const span = OTelTracer().startSpan("ErrorAlertsEvaluate");
  try {
    await ErrorAlertsRun(span);
    lastEvaluatedAt = new Date().toISOString();
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    logger.error("Error during error alerts evaluation", err, span);
  } finally {
    span.end();
  }

  const frequencyMinutes = Math.max(
    Number(config?.ERROR_ALERTS_EVALUATION_FREQUENCY_MINUTES) || 15,
    1,
  );
  // unref: the evaluation loop must not keep the process alive on its own
  // (the HTTP listener does); also avoids pinning test runners open.
  setTimeout(() => {
    ErrorAlertsEvaluate().catch((err) =>
      logger.error("Error during error alerts evaluation", err),
    );
  }, frequencyMinutes * 60 * 1000).unref();
}

export async function ErrorAlertsGetStatus(): Promise<ErrorAlertsStatus> {
  const span = OTelTracer().startSpan("ErrorAlertsGetStatus");
  try {
    const evaluations: Record<string, ErrorAlertOutcome> = {};
    // Legacy outcomes first: rules evaluated before the alert_rule_state
    // table existed keep reporting until their next evaluation.
    const legacyOutcomes = await ErrorAlertsLoadLegacyOutcomes(span);
    for (const [ruleId, outcome] of legacyOutcomes) {
      evaluations[ruleId] = outcome;
    }
    const states = await ErrorAlertsLoadStates(span);
    for (const [ruleId, state] of states) {
      evaluations[ruleId] = StateToOutcome(state);
    }
    return {
      notificationsEnabled: NotificationIsEnabled(),
      evaluatedAt: lastEvaluatedAt,
      evaluations,
    };
  } finally {
    span.end();
  }
}

// Private Functions

interface AlertEngineNotificationItem {
  rule: AlertRule;
  state: AlertRuleState;
  result: AlertEvaluationResult;
}

interface AlertEngineNotificationGroup {
  kind: "breach" | "recovery";
  label: string;
  items: AlertEngineNotificationItem[];
}

async function ErrorAlertsRun(span: Span): Promise<void> {
  const content = await ErrorAlertsLoadSettingsContent(span);
  const rawRules = ErrorAlertsRawRules(content);
  const windows = AlertMaintenanceWindowsOf(content);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const notificationsEnabled = NotificationIsEnabled();
  const previousStates = await ErrorAlertsLoadStates(span);
  const legacyOutcomes = await ErrorAlertsLoadLegacyOutcomes(span);
  const nextStates = new Map<string, AlertRuleState>();
  const currentIds = new Set<string>();
  const notifications: AlertEngineNotificationGroup[] = [];

  for (let idx = 0; idx < rawRules.length; idx++) {
    const raw = rawRules[idx];
    const ruleId = ErrorAlertsRuleId(raw, idx);
    currentIds.add(ruleId);
    const previous =
      previousStates.get(ruleId) ||
      LegacyOutcomeToState(legacyOutcomes.get(ruleId));
    const issues = AlertRuleIssues(raw);
    if (issues.length > 0) {
      const error = issues.join(", ");
      const state = ErrorAlertsErrorState(
        AlertRuleTypeOf(raw),
        previous,
        error,
        nowIso,
      );
      nextStates.set(ruleId, state);
      await ErrorAlertsOutcomeSet(span, ruleId, ErrorAlertsOutcomeOf(state));
      if (!previous || previous.lastError !== error) {
        await AlertHistoryInsert(
          ErrorAlertsEventForRaw(
            raw,
            ruleId,
            "error",
            `Rule cannot run: ${error}`,
            nowIso,
            error,
          ),
        );
      }
      continue;
    }
    const rule = AlertRuleNormalize(raw);
    if (rule.enabled === false) {
      // Disabled rules are intentionally not evaluated and keep no outcome.
      continue;
    }
    await ErrorAlertsEvaluateRule(span, {
      rule,
      ruleId,
      previous,
      windows,
      nowMs,
      nowIso,
      notificationsEnabled,
      nextStates,
      notifications,
    });
  }

  await ErrorAlertsSendNotifications(span, notifications);

  for (const [ruleId, state] of nextStates) {
    await ErrorAlertsStateSet(span, ruleId, state);
    await ErrorAlertsOutcomeSet(span, ruleId, ErrorAlertsOutcomeOf(state));
  }
  await ErrorAlertsPruneState(span, currentIds);
  await ErrorAlertsPruneLegacyOutcomes(span, legacyOutcomes, currentIds);
  await ErrorAlertsPruneHistoryIfDue(span, nowMs);
  logger.info(`Error alerts: evaluated ${rawRules.length} rule(s)`, span);
}

interface ErrorAlertsEvaluateRuleContext {
  rule: AlertRule;
  ruleId: string;
  previous: AlertRuleState | null;
  windows: AlertMaintenanceWindow[];
  nowMs: number;
  nowIso: string;
  notificationsEnabled: boolean;
  nextStates: Map<string, AlertRuleState>;
  notifications: AlertEngineNotificationGroup[];
}

async function ErrorAlertsEvaluateRule(
  span: Span,
  context: ErrorAlertsEvaluateRuleContext,
): Promise<void> {
  const {
    rule,
    ruleId,
    previous,
    windows,
    nowMs,
    nowIso,
    notificationsEnabled,
    nextStates,
    notifications,
  } = context;
  let result: AlertEvaluationResult;
  try {
    result = await AlertRuleEvaluate(span, rule, nowMs);
  } catch (err) {
    const error = err?.message || String(err);
    const state = ErrorAlertsErrorState(
      rule.type,
      previous,
      error,
      nowIso,
    );
    nextStates.set(ruleId, state);
    await ErrorAlertsOutcomeSet(span, ruleId, ErrorAlertsOutcomeOf(state));
    await AlertHistoryInsert(
      ErrorAlertsEventForRule(rule, ruleId, "error", `Evaluation failed: ${error}`, nowIso, {
        error,
      }),
    );
    return;
  }

  const state: AlertRuleState = {
    at: nowIso,
    ruleType: rule.type,
    value: result.value,
    threshold: result.threshold,
    breached: result.breached,
    notified: false,
    notifiedAt: null,
    breachStartedAt: null,
    lastNotifiedAt: previous?.lastNotifiedAt || null,
    lastError: null,
    suppressed: false,
  };
  const wasBreached = previous?.breached === true;
  const wasNotified = previous?.notified === true;
  const muted = AlertMaintenanceWindowActive(windows, rule, nowMs);
  const serviceLabel = AlertServiceLabel(rule);

  if (result.breached) {
    const newEpisode = !wasBreached;
    state.breachStartedAt = newEpisode
      ? nowIso
      : previous?.breachStartedAt || previous?.at || nowIso;
    state.notified = !newEpisode && wasNotified;
    state.notifiedAt = !newEpisode ? previous?.notifiedAt || null : null;
    if (newEpisode) {
      await AlertHistoryInsert(
        ErrorAlertsEventForRule(rule, ruleId, "fired", result.message, nowIso, {
          result,
        }),
      );
    }
    const repeatDue =
      !newEpisode && wasNotified && ErrorAlertsRepeatDue(rule, previous, nowMs);
    const shouldNotify = newEpisode || !wasNotified || repeatDue;
    if (shouldNotify) {
      if (muted) {
        state.suppressed = true;
        await AlertHistoryInsert(
          ErrorAlertsEventForRule(
            rule,
            ruleId,
            "suppressed",
            `Notification suppressed by a maintenance window: ${result.message}`,
            nowIso,
            { result },
          ),
        );
      } else if (!notificationsEnabled) {
        state.notified = false;
        if (previous?.lastError !== "notifications disabled") {
          await AlertHistoryInsert(
            ErrorAlertsEventForRule(rule, ruleId, "error", result.message, nowIso, {
              result,
              error: "notifications disabled",
            }),
          );
        }
        state.lastError = "notifications disabled";
      } else {
        ErrorAlertsAddNotification(notifications, "breach", serviceLabel, {
          rule,
          state,
          result,
        });
      }
    }
  } else if (wasBreached) {
    // Episode ended: always record the resolution, notify when the episode
    // had been notified and recovery notifications are enabled.
    await AlertHistoryInsert(
      ErrorAlertsEventForRule(
        rule,
        ruleId,
        "resolved",
        `Condition cleared: ${result.message}`,
        nowIso,
        { result },
      ),
    );
    const recoveryWanted =
      rule.notifyOnRecovery !== false && wasNotified && notificationsEnabled;
    if (recoveryWanted) {
      if (muted) {
        await AlertHistoryInsert(
          ErrorAlertsEventForRule(
            rule,
            ruleId,
            "suppressed",
            `Recovery notification suppressed by a maintenance window: ${result.message}`,
            nowIso,
            { result },
          ),
        );
      } else {
        ErrorAlertsAddNotification(notifications, "recovery", serviceLabel, {
          rule,
          state,
          result,
        });
      }
    }
  }
  nextStates.set(ruleId, state);
}

function ErrorAlertsRepeatDue(
  rule: AlertRule,
  previous: AlertRuleState | null,
  nowMs: number,
): boolean {
  const repeatMinutes = Number(rule.repeatIntervalMinutes);
  if (!Number.isFinite(repeatMinutes) || repeatMinutes <= 0) {
    return false;
  }
  const lastNotifiedAt = previous?.lastNotifiedAt || previous?.notifiedAt;
  const lastNotifiedMs = lastNotifiedAt ? Date.parse(lastNotifiedAt) : NaN;
  if (!Number.isFinite(lastNotifiedMs)) {
    return true;
  }
  return nowMs - lastNotifiedMs >= repeatMinutes * 60_000;
}

function ErrorAlertsAddNotification(
  notifications: AlertEngineNotificationGroup[],
  kind: "breach" | "recovery",
  label: string,
  item: AlertEngineNotificationItem,
): void {
  let group = notifications.find(
    (candidate) => candidate.kind === kind && candidate.label === label,
  );
  if (!group) {
    group = { kind, label, items: [] };
    notifications.push(group);
  }
  group.items.push(item);
}

async function ErrorAlertsSendNotifications(
  span: Span,
  notifications: AlertEngineNotificationGroup[],
): Promise<void> {
  for (const group of notifications) {
    const items: AlertNotificationItem[] = group.items.map((item) => ({
      message:
        group.kind === "recovery"
          ? `Recovered: ${item.result.message}`
          : item.result.message,
      severity: item.rule.severity,
    }));
    const outcome =
      group.kind === "recovery"
        ? await NotificationSendRecoveryGroup(group.label, items)
        : await NotificationSendAlertGroup(group.label, items);
    for (const item of group.items) {
      if (outcome.sent) {
        const nowIso = new Date().toISOString();
        if (group.kind === "breach") {
          item.state.notified = true;
          item.state.notifiedAt = nowIso;
          item.state.lastNotifiedAt = nowIso;
          item.state.lastError = null;
          await AlertHistoryInsert(
            ErrorAlertsEventForRule(
              item.rule,
              item.rule.id,
              "notified",
              item.result.message,
              nowIso,
              { result: item.result, notifiedAt: nowIso },
            ),
          );
        }
      } else {
        const error = outcome.error || "notification send failed";
        item.state.lastError = error;
        await AlertHistoryInsert(
          ErrorAlertsEventForRule(
            item.rule,
            item.rule.id,
            "error",
            item.result.message,
            new Date().toISOString(),
            { result: item.result, error },
          ),
        );
      }
    }
  }
  if (notifications.length > 0) {
    logger.info(
      `Error alerts: sent ${notifications.length} notification group(s)`,
      span,
    );
  }
}

function ErrorAlertsErrorState(
  ruleType: string,
  previous: AlertRuleState | null,
  error: string,
  nowIso: string,
): AlertRuleState {
  return {
    at: nowIso,
    ruleType,
    value: null,
    threshold: null,
    breached: false,
    notified: false,
    notifiedAt: null,
    breachStartedAt: null,
    lastNotifiedAt: previous?.lastNotifiedAt || null,
    lastError: error,
    suppressed: false,
  };
}

function StateToOutcome(state: AlertRuleState): ErrorAlertOutcome {
  const outcome: ErrorAlertOutcome = {
    at: state.at,
    count: state.value === null ? undefined : state.value,
    threshold: state.threshold === null ? undefined : state.threshold,
    breached: state.breached,
    notified: state.notified,
    ruleType: state.ruleType,
    value: state.value,
    suppressed: state.suppressed,
    notifiedAt: state.notifiedAt,
  };
  if (state.lastError) {
    outcome.error = state.lastError;
  }
  return outcome;
}

function LegacyOutcomeToState(
  outcome: ErrorAlertOutcome | undefined,
): AlertRuleState | null {
  if (!outcome) {
    return null;
  }
  return {
    at: outcome.at || new Date(0).toISOString(),
    ruleType: outcome.ruleType || "log-count",
    value: outcome.count === undefined ? null : Number(outcome.count),
    threshold:
      outcome.threshold === undefined ? null : Number(outcome.threshold),
    breached: outcome.breached === true,
    notified: outcome.notified === true,
    notifiedAt: outcome.notified === true ? outcome.at || null : null,
    breachStartedAt:
      outcome.breached === true ? outcome.at || null : null,
    lastNotifiedAt: outcome.notified === true ? outcome.at || null : null,
    lastError: outcome.error || null,
    suppressed: false,
  };
}

// History event builders

function ErrorAlertsEventForRule(
  rule: AlertRule,
  ruleId: string,
  status: AlertEventStatus,
  message: string,
  eventTime: string,
  extras: {
    result?: AlertEvaluationResult;
    notifiedAt?: string | null;
    error?: string | null;
  } = {},
): AlertEventInput {
  return {
    ruleId,
    ruleName: AlertRuleLabel(rule),
    ruleType: rule.type,
    serviceName: rule.serviceName?.trim() || "",
    status,
    severity: rule.severity,
    observedValue: extras.result?.value ?? null,
    thresholdValue: extras.result?.threshold ?? null,
    message,
    signalType: extras.result?.signalType || "logs",
    signalPath: extras.result?.signalPath || "/logs",
    signalQuery: extras.result?.signalQuery || "",
    eventTime,
    notifiedAt: extras.notifiedAt ?? null,
    error: extras.error ?? null,
  };
}

function ErrorAlertsEventForRaw(
  raw: unknown,
  ruleId: string,
  status: AlertEventStatus,
  message: string,
  eventTime: string,
  error: string,
): AlertEventInput {
  const rule = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const serviceName =
    typeof rule.serviceName === "string" ? rule.serviceName.trim() : "";
  return {
    ruleId,
    ruleName:
      (typeof rule.description === "string" && rule.description.trim()) ||
      ruleId,
    ruleType: String(AlertRuleTypeOf(raw)),
    serviceName,
    status,
    severity: (["info", "warning", "critical"].includes(String(rule.severity))
      ? String(rule.severity)
      : "warning") as AlertSeverity,
    observedValue: null,
    thresholdValue: null,
    message,
    signalType: "logs" as AlertSignalType,
    signalPath: "/logs",
    signalQuery: "",
    eventTime,
    notifiedAt: null,
    error,
  };
}

// Settings, states and outcomes

async function ErrorAlertsLoadSettingsContent(span: Span): Promise<unknown> {
  const rawSettings = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.GET_SETTINGS[DbUtilsGetType()],
    [SETTINGS_CATEGORY],
  );
  if (!rawSettings || rawSettings.length === 0) {
    return { alertRules: [] };
  }
  const settings = new Settings(rawSettings[0]);
  return settings.content || { alertRules: [] };
}

function ErrorAlertsRawRules(content: unknown): unknown[] {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return [];
  }
  const rules = (content as { alertRules?: unknown }).alertRules;
  return Array.isArray(rules) ? rules : [];
}

function ErrorAlertsRuleId(raw: unknown, idx: number): string {
  if (raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string") {
    const id = (raw as { id: string }).id.trim();
    if (id) {
      return id;
    }
  }
  return `rule-${idx + 1}`;
}

async function ErrorAlertsLoadStates(
  span: Span,
): Promise<Map<string, AlertRuleState>> {
  const states = new Map<string, AlertRuleState>();
  const rows = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.LIST_STATES[DbUtilsGetType()],
    [],
  );
  for (const row of rows || []) {
    try {
      states.set(String(row.ruleId), JSON.parse(row.stateValue) as AlertRuleState);
    } catch {
      logger.warn(`Ignoring malformed alert rule state: ${row.ruleId}`, span);
    }
  }
  return states;
}

async function ErrorAlertsLoadLegacyOutcomes(
  span: Span,
): Promise<Map<string, ErrorAlertOutcome>> {
  const outcomes = new Map<string, ErrorAlertOutcome>();
  const rows = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.LIST_OUTCOMES[DbUtilsGetType()],
    [OUTCOME_KEY_PREFIX + "%"],
  );
  for (const row of rows || []) {
    try {
      outcomes.set(
        String(row.stateKey).substring(OUTCOME_KEY_PREFIX.length),
        JSON.parse(row.stateValue) as ErrorAlertOutcome,
      );
    } catch {
      logger.warn(
        `Ignoring malformed error alert outcome: ${row.stateKey}`,
        span,
      );
    }
  }
  return outcomes;
}

async function ErrorAlertsStateSet(
  span: Span,
  ruleId: string,
  state: AlertRuleState,
): Promise<void> {
  await DbUtilsExecSQL(span, SQL_QUERIES.UPSERT_STATE[DbUtilsGetType()], [
    ruleId,
    JSON.stringify(state),
    state.at,
  ]);
}

async function ErrorAlertsOutcomeSet(
  span: Span,
  ruleId: string,
  outcome: ErrorAlertOutcome,
): Promise<void> {
  await DbUtilsExecSQL(
    span,
    SQL_QUERIES.UPSERT_MAINTENANCE_STATE[DbUtilsGetType()],
    [OUTCOME_KEY_PREFIX + ruleId, compactOutcomeJson(outcome)],
  );
}

function ErrorAlertsOutcomeOf(state: AlertRuleState): ErrorAlertOutcome {
  const outcome: ErrorAlertOutcome = {
    at: state.at,
    breached: state.breached,
    notified: state.notified,
  };
  if (state.value !== null) {
    outcome.count = state.value;
  }
  if (state.threshold !== null) {
    outcome.threshold = state.threshold;
  }
  if (state.lastError) {
    outcome.error = state.lastError;
  }
  return outcome;
}

async function ErrorAlertsPruneState(
  span: Span,
  currentIds: Set<string>,
): Promise<void> {
  const ids = Array.from(currentIds);
  if (ids.length === 0) {
    await DbUtilsExecSQL(span, SQL_QUERIES.DELETE_ALL_STATES[DbUtilsGetType()], []);
    return;
  }
  const dbType = DbUtilsGetType();
  const placeholders = ids
    .map((_, idx) => (dbType === "postgres" ? `$${idx + 1}` : "?"))
    .join(", ");
  await DbUtilsExecSQL(
    span,
    SQL_QUERIES.DELETE_STATES_NOT_IN(placeholders)[dbType],
    ids,
  );
}

async function ErrorAlertsPruneLegacyOutcomes(
  span: Span,
  outcomes: Map<string, ErrorAlertOutcome>,
  currentIds: Set<string>,
): Promise<void> {
  for (const ruleId of outcomes.keys()) {
    if (!currentIds.has(ruleId)) {
      await DbUtilsExecSQL(
        span,
        SQL_QUERIES.DELETE_MAINTENANCE_STATE[DbUtilsGetType()],
        [OUTCOME_KEY_PREFIX + ruleId],
      );
    }
  }
}

async function ErrorAlertsPruneHistoryIfDue(
  span: Span,
  nowMs: number,
): Promise<void> {
  if (nowMs - lastHistoryPruneAt < HISTORY_PRUNE_INTERVAL_MS) {
    return;
  }
  lastHistoryPruneAt = nowMs;
  const cutoff = new Date(
    nowMs - ALERT_HISTORY_RETENTION_DAYS * 24 * 3_600_000,
  ).toISOString();
  await AlertHistoryPrune(cutoff);
  logger.info(
    `Error alerts: pruned alert history before ${cutoff}`,
    span,
  );
}

function compactOutcomeJson(outcome: ErrorAlertOutcome): string {
  let json = JSON.stringify(outcome);
  if (json.length <= OUTCOME_MAX_LENGTH) {
    return json;
  }
  if (outcome.error) {
    // Shorten the error text first; the numeric/at fields always fit.
    const overflow = json.length - OUTCOME_MAX_LENGTH;
    const shortened = {
      ...outcome,
      error: outcome.error.slice(0, Math.max(outcome.error.length - overflow, 0)),
    };
    json = JSON.stringify(shortened);
  }
  if (json.length > OUTCOME_MAX_LENGTH) {
    json = json.substring(0, OUTCOME_MAX_LENGTH);
  }
  return json;
}

// SQL

const SQL_QUERIES = {
  GET_SETTINGS: {
    postgres: 'SELECT * FROM settings WHERE "category" = $1',
    sqlite: "SELECT * FROM settings WHERE category = ?",
  },
  LIST_STATES: {
    postgres: 'SELECT "ruleId", "stateValue" FROM alert_rule_state',
    sqlite: "SELECT ruleId, stateValue FROM alert_rule_state",
  },
  UPSERT_STATE: {
    postgres:
      'INSERT INTO alert_rule_state ("ruleId", "stateValue", "updatedAt") VALUES ($1, $2, $3)' +
      ' ON CONFLICT ("ruleId") DO UPDATE SET "stateValue" = EXCLUDED."stateValue", "updatedAt" = EXCLUDED."updatedAt"',
    sqlite:
      "INSERT INTO alert_rule_state (ruleId, stateValue, updatedAt) VALUES (?, ?, ?)" +
      " ON CONFLICT(ruleId) DO UPDATE SET stateValue = excluded.stateValue, updatedAt = excluded.updatedAt",
  },
  DELETE_ALL_STATES: {
    postgres: "DELETE FROM alert_rule_state",
    sqlite: "DELETE FROM alert_rule_state",
  },
  DELETE_STATES_NOT_IN: (placeholders: string) => ({
    postgres: `DELETE FROM alert_rule_state WHERE "ruleId" NOT IN (${placeholders})`,
    sqlite: `DELETE FROM alert_rule_state WHERE ruleId NOT IN (${placeholders})`,
  }),
  GET_MAINTENANCE_STATE: {
    postgres:
      'SELECT "stateValue" FROM maintenance_state WHERE "stateKey" = $1',
    sqlite: "SELECT stateValue FROM maintenance_state WHERE stateKey = ?",
  },
  UPSERT_MAINTENANCE_STATE: {
    postgres:
      'INSERT INTO maintenance_state ("stateKey", "stateValue") VALUES ($1, $2)' +
      ' ON CONFLICT ("stateKey") DO UPDATE SET "stateValue" = EXCLUDED."stateValue"',
    sqlite:
      "INSERT INTO maintenance_state (stateKey, stateValue) VALUES (?, ?)" +
      " ON CONFLICT(stateKey) DO UPDATE SET stateValue = excluded.stateValue",
  },
  DELETE_MAINTENANCE_STATE: {
    postgres: 'DELETE FROM maintenance_state WHERE "stateKey" = $1',
    sqlite: "DELETE FROM maintenance_state WHERE stateKey = ?",
  },
  LIST_OUTCOMES: {
    postgres:
      'SELECT "stateKey", "stateValue" FROM maintenance_state WHERE "stateKey" LIKE $1',
    sqlite:
      "SELECT stateKey, stateValue FROM maintenance_state WHERE stateKey LIKE ?",
  },
};
