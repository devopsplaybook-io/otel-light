import { SpanStatusCode } from "@opentelemetry/api";
import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "./Config";
import { Settings } from "./model/Settings";
import { OTelLogger, OTelTracer } from "./OTelContext";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsGetType,
} from "./utils-std-ts/DbUtils";

const logger = OTelLogger().createModuleLogger("Maintenance");
let config: Config;

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

    const rawSettings = await DbUtilsQuerySQL(
      span,
      SQL_QUERIES.GET_SETTINGS[DbUtilsGetType()],
      ["signal-cleanup-rules"],
    );
    if (!rawSettings || rawSettings.length === 0) {
      span.end();
      return;
    }

    const settings = new Settings(rawSettings[0]);
    for (const deleteRule of settings.content.deleteRules || []) {
      let tableName;
      switch (deleteRule.signalType) {
        case "traces":
          tableName = "traces";
          break;
        case "metrics":
          tableName = "metrics";
          break;
        case "logs":
          tableName = "logs";
          break;
        default:
          continue;
      }
      if (!tableName) continue;
      if (!deleteRule.pattern) continue;
      const retentionMs = Number(deleteRule.periodHours) * 60 * 60 * 1000;
      const deleteTimestamp = (Date.now() - retentionMs) * 1_000_000;
      let nbRows = 0;
      const formatPattern = (patternIn) => {
        return ("%" + patternIn + "%")
          .toLowerCase()
          .replace(/\*/g, "%")
          .replace(/%+/g, "%");
      };
      if (deleteRule.signalType === "traces") {
        nbRows += await DbUtilsExecSQL(
          span,
          SQL_QUERIES.SELECT_TRACES_TO_DELETE[DbUtilsGetType()],
          [deleteTimestamp, formatPattern(deleteRule.pattern)],
        );
        nbRows += await DbUtilsExecSQL(
          span,
          SQL_QUERIES.DELETE_TRACES[DbUtilsGetType()],
          [deleteTimestamp, formatPattern(deleteRule.pattern)],
        );
      } else {
        nbRows += await DbUtilsExecSQL(
          span,
          SQL_QUERIES.DELETE_SIGNALS(tableName)[DbUtilsGetType()],
          [deleteTimestamp, formatPattern(deleteRule.pattern)],
        );
      }
      logger.info(
        `Rule (signal=${deleteRule.signalType} ; age > ${deleteRule.periodHours} hours ; pattern=${deleteRule.pattern}) deleted ${nbRows} rows`,
        span,
      );
    }

    const deleteTimestamp = (Date.now() - 60 * 60 * 1000) * 1_000_000;
    const ndOrphanTraces = await DbUtilsExecSQL(
      span,
      SQL_QUERIES.DELETE_ORPHAN_TRACES[DbUtilsGetType()],
      [deleteTimestamp],
    );
    logger.info(`Traces: Deleted ${ndOrphanTraces} orphan traces`, span);
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    logger.error("Error during maintenance tasks", err, span);
  }

  await MaintenanceMetricsCompress(
    span,
    (Date.now() - config.METRICS_COMPRESS_MINUTE_THRESHOLD_HOURS * 3_600_000) *
      1_000_000,
    60 * 1_000_000_000,
  );
  await MaintenanceMetricsCompress(
    span,
    (Date.now() -
      config.METRICS_COMPRESS_HOUR_THRESHOLD_DAYS * 24 * 3_600_000) *
      1_000_000,
    3600 * 1_000_000_000,
  );

  span.end();

  setTimeout(
    () => {
      MaintenancePerform().catch((err) => {
        logger.error("Error during maintenance tasks", err, span);
      });
    },
    Math.max(config.MAINTENANCE_FREQUENCY_HOURS, 1) * 3600 * 1000,
  );
}

// Private Function

async function MaintenanceMetricsCompress(
  context: Span,
  timeLimit: number,
  timeGroup: number,
) {
  const span = OTelTracer().startSpan("MaintenanceMetricsCompress", context);
  try {
    logger.info(`Compression per ${timeGroup / 1_000_000_000} seconds`, span);
    const deletedRows = await DbUtilsExecSQL(
      span,
      SQL_QUERIES.DELETE_DUPLICATE_METRICS[DbUtilsGetType()],
      [timeLimit, timeGroup, timeLimit],
    );
    logger.info(
      `Compression: Deleted ${deletedRows} duplicate metric entries`,
      span,
    );
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    logger.error("Error during compression", err, span);
  }
  span.end();
}

// SQL

const SQL_QUERIES = {
  GET_SETTINGS: {
    postgres: 'SELECT * FROM settings WHERE "category" = $1',
    sqlite: "SELECT * FROM settings WHERE category = ?",
  },
  SELECT_TRACES_TO_DELETE: {
    postgres:
      'SELECT * FROM traces tp, traces tc  WHERE tp."traceId" = tc."traceId" AND tp."startTime" < $1 AND tp."keywords" LIKE $2',
    sqlite:
      "SELECT * FROM traces tp, traces tc  WHERE tp.traceId = tc.traceId AND tp.startTime < ? AND tp.keywords LIKE ?",
  },
  DELETE_TRACES: {
    postgres:
      'DELETE FROM traces WHERE "startTime" < $1 AND "keywords" LIKE $2',
    sqlite: "DELETE FROM traces WHERE startTime < ? AND keywords LIKE ?",
  },
  DELETE_SIGNALS: (tableName: string) => ({
    postgres: `DELETE FROM ${tableName} WHERE "time" < $1 AND "keywords" LIKE $2`,
    sqlite: `DELETE FROM ${tableName} WHERE time < ? AND keywords LIKE ?`,
  }),
  DELETE_ORPHAN_TRACES: {
    postgres:
      'DELETE FROM traces  WHERE "traceId" ' +
      ' IN ( SELECT "traceId" FROM traces GROUP BY "traceId" ' +
      '  HAVING SUM(CASE WHEN "parentSpanId" IS NULL THEN 1 ELSE 0 END) = 0 ' +
      '         AND MAX("startTime") < $1 )',
    sqlite:
      "DELETE FROM traces  WHERE traceId " +
      " IN ( SELECT traceId FROM traces GROUP BY traceId " +
      "  HAVING SUM(CASE WHEN parentSpanId IS NULL THEN 1 ELSE 0 END) = 0 " +
      "         AND MAX(startTime) < ? )",
  },
  DELETE_DUPLICATE_METRICS: {
    postgres: `WITH KeepRows AS (
         SELECT MAX(rowid) as keep_rowid
         FROM metrics
         WHERE "time" < $1
         GROUP BY "name", "serviceName", CAST("time" / $2 AS INTEGER)
       )
       DELETE FROM metrics
       WHERE "time" < $3 AND rowid NOT IN (SELECT keep_rowid FROM KeepRows)`,
    sqlite: `WITH KeepRows AS (
         SELECT MAX(rowid) as keep_rowid
         FROM metrics
         WHERE time < ?
         GROUP BY name, serviceName, CAST(time / ? AS INTEGER)
       )
       DELETE FROM metrics
       WHERE time < ? AND rowid NOT IN (SELECT keep_rowid FROM KeepRows)`,
  },
};
