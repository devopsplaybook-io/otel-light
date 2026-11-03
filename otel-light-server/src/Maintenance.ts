import { SpanStatusCode } from "@opentelemetry/api";
import { Span } from "@opentelemetry/sdk-trace";
import { Config } from "./Config";
import { Settings } from "./model/Settings";
import { OTelLogger, OTelTracer } from "./OTelContext";
import {
  SignalRollupsEnsureInitialized,
  SignalRollupsReconcile,
  SignalRollupsRecordMetricNameDeletion,
  SignalRollupsRecordSignalDeletion,
  SignalServiceCountsDelta,
} from "./SignalRollups";
import { ScheduledJobRunExclusive } from "./ScheduledJobs";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsGetType,
} from "./utils-std-ts/DbUtils";

const logger = OTelLogger().createModuleLogger("Maintenance");
let config: Config;

// Chunked duplicate-metric compression (M4): instead of re-scanning the whole
// table on every run, walk forward over the compressible history in bounded
// chunks, remembering progress in maintenance_state. Sizes are multiples of
// the bucket width so a bucket is never split across two chunks.
const METRICS_COMPRESS_MINUTE_CHUNK_NS = 6 * 3600 * 1_000_000_000; // 6h of minute-buckets
const METRICS_COMPRESS_MINUTE_MAX_CHUNKS = 8; // ≤ 2 days of history per run
const METRICS_COMPRESS_HOUR_CHUNK_NS = 30 * 24 * 3600 * 1_000_000_000; // 30d of hour-buckets
const METRICS_COMPRESS_HOUR_MAX_CHUNKS = 4; // ≤ 120 days of history per run
const METRICS_COMPRESS_MINUTE_STATE_KEY = "metrics-compress-minute-hwm";
const METRICS_COMPRESS_HOUR_STATE_KEY = "metrics-compress-hour-hwm";

// Rollup reconciliation: compare the incremental rollups with the raw tables
// and repair them when they drifted. Runs at most once a day (log-only; no
// OpenTelemetry metric) so a rare inconsistency cannot persist forever.
const ROLLUP_RECONCILE_INTERVAL_HOURS = 24;
const ROLLUP_RECONCILE_STATE_KEY = "signal-rollups-reconcile-last-run";

export async function MaintenanceInit(context: Span, configIn: Config) {
  const span = OTelTracer().startSpan("MaintenanceInit", context);

  config = configIn;
  span.end();
  MaintenancePerform().catch((err) => {
    logger.error("Error during maintenance tasks", err);
  });
}

// Private Functions

async function MaintenancePerform(): Promise<void> {
  const span = OTelTracer().startSpan("MaintenancePerform");
  try {
    // Never run concurrently with another heavy scheduled job in this process
    // (LLM recommendation, static reports). Skipped runs are logged.
    await ScheduledJobRunExclusive(
      "maintenance",
      () => MaintenancePerformJobs(span),
      config.SCHEDULED_JOB_OVERLAP_WAIT_MINUTES,
    );
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    logger.error("Error during maintenance tasks", err, span);
  }

  span.end();

  // unref: the maintenance loop must not keep the process alive on its own
  // (the HTTP listener does); also avoids pinning test runners open.
  setTimeout(
    () => {
      MaintenancePerform().catch((err) => {
        logger.error("Error during maintenance tasks", err, span);
      });
    },
    Math.max(config.MAINTENANCE_FREQUENCY_HOURS, 1) * 3600 * 1000,
  ).unref();
}

async function MaintenancePerformJobs(span: Span): Promise<void> {
  logger.info("Performing maintenance tasks", span);

  // Recount rollups if the initial startup recount failed (self-heal)
  await SignalRollupsEnsureInitialized(span);

  try {
    await MaintenanceApplyRetentionRules(span);
  } catch (err) {
    logger.error("Error applying signal cleanup rules", err, span);
  }

  try {
    await MaintenanceDeleteOrphanTraces(span);
  } catch (err) {
    logger.error("Error deleting orphan traces", err, span);
  }

  try {
    await MaintenanceMetricsCompress(
      span,
      config.METRICS_COMPRESS_MINUTE_THRESHOLD_HOURS,
      60 * 1_000_000_000,
      METRICS_COMPRESS_MINUTE_CHUNK_NS,
      METRICS_COMPRESS_MINUTE_MAX_CHUNKS,
      METRICS_COMPRESS_MINUTE_STATE_KEY,
    );
  } catch (err) {
    logger.error("Error during minute-bucket metrics compression", err, span);
  }

  try {
    await MaintenanceMetricsCompress(
      span,
      config.METRICS_COMPRESS_HOUR_THRESHOLD_DAYS * 24,
      3600 * 1_000_000_000,
      METRICS_COMPRESS_HOUR_CHUNK_NS,
      METRICS_COMPRESS_HOUR_MAX_CHUNKS,
      METRICS_COMPRESS_HOUR_STATE_KEY,
    );
  } catch (err) {
    logger.error("Error during hour-bucket metrics compression", err, span);
  }

  // Reconcile rollups with the raw tables at most once a day. The state is
  // only written on success so a failure is retried on the next run.
  try {
    const lastRun = await MaintenanceStateGet(
      span,
      ROLLUP_RECONCILE_STATE_KEY,
    );
    if (MaintenanceRollupReconcileDue(lastRun, Date.now())) {
      await SignalRollupsReconcile(span);
      await MaintenanceStateSet(
        span,
        ROLLUP_RECONCILE_STATE_KEY,
        new Date().toISOString(),
      );
    }
  } catch (err) {
    logger.error("Error during signal rollup reconciliation", err, span);
  }
}

// Returns true when the last reconciliation is missing/unreadable or older
// than the interval. A future timestamp (clock skew) is never due.
export function MaintenanceRollupReconcileDue(
  lastRunIso: string | null,
  nowMs: number,
  intervalHours = ROLLUP_RECONCILE_INTERVAL_HOURS,
): boolean {
  if (lastRunIso === null || lastRunIso === undefined) {
    return true;
  }
  const lastRunMs = Date.parse(lastRunIso);
  if (!Number.isFinite(lastRunMs)) {
    return true;
  }
  if (lastRunMs > nowMs) {
    return false;
  }
  return nowMs - lastRunMs >= intervalHours * 3_600_000;
}

// Signal cleanup rules (settings "signal-cleanup-rules"). Rollup counts are
// decremented with the pre-delete grouped deltas so they stay exact.
async function MaintenanceApplyRetentionRules(span: Span): Promise<void> {
  const dbType = DbUtilsGetType();
  const rawSettings = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.GET_SETTINGS[dbType],
    ["signal-cleanup-rules"],
  );
  if (!rawSettings || rawSettings.length === 0) {
    logger.info("No signal cleanup rules configured; nothing to delete", span);
    return;
  }

  const settings = new Settings(rawSettings[0]);
  for (const deleteRule of settings.content.deleteRules || []) {
    try {
      await ApplyCleanupRule(span, dbType, deleteRule);
    } catch (err) {
      // One failing rule must not stop the remaining ones.
      logger.error(
        `Error applying cleanup rule (signal=${deleteRule.signalType} ; pattern=${deleteRule.pattern} ; serviceName=${deleteRule.serviceName ?? "*"})`,
        err,
        span,
      );
    }
  }
}

interface CleanupRule {
  signalType?: string;
  pattern?: string;
  periodHours?: unknown;
  serviceName?: string;
}

// Only `*` is a wildcard. User-supplied `%`, `_` and `\` are LIKE
// metacharacters and must stay literal, otherwise a pattern like
// `error_rate_%` would delete far more rows than intended. Every retention
// LIKE clause therefore carries `ESCAPE '\'`.
export function MaintenanceFormatRetentionPattern(patternIn: string): string {
  const escaped = String(patternIn)
    .toLowerCase()
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  return ("%" + escaped + "%").replace(/\*/g, "%");
}

async function ApplyCleanupRule(
  span: Span,
  dbType: "sqlite" | "postgres",
  deleteRule: CleanupRule,
): Promise<void> {
  if (
    deleteRule.signalType !== "traces" &&
    deleteRule.signalType !== "metrics" &&
    deleteRule.signalType !== "logs"
  ) {
    logger.warn(
      `Rule (signal=${deleteRule.signalType} ; pattern=${deleteRule.pattern}) skipped: signalType must be traces, metrics or logs`,
      span,
    );
    return;
  }
  if (!deleteRule.pattern) {
    logger.warn(
      `Rule (signal=${deleteRule.signalType}) skipped: pattern must be a non-empty string`,
      span,
    );
    return;
  }
  const periodHours = Number(deleteRule.periodHours);
  if (!Number.isFinite(periodHours) || periodHours <= 0) {
    logger.warn(
      `Rule (signal=${deleteRule.signalType} ; periodHours=${deleteRule.periodHours}) skipped: periodHours must be a positive number`,
      span,
    );
    return;
  }
  const retentionMs = periodHours * 60 * 60 * 1000;
  const deleteTimestamp = (Date.now() - retentionMs) * 1_000_000;
  const serviceName = deleteRule.serviceName?.trim() || null;
  let nbRows = 0;
  const pattern = MaintenanceFormatRetentionPattern(deleteRule.pattern);
  const params = serviceName
    ? [deleteTimestamp, pattern, serviceName]
    : [deleteTimestamp, pattern];

  if (deleteRule.signalType === "traces") {
    const result = await MaintenanceAtomicDelete(
      span,
      dbType,
      {
        postgresDeleteReturning: SQL_QUERIES.DELETE_TRACES_RETURN_DELTAS(
          serviceName,
        ),
        sqliteSelectDeltas: SQL_QUERIES.GET_TRACES_DELETE_DELTAS(serviceName),
        sqliteDelete: SQL_QUERIES.DELETE_TRACES(serviceName),
      },
      params,
    );
    nbRows += result.deletedRows;
    if (result.deletedRows > 0) {
      await SignalRollupsRecordSignalDeletion(
        "traces",
        toServiceCountDeltas(result.rows),
      );
    }
  } else if (deleteRule.signalType === "metrics") {
    const result = await MaintenanceAtomicDelete(
      span,
      dbType,
      {
        postgresDeleteReturning:
          SQL_QUERIES.DELETE_METRICS_RETURN_DELTAS(serviceName),
        sqliteSelectDeltas: SQL_QUERIES.GET_METRICS_DELETE_DELTAS(serviceName),
        sqliteDelete: SQL_QUERIES.DELETE_SIGNALS("metrics", serviceName),
      },
      params,
    );
    nbRows += result.deletedRows;
    if (result.deletedRows > 0) {
      await SignalRollupsRecordSignalDeletion(
        "metrics",
        toServiceCountDeltas(result.rows),
      );
      await SignalRollupsRecordMetricNameDeletion(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result.rows.map((row: any) => ({
          serviceName: row.serviceName,
          name: row.name,
          type: row.type,
          count: Number(row.cnt),
        })),
      );
    }
  } else {
    // logs
    const result = await MaintenanceAtomicDelete(
      span,
      dbType,
      {
        postgresDeleteReturning:
          SQL_QUERIES.DELETE_LOGS_RETURN_DELTAS(serviceName),
        sqliteSelectDeltas: SQL_QUERIES.GET_LOGS_DELETE_DELTAS(serviceName),
        sqliteDelete: SQL_QUERIES.DELETE_SIGNALS("logs", serviceName),
      },
      params,
    );
    nbRows += result.deletedRows;
    if (result.deletedRows > 0) {
      await SignalRollupsRecordSignalDeletion(
        "logs",
        toServiceCountDeltas(result.rows),
      );
    }
  }
  logger.info(
    `Rule (signal=${deleteRule.signalType} ; age > ${deleteRule.periodHours} hours ; pattern=${deleteRule.pattern} ; serviceName=${serviceName ?? "*"}) deleted ${nbRows} rows`,
    span,
  );
}

// Orphan traces (no root span ever seen). The scan is bounded to the recent
// lookback window (MAINTENANCE_ORPHAN_LOOKBACK_HOURS) so the job no longer
// full-scans the table; the 1h grace period still protects in-flight traces.
// Traces whose spans all fall outside the window are not considered.
async function MaintenanceDeleteOrphanTraces(span: Span): Promise<void> {
  const dbType = DbUtilsGetType();
  const graceEnd = (Date.now() - 60 * 60 * 1000) * 1_000_000;
  const lookbackHours = Math.max(
    Number(config.MAINTENANCE_ORPHAN_LOOKBACK_HOURS) || 24,
    1,
  );
  const lookbackStart = (Date.now() - lookbackHours * 3_600_000) * 1_000_000;
  const params = [lookbackStart, graceEnd];
  const result = await MaintenanceAtomicDelete(
    span,
    dbType,
    {
      postgresDeleteReturning: SQL_QUERIES.DELETE_ORPHAN_TRACES_RETURN_DELTAS,
      sqliteSelectDeltas: SQL_QUERIES.GET_ORPHAN_TRACES_DELTAS,
      sqliteDelete: SQL_QUERIES.DELETE_ORPHAN_TRACES,
    },
    params,
  );
  if (result.deletedRows === 0) {
    logger.info("Traces: No orphan traces to delete", span);
    return;
  }
  await SignalRollupsRecordSignalDeletion(
    "traces",
    toServiceCountDeltas(result.rows),
  );
  logger.info(`Traces: Deleted ${result.deletedRows} orphan traces`, span);
}

// Chunked duplicate-metric compression: walks forward from a persisted
// watermark toward (now - retention threshold) in bounded, bucket-aligned
// chunks; each chunk deletes duplicate rows and decrements the metric rollups
// with the pre-delete deltas. Compression keeps one row per *series* per
// bucket: the series identity is (serviceName, serviceVersion, name, type,
// attributes). Grouping only by name/service collapsed distinct label sets and
// types after 12 h.
async function MaintenanceMetricsCompress(
  context: Span,
  thresholdHours: number,
  timeGroup: number,
  chunkNs: number,
  maxChunks: number,
  stateKey: string,
): Promise<void> {
  const span = OTelTracer().startSpan("MaintenanceMetricsCompress", context);
  const dbType = DbUtilsGetType();
  try {
    const thresholdMs = Math.max(Number(thresholdHours) || 0, 1) * 3_600_000;
    const upperLimit = alignToBucket(
      Date.now() * 1_000_000 - thresholdMs * 1_000_000,
      timeGroup,
    );

    const stateRaw = await MaintenanceStateGet(span, stateKey);
    let cursor: number;
    if (stateRaw === null) {
      const minRows = await DbUtilsQuerySQL(
        span,
        SQL_QUERIES.SELECT_MIN_METRIC_TIME[dbType],
        [],
      );
      const minTime = minRows?.[0]?.minTime;
      if (minTime === null || minTime === undefined) {
        return;
      }
      cursor = alignToBucket(Number(minTime), timeGroup);
    } else {
      cursor = alignToBucket(Number(stateRaw), timeGroup);
    }
    if (!Number.isFinite(cursor) || cursor >= upperLimit) {
      return;
    }

    let processedChunks = 0;
    while (cursor < upperLimit && processedChunks < maxChunks) {
      const chunkEnd = Math.min(cursor + chunkNs, upperLimit);
      // Deliberately identical placeholder order in the delta and delete
      // statements: PG [$1,$2,$3] = [start, end, bucket]; SQLite
      // [(?),...] = [start, end, start, end, bucket].
      const chunkParams =
        dbType === "postgres"
          ? [cursor, chunkEnd, timeGroup]
          : [cursor, chunkEnd, cursor, chunkEnd, timeGroup];

      const result = await MaintenanceAtomicDelete(
        span,
        dbType,
        {
          postgresDeleteReturning:
            SQL_QUERIES.DELETE_DUPLICATE_METRICS_RETURN_DELTAS,
          sqliteSelectDeltas: SQL_QUERIES.METRICS_COMPRESS_DELTAS,
          sqliteDelete: SQL_QUERIES.DELETE_DUPLICATE_METRICS,
        },
        chunkParams,
      );
      if (result.deletedRows > 0) {
        const serviceDeltas = toServiceCountDeltas(result.rows);
        await SignalRollupsRecordSignalDeletion("metrics", serviceDeltas);
        await SignalRollupsRecordMetricNameDeletion(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result.rows.map((row: any) => ({
            serviceName: row.serviceName,
            name: row.name,
            type: row.type,
            count: Number(row.cnt),
          })),
        );
        logger.info(
          `Compression per ${timeGroup / 1_000_000_000} seconds: deleted ${result.deletedRows} duplicate metric entries`,
          span,
        );
      }
      cursor = chunkEnd;
      processedChunks++;
    }
    await MaintenanceStateSet(span, stateKey, String(cursor));
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    logger.error("Error during compression", err, span);
  }
  span.end();
}

// Private Functions

function alignToBucket(value: number, timeGroup: number): number {
  return Math.floor(value / timeGroup) * timeGroup;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toServiceCountDeltas(rows: any[]): SignalServiceCountsDelta[] {
  const map = new Map<string, SignalServiceCountsDelta>();
  for (const row of rows) {
    const key = `${row.serviceName}\u0000${row.serviceVersion}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += Number(row.cnt);
    } else {
      map.set(key, {
        serviceName: row.serviceName,
        serviceVersion: row.serviceVersion,
        count: Number(row.cnt),
      });
    }
  }
  return Array.from(map.values());
}

// Deletes rows and returns the exact per-group deltas in one atomic operation
// so ingestion happening between a separate delta SELECT and DELETE can no
// longer skew the rollups:
//   - PostgreSQL: one `DELETE ... RETURNING` data-modifying CTE.
//   - SQLite: the grouped SELECT and the DELETE run inside one IMMEDIATE
//     transaction (better-sqlite3 is synchronous and common-utils exposes no
//     transaction helper).
async function MaintenanceAtomicDelete(
  span: Span,
  dbType: "sqlite" | "postgres",
  queries: {
    postgresDeleteReturning: string;
    sqliteSelectDeltas: string;
    sqliteDelete: string;
  },
  params: unknown[],
): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[];
  deletedRows: number;
}> {
  if (dbType === "postgres") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await DbUtilsQuerySQL(
      span,
      queries.postgresDeleteReturning,
      params,
    );
    const deletedRows = rows.reduce(
      (sum, row) => sum + Number(row.cnt || 0),
      0,
    );
    return { rows, deletedRows };
  }

  await DbUtilsExecSQL(span, "BEGIN IMMEDIATE");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await DbUtilsQuerySQL(
      span,
      queries.sqliteSelectDeltas,
      params,
    );
    const deletedRows = Number(
      await DbUtilsExecSQL(span, queries.sqliteDelete, params),
    );
    await DbUtilsExecSQL(span, "COMMIT");
    return { rows, deletedRows };
  } catch (err) {
    try {
      await DbUtilsExecSQL(span, "ROLLBACK");
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_rollbackErr) {
      // best effort: the original error is the one that matters
    }
    throw err;
  }
}

async function MaintenanceStateGet(
  span: Span,
  stateKey: string,
): Promise<string | null> {
  const rows = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.GET_MAINTENANCE_STATE[DbUtilsGetType()],
    [stateKey],
  );
  return rows && rows.length > 0 ? rows[0].stateValue : null;
}

async function MaintenanceStateSet(
  span: Span,
  stateKey: string,
  stateValue: string,
): Promise<void> {
  await DbUtilsExecSQL(
    span,
    SQL_QUERIES.UPSERT_MAINTENANCE_STATE[DbUtilsGetType()],
    [stateKey, stateValue],
  );
}

// SQL

const SQL_QUERIES = {
  GET_SETTINGS: {
    postgres: 'SELECT * FROM settings WHERE "category" = $1',
    sqlite: "SELECT * FROM settings WHERE category = ?",
  },
  // SQLite: the grouped-delta SELECT and the DELETE run inside one IMMEDIATE
  // transaction (see MaintenanceAtomicDelete).
  DELETE_TRACES: (serviceName: string | null) =>
    "DELETE FROM traces WHERE startTime < ? AND keywords LIKE ? ESCAPE '\\'" +
    (serviceName ? " AND serviceName = ?" : ""),
  GET_TRACES_DELETE_DELTAS: (serviceName: string | null) =>
    "SELECT serviceName, serviceVersion, COUNT(*) AS cnt FROM traces WHERE startTime < ? AND keywords LIKE ? ESCAPE '\\'" +
    (serviceName ? " AND serviceName = ?" : "") +
    " GROUP BY serviceName, serviceVersion",
  DELETE_SIGNALS: (tableName: string, serviceName: string | null) =>
    `DELETE FROM ${tableName} WHERE time < ? AND keywords LIKE ? ESCAPE '\\'` +
    (serviceName ? " AND serviceName = ?" : ""),
  GET_METRICS_DELETE_DELTAS: (serviceName: string | null) =>
    "SELECT serviceName, serviceVersion, name, type, COUNT(*) AS cnt FROM metrics WHERE time < ? AND keywords LIKE ? ESCAPE '\\'" +
    (serviceName ? " AND serviceName = ?" : "") +
    " GROUP BY serviceName, serviceVersion, name, type",
  GET_LOGS_DELETE_DELTAS: (serviceName: string | null) =>
    "SELECT serviceName, serviceVersion, COUNT(*) AS cnt FROM logs WHERE time < ? AND keywords LIKE ? ESCAPE '\\'" +
    (serviceName ? " AND serviceName = ?" : "") +
    " GROUP BY serviceName, serviceVersion",
  DELETE_ORPHAN_TRACES:
    "DELETE FROM traces WHERE traceId IN (" +
    "SELECT traceId FROM traces WHERE startTime >= ? GROUP BY traceId" +
    "  HAVING SUM(CASE WHEN parentSpanId IS NULL THEN 1 ELSE 0 END) = 0" +
    "         AND MAX(startTime) < ?)",
  GET_ORPHAN_TRACES_DELTAS:
    "SELECT serviceName, serviceVersion, COUNT(*) AS cnt FROM traces WHERE traceId IN (" +
    "SELECT traceId FROM traces WHERE startTime >= ? GROUP BY traceId" +
    "  HAVING SUM(CASE WHEN parentSpanId IS NULL THEN 1 ELSE 0 END) = 0" +
    "         AND MAX(startTime) < ?) GROUP BY serviceName, serviceVersion",
  // PostgreSQL: one data-modifying CTE returns exactly the deleted rows, so
  // the deltas cannot drift from concurrent ingestion.
  DELETE_TRACES_RETURN_DELTAS: (serviceName: string | null) =>
    `WITH deleted AS (` +
    `DELETE FROM traces WHERE "startTime" < $1 AND "keywords" LIKE $2 ESCAPE '\\'` +
    (serviceName ? ' AND "serviceName" = $3' : "") +
    ` RETURNING "serviceName", "serviceVersion")` +
    ` SELECT "serviceName", "serviceVersion", COUNT(*) AS cnt FROM deleted` +
    ` GROUP BY "serviceName", "serviceVersion"`,
  DELETE_METRICS_RETURN_DELTAS: (serviceName: string | null) =>
    `WITH deleted AS (` +
    `DELETE FROM metrics WHERE "time" < $1 AND "keywords" LIKE $2 ESCAPE '\\'` +
    (serviceName ? ' AND "serviceName" = $3' : "") +
    ` RETURNING "serviceName", "serviceVersion", "name", "type")` +
    ` SELECT "serviceName", "serviceVersion", "name", "type", COUNT(*) AS cnt FROM deleted` +
    ` GROUP BY "serviceName", "serviceVersion", "name", "type"`,
  DELETE_LOGS_RETURN_DELTAS: (serviceName: string | null) =>
    `WITH deleted AS (` +
    `DELETE FROM logs WHERE "time" < $1 AND "keywords" LIKE $2 ESCAPE '\\'` +
    (serviceName ? ' AND "serviceName" = $3' : "") +
    ` RETURNING "serviceName", "serviceVersion")` +
    ` SELECT "serviceName", "serviceVersion", COUNT(*) AS cnt FROM deleted` +
    ` GROUP BY "serviceName", "serviceVersion"`,
  DELETE_ORPHAN_TRACES_RETURN_DELTAS:
    'WITH deleted AS (' +
    'DELETE FROM traces WHERE "traceId" IN (' +
    'SELECT "traceId" FROM traces WHERE "startTime" >= $1 GROUP BY "traceId"' +
    ' HAVING SUM(CASE WHEN "parentSpanId" IS NULL THEN 1 ELSE 0 END) = 0' +
    ' AND MAX("startTime") < $2)' +
    ' RETURNING "serviceName", "serviceVersion")' +
    ' SELECT "serviceName", "serviceVersion", COUNT(*) AS cnt FROM deleted' +
    ' GROUP BY "serviceName", "serviceVersion"',
  DELETE_DUPLICATE_METRICS_RETURN_DELTAS: `WITH deleted AS (
    DELETE FROM metrics a
      USING metrics b
      WHERE a."name" = b."name"
        AND a."serviceName" = b."serviceName"
        AND a."serviceVersion" = b."serviceVersion"
        AND a."type" = b."type"
        AND a."attributes" = b."attributes"
        AND CAST(a."time" / $3 AS INTEGER) = CAST(b."time" / $3 AS INTEGER)
        AND a."time" >= $1 AND a."time" < $2
        AND b."time" >= $1 AND b."time" < $2
        AND a.ctid < b.ctid
      RETURNING a."serviceName", a."serviceVersion", a."name", a."type")
    SELECT "serviceName", "serviceVersion", "name", "type", COUNT(*) AS cnt FROM deleted
    GROUP BY "serviceName", "serviceVersion", "name", "type"`,
  SELECT_MIN_METRIC_TIME: {
    postgres: 'SELECT MIN("time") AS "minTime" FROM metrics',
    sqlite: "SELECT MIN(time) AS minTime FROM metrics",
  },
  METRICS_COMPRESS_DELTAS:
    "SELECT serviceName, serviceVersion, name, type, COUNT(*) AS cnt FROM metrics" +
    " WHERE time >= ? AND time < ? AND rowid NOT IN (" +
    "   SELECT MAX(rowid) FROM metrics WHERE time >= ? AND time < ?" +
    "   GROUP BY name, serviceName, serviceVersion, type, attributes, CAST(time / ? AS INTEGER))" +
    " GROUP BY serviceName, serviceVersion, name, type",
  DELETE_DUPLICATE_METRICS:
    "DELETE FROM metrics" +
    " WHERE time >= ? AND time < ? AND rowid NOT IN (" +
    "   SELECT MAX(rowid) FROM metrics WHERE time >= ? AND time < ?" +
    "   GROUP BY name, serviceName, serviceVersion, type, attributes, CAST(time / ? AS INTEGER))",
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
};
