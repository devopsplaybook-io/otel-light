import { SpanStatusCode } from "@opentelemetry/api";
import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "./Config";
import { Settings } from "./model/Settings";
import { OTelLogger, OTelTracer } from "./OTelContext";
import {
  SignalRollupsEnsureInitialized,
  SignalRollupsRecordMetricNameDeletion,
  SignalRollupsRecordSignalDeletion,
  SignalServiceCountsDelta,
} from "./SignalRollups";
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
    return;
  }
  if (!deleteRule.pattern) return;
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
  const formatPattern = (patternIn) => {
    return ("%" + patternIn + "%")
      .toLowerCase()
      .replace(/\*/g, "%")
      .replace(/%+/g, "%");
  };
  const params = serviceName
    ? [deleteTimestamp, formatPattern(deleteRule.pattern), serviceName]
    : [deleteTimestamp, formatPattern(deleteRule.pattern)];

  if (deleteRule.signalType === "traces") {
    const deltas = await DbUtilsQuerySQL(
      span,
      SQL_QUERIES.GET_TRACES_DELETE_DELTAS(serviceName)[dbType],
      params,
    );
    if (deltas.length > 0) {
      nbRows += await DbUtilsExecSQL(
        span,
        SQL_QUERIES.DELETE_TRACES(serviceName)[dbType],
        params,
      );
      await SignalRollupsRecordSignalDeletion(
        "traces",
        toServiceCountDeltas(deltas),
      );
    }
  } else if (deleteRule.signalType === "metrics") {
    const deltas = await DbUtilsQuerySQL(
      span,
      SQL_QUERIES.GET_METRICS_DELETE_DELTAS(serviceName)[dbType],
      params,
    );
    if (deltas.length > 0) {
      nbRows += await DbUtilsExecSQL(
        span,
        SQL_QUERIES.DELETE_SIGNALS("metrics", serviceName)[dbType],
        params,
      );
      await SignalRollupsRecordSignalDeletion(
        "metrics",
        toServiceCountDeltas(deltas),
      );
      await SignalRollupsRecordMetricNameDeletion(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        deltas.map((row: any) => ({
          serviceName: row.serviceName,
          name: row.name,
          type: row.type,
          count: Number(row.cnt),
        })),
      );
    }
  } else {
    // logs
    const deltas = await DbUtilsQuerySQL(
      span,
      SQL_QUERIES.GET_LOGS_DELETE_DELTAS(serviceName)[dbType],
      params,
    );
    if (deltas.length > 0) {
      nbRows += await DbUtilsExecSQL(
        span,
        SQL_QUERIES.DELETE_SIGNALS("logs", serviceName)[dbType],
        params,
      );
      await SignalRollupsRecordSignalDeletion(
        "logs",
        toServiceCountDeltas(deltas),
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
  const deltas = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.GET_ORPHAN_TRACES_DELTAS[dbType],
    params,
  );
  if (deltas.length === 0) {
    logger.info("Traces: No orphan traces to delete", span);
    return;
  }
  const nbRows = await DbUtilsExecSQL(
    span,
    SQL_QUERIES.DELETE_ORPHAN_TRACES[dbType],
    params,
  );
  await SignalRollupsRecordSignalDeletion(
    "traces",
    toServiceCountDeltas(deltas),
  );
  logger.info(`Traces: Deleted ${nbRows} orphan traces`, span);
}

// Chunked duplicate-metric compression: walks forward from a persisted
// watermark toward (now - retention threshold) in bounded, bucket-aligned
// chunks; each chunk deletes duplicate rows (same name/service/bucket) and
// decrements the metric rollups with the pre-delete deltas.
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

      const deltas = await DbUtilsQuerySQL(
        span,
        SQL_QUERIES.METRICS_COMPRESS_DELTAS[dbType],
        chunkParams,
      );
      const deletedRows = await DbUtilsExecSQL(
        span,
        SQL_QUERIES.DELETE_DUPLICATE_METRICS[dbType],
        chunkParams,
      );
      if (deletedRows > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serviceDeltas = toServiceCountDeltas(deltas);
        await SignalRollupsRecordSignalDeletion("metrics", serviceDeltas);
        await SignalRollupsRecordMetricNameDeletion(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          deltas.map((row: any) => ({
            serviceName: row.serviceName,
            name: row.name,
            type: row.type,
            count: Number(row.cnt),
          })),
        );
        logger.info(
          `Compression per ${timeGroup / 1_000_000_000} seconds: deleted ${deletedRows} duplicate metric entries`,
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
  DELETE_TRACES: (serviceName: string | null) => ({
    postgres:
      'DELETE FROM traces WHERE "startTime" < $1 AND "keywords" LIKE $2' +
      (serviceName ? ' AND "serviceName" = $3' : ""),
    sqlite:
      "DELETE FROM traces WHERE startTime < ? AND keywords LIKE ?" +
      (serviceName ? " AND serviceName = ?" : ""),
  }),
  GET_TRACES_DELETE_DELTAS: (serviceName: string | null) => ({
    postgres:
      'SELECT "serviceName", "serviceVersion", COUNT(*) AS cnt FROM traces WHERE "startTime" < $1 AND "keywords" LIKE $2' +
      (serviceName ? ' AND "serviceName" = $3' : "") +
      ' GROUP BY "serviceName", "serviceVersion"',
    sqlite:
      "SELECT serviceName, serviceVersion, COUNT(*) AS cnt FROM traces WHERE startTime < ? AND keywords LIKE ?" +
      (serviceName ? " AND serviceName = ?" : "") +
      " GROUP BY serviceName, serviceVersion",
  }),
  DELETE_SIGNALS: (tableName: string, serviceName: string | null) => ({
    postgres:
      `DELETE FROM ${tableName} WHERE "time" < $1 AND "keywords" LIKE $2` +
      (serviceName ? ' AND "serviceName" = $3' : ""),
    sqlite:
      `DELETE FROM ${tableName} WHERE time < ? AND keywords LIKE ?` +
      (serviceName ? " AND serviceName = ?" : ""),
  }),
  GET_METRICS_DELETE_DELTAS: (serviceName: string | null) => ({
    postgres:
      'SELECT "serviceName", "serviceVersion", "name", "type", COUNT(*) AS cnt FROM metrics WHERE "time" < $1 AND "keywords" LIKE $2' +
      (serviceName ? ' AND "serviceName" = $3' : "") +
      ' GROUP BY "serviceName", "serviceVersion", "name", "type"',
    sqlite:
      "SELECT serviceName, serviceVersion, name, type, COUNT(*) AS cnt FROM metrics WHERE time < ? AND keywords LIKE ?" +
      (serviceName ? " AND serviceName = ?" : "") +
      " GROUP BY serviceName, serviceVersion, name, type",
  }),
  GET_LOGS_DELETE_DELTAS: (serviceName: string | null) => ({
    postgres:
      'SELECT "serviceName", "serviceVersion", COUNT(*) AS cnt FROM logs WHERE "time" < $1 AND "keywords" LIKE $2' +
      (serviceName ? ' AND "serviceName" = $3' : "") +
      ' GROUP BY "serviceName", "serviceVersion"',
    sqlite:
      "SELECT serviceName, serviceVersion, COUNT(*) AS cnt FROM logs WHERE time < ? AND keywords LIKE ?" +
      (serviceName ? " AND serviceName = ?" : "") +
      " GROUP BY serviceName, serviceVersion",
  }),
  DELETE_ORPHAN_TRACES: {
    postgres:
      'DELETE FROM traces WHERE "traceId" IN (' +
      'SELECT "traceId" FROM traces WHERE "startTime" >= $1 GROUP BY "traceId"' +
      ' HAVING SUM(CASE WHEN "parentSpanId" IS NULL THEN 1 ELSE 0 END) = 0' +
      ' AND MAX("startTime") < $2)',
    sqlite:
      "DELETE FROM traces WHERE traceId IN (" +
      "SELECT traceId FROM traces WHERE startTime >= ? GROUP BY traceId" +
      "  HAVING SUM(CASE WHEN parentSpanId IS NULL THEN 1 ELSE 0 END) = 0" +
      "         AND MAX(startTime) < ?)",
  },
  GET_ORPHAN_TRACES_DELTAS: {
    postgres:
      'SELECT "serviceName", "serviceVersion", COUNT(*) AS cnt FROM traces WHERE "traceId" IN (' +
      'SELECT "traceId" FROM traces WHERE "startTime" >= $1 GROUP BY "traceId"' +
      ' HAVING SUM(CASE WHEN "parentSpanId" IS NULL THEN 1 ELSE 0 END) = 0' +
      ' AND MAX("startTime") < $2) GROUP BY "serviceName", "serviceVersion"',
    sqlite:
      "SELECT serviceName, serviceVersion, COUNT(*) AS cnt FROM traces WHERE traceId IN (" +
      "SELECT traceId FROM traces WHERE startTime >= ? GROUP BY traceId" +
      "  HAVING SUM(CASE WHEN parentSpanId IS NULL THEN 1 ELSE 0 END) = 0" +
      "         AND MAX(startTime) < ?) GROUP BY serviceName, serviceVersion",
  },
  SELECT_MIN_METRIC_TIME: {
    postgres: 'SELECT MIN("time") AS "minTime" FROM metrics',
    sqlite: "SELECT MIN(time) AS minTime FROM metrics",
  },
  METRICS_COMPRESS_DELTAS: {
    postgres:
      'SELECT a."serviceName", a."serviceVersion", a."name", a."type", COUNT(*) AS cnt FROM metrics a' +
      ' WHERE a."time" >= $1 AND a."time" < $2' +
      '   AND EXISTS (' +
      '     SELECT 1 FROM metrics b' +
      '     WHERE b."name" = a."name" AND b."serviceName" = a."serviceName"' +
      '       AND CAST(b."time" / $3 AS INTEGER) = CAST(a."time" / $3 AS INTEGER)' +
      '       AND b."time" >= $1 AND b."time" < $2' +
      '       AND b.ctid > a.ctid)' +
      ' GROUP BY a."serviceName", a."serviceVersion", a."name", a."type"',
    sqlite:
      "SELECT serviceName, serviceVersion, name, type, COUNT(*) AS cnt FROM metrics" +
      " WHERE time >= ? AND time < ? AND rowid NOT IN (" +
      "   SELECT MAX(rowid) FROM metrics WHERE time >= ? AND time < ?" +
      "   GROUP BY name, serviceName, CAST(time / ? AS INTEGER))" +
      " GROUP BY serviceName, serviceVersion, name, type",
  },
  DELETE_DUPLICATE_METRICS: {
    postgres: `DELETE FROM metrics a
       USING metrics b
       WHERE a."name" = b."name"
         AND a."serviceName" = b."serviceName"
         AND CAST(a."time" / $3 AS INTEGER) = CAST(b."time" / $3 AS INTEGER)
         AND a."time" >= $1 AND a."time" < $2
         AND b."time" >= $1 AND b."time" < $2
         AND a.ctid < b.ctid`,
    sqlite:
      "DELETE FROM metrics" +
      " WHERE time >= ? AND time < ? AND rowid NOT IN (" +
      "   SELECT MAX(rowid) FROM metrics WHERE time >= ? AND time < ?" +
      "   GROUP BY name, serviceName, CAST(time / ? AS INTEGER))",
  },
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
