import { SpanStatusCode } from "@opentelemetry/api";
import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "../Config";
import { Settings } from "../model/Settings";
import { OTelLogger, OTelTracer } from "../OTelContext";
import {
  NotificationIsEnabled,
  NotificationSendErrorAlert,
} from "../NotificationService";
import {
  DbUtilsExecSQL,
  DbUtilsGetType,
  DbUtilsQuerySQL,
} from "../utils-std-ts/DbUtils";

const logger = OTelLogger().createModuleLogger("ErrorAlerts");

let config: Config;
let lastEvaluatedAt: string | null = null;

export interface ErrorAlertRule {
  id: string;
  serviceName?: string;
  threshold: number;
  periodHours: number;
  enabled: boolean;
}

export interface ErrorAlertOutcome {
  at: string;
  count?: number;
  threshold?: number;
  breached?: boolean;
  notified?: boolean;
  error?: string;
}

export interface ErrorAlertsStatus {
  notificationsEnabled: boolean;
  evaluatedAt: string | null;
  evaluations: Record<string, ErrorAlertOutcome>;
}

// Outcomes are persisted in maintenance_state whose stateValue column is
// VARCHAR(200): the JSON must stay compact (long error texts are truncated).
const OUTCOME_KEY_PREFIX = "error-alert-outcome-";
const OUTCOME_MAX_LENGTH = 200;

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
    const rules = await ErrorAlertsLoadRules(span);
    const notificationsEnabled = NotificationIsEnabled();
    for (let idx = 0; idx < rules.length; idx++) {
      await ErrorAlertsEvaluateRule(span, rules[idx], idx, notificationsEnabled);
    }
    lastEvaluatedAt = new Date().toISOString();
    logger.info(`Error alerts: evaluated ${rules.length} rule(s)`, span);
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
    const rows = await DbUtilsQuerySQL(
      span,
      SQL_QUERIES.LIST_OUTCOMES[DbUtilsGetType()],
      [OUTCOME_KEY_PREFIX + "%"],
    );
    const evaluations: Record<string, ErrorAlertOutcome> = {};
    for (const row of rows || []) {
      try {
        evaluations[String(row.stateKey).substring(OUTCOME_KEY_PREFIX.length)] =
          JSON.parse(row.stateValue) as ErrorAlertOutcome;
      } catch {
        logger.warn(
          `Ignoring malformed error alert outcome: ${row.stateKey}`,
          span,
        );
      }
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

async function ErrorAlertsLoadRules(span: Span): Promise<ErrorAlertRule[]> {
  const rawSettings = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.GET_SETTINGS[DbUtilsGetType()],
    ["error-alert-rules"],
  );
  if (!rawSettings || rawSettings.length === 0) {
    return [];
  }
  const settings = new Settings(rawSettings[0]);
  const rules = settings.content?.alertRules;
  return Array.isArray(rules) ? rules : [];
}

async function ErrorAlertsEvaluateRule(
  span: Span,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rule: any,
  idx: number,
  notificationsEnabled: boolean,
): Promise<void> {
  // Rules are validated at save time, but a rule that still cannot run must
  // record an outcome instead of being silently skipped (it is keyed by id,
  // or by position when the id itself is invalid).
  const ruleId =
    rule && typeof rule === "object" && typeof rule.id === "string" && rule.id.trim()
      ? rule.id.trim()
      : `rule-${idx + 1}`;
  try {
    const invalidReason = ruleInvalidReason(rule);
    if (invalidReason) {
      await ErrorAlertsOutcomeSet(span, ruleId, {
        at: new Date().toISOString(),
        error: invalidReason,
      });
      return;
    }
    if (rule.enabled === false) {
      // Disabled rules are intentionally not evaluated and keep no outcome.
      return;
    }
    const count = await ErrorAlertsCountErrors(span, rule);
    const threshold = Number(rule.threshold);
    const breached = count > threshold;
    const previous = await ErrorAlertsOutcomeGet(span, ruleId);
    // Notify only on the healthy→breached transition of an episode: a breach
    // that persists does not re-send (state survives restarts), and a rule
    // left un-notified (integration disabled or send failure) stays eligible.
    const alreadyNotified =
      previous?.breached === true && previous?.notified === true;
    let notified = false;
    let error: string | undefined;
    if (breached) {
      if (alreadyNotified) {
        notified = true;
      } else if (notificationsEnabled) {
        const serviceLabel = rule.serviceName?.trim() || "all services";
        const sent = await NotificationSendErrorAlert(
          serviceLabel,
          count,
          threshold,
          Number(rule.periodHours),
        );
        if (sent) {
          notified = true;
        } else {
          error = "notification send failed";
        }
      } else {
        error = "notifications disabled";
      }
    }
    await ErrorAlertsOutcomeSet(span, ruleId, {
      at: new Date().toISOString(),
      count,
      threshold,
      breached,
      notified,
      ...(error ? { error } : {}),
    });
  } catch (err) {
    await ErrorAlertsOutcomeSet(span, ruleId, {
      at: new Date().toISOString(),
      error: err?.message || String(err),
    }).catch(() => undefined);
  }
}

function ruleInvalidReason(rule: unknown): string | null {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    return "rule must be an object";
  }
  const r = rule as { threshold?: unknown; periodHours?: unknown };
  // An empty string must not be silently coerced to 0 ("any error").
  const threshold = Number(r.threshold);
  if (
    r.threshold === "" ||
    r.threshold === null ||
    r.threshold === undefined ||
    !Number.isFinite(threshold) ||
    threshold < 0
  ) {
    return "threshold must be a number >= 0";
  }
  const periodHours = Number(r.periodHours);
  if (!Number.isFinite(periodHours) || periodHours <= 0) {
    return "periodHours must be a positive number";
  }
  return null;
}

async function ErrorAlertsCountErrors(
  span: Span,
  rule: ErrorAlertRule,
): Promise<number> {
  const periodHours = Number(rule.periodHours);
  const nowNs = Date.now() * 1_000_000;
  const startNs = nowNs - periodHours * 3_600_000 * 1_000_000;
  const serviceName = rule.serviceName?.trim() || null;
  const params = serviceName ? [startNs, nowNs, serviceName] : [startNs, nowNs];
  const rows = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.COUNT_ERRORS(serviceName)[DbUtilsGetType()],
    params,
  );
  return Number(rows?.[0]?.count || 0);
}

async function ErrorAlertsOutcomeGet(
  span: Span,
  ruleId: string,
): Promise<ErrorAlertOutcome | null> {
  const rows = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.GET_MAINTENANCE_STATE[DbUtilsGetType()],
    [OUTCOME_KEY_PREFIX + ruleId],
  );
  if (!rows || rows.length === 0) {
    return null;
  }
  try {
    return JSON.parse(rows[0].stateValue) as ErrorAlertOutcome;
  } catch {
    return null;
  }
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
  COUNT_ERRORS: (serviceName: string | null) => ({
    postgres:
      'SELECT COUNT(*) AS count FROM logs WHERE "time" >= $1 AND "time" < $2 AND LOWER("severity") = \'error\'' +
      (serviceName ? ' AND "serviceName" = $3' : ""),
    sqlite:
      "SELECT COUNT(*) AS count FROM logs WHERE time >= ? AND time < ? AND LOWER(severity) = 'error'" +
      (serviceName ? " AND serviceName = ?" : ""),
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
  LIST_OUTCOMES: {
    postgres:
      'SELECT "stateKey", "stateValue" FROM maintenance_state WHERE "stateKey" LIKE $1',
    sqlite:
      "SELECT stateKey, stateValue FROM maintenance_state WHERE stateKey LIKE ?",
  },
};
