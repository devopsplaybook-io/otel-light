import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "./Config";
import { Logger } from "./utils-std-ts/Logger";
import { StandardTracerStartSpan } from "./utils-std-ts/StandardTracer";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "./utils-std-ts/SqlDbUtils";
import { Settings } from "./model/Settings";
import { SpanStatusCode } from "@opentelemetry/api";

const logger = new Logger("Maintenance");
let config: Config;

export async function MaintenanceInit(context: Span, configIn: Config) {
  const span = StandardTracerStartSpan("MaintenanceInit", context);

  config = configIn;
  span.end();
  MaintenancePerform().catch((err) => {
    logger.error("Error during maintenance tasks: " + err.message);
  });
}

// Private Functions

async function MaintenancePerform(): Promise<void> {
  const span = StandardTracerStartSpan("MaintenancePerform");
  try {
    logger.info("Performing maintenance tasks");

    const rawSettings = await SqlDbUtilsQuerySQL(
      span,
      "SELECT * FROM settings WHERE category = ?",
      ["signal-cleanup-rules"]
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
      if (!deleteRule.periodHours) continue;
      if (!deleteRule.pattern) continue;
      const retentionMs = deleteRule.periodHours * 60 * 60 * 1000;
      const deleteTimestamp = (Date.now() - retentionMs) * 1_000_000;
      let nbRows = 0;
      if (deleteRule.signalType === "traces") {
        nbRows += await SqlDbUtilsExecSQL(
          span,
          `DELETE FROM traces WHERE traceId IN (SELECT traceId FROM traces WHERE startTime < ? AND keywords LIKE ?)`,
          [deleteTimestamp, deleteRule.pattern.replace("*", "%")]
        );
        nbRows += await SqlDbUtilsExecSQL(
          span,
          `DELETE FROM traces WHERE startTime < ? AND keywords LIKE ?`,
          [deleteTimestamp, deleteRule.pattern.replace("*", "%")]
        );
      } else {
        nbRows += await SqlDbUtilsExecSQL(
          span,
          `DELETE FROM ${tableName} WHERE time < ? AND keywords LIKE ?`,
          [deleteTimestamp, deleteRule.pattern.replace("*", "%")]
        );
      }
      logger.info(
        `Rule (signal=${deleteRule.signalType} ; age > ${deleteRule.periodHours} hours ; pattern=${deleteRule.pattern}) deleted ${nbRows} rows`
      );
    }

    const deleteTimestamp = (Date.now() - 60 * 60 * 1000) * 1_000_000;
    const ndOrphanTraces = await SqlDbUtilsExecSQL(
      span,
      "DELETE FROM traces  WHERE traceId " +
        " IN ( SELECT traceId FROM traces GROUP BY traceId " +
        "  HAVING SUM(CASE WHEN parentSpanId IS NULL THEN 1 ELSE 0 END) = 0 " +
        "         AND MAX(startTime) < ? )",
      [deleteTimestamp]
    );
    logger.info(`Traces: Deleted ${ndOrphanTraces} orphan traces`);
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    logger.error("Error during maintenance tasks: " + err.message);
  }

  await MaintenanceMetricsCompress(
    (Date.now() - config.METRICS_COMPRESS_MINUTE_THRESHOLD_HOURS * 3_600_000) *
      1_000_000,
    60 * 1_000_000_000
  );
  await MaintenanceMetricsCompress(
    (Date.now() -
      config.METRICS_COMPRESS_HOUR_THRESHOLD_DAYS * 24 * 3_600_000) *
      1_000_000,
    3600 * 1_000_000_000
  );

  span.end();

  setTimeout(() => {
    MaintenancePerform().catch((err) => {
      logger.error("Error during maintenance tasks: " + err.message);
    });
  }, 6 * 3600 * 1000);
}

// Private Function

async function MaintenanceMetricsCompress(
  timeLimit: number,
  timeGroup: number
) {
  const span = StandardTracerStartSpan("MaintenanceMetricsCompress");
  try {
    logger.info(`Compression per ${timeGroup / 1_000_000_000} seconds`);
    const deletedRows = await SqlDbUtilsExecSQL(
      span,
      `DELETE FROM metrics 
       WHERE rowid NOT IN (
         SELECT MAX(rowid) 
         FROM metrics 
         WHERE time < ?
         GROUP BY 
           (time / ?)
       )`,
      [timeLimit, timeGroup]
    );
    logger.info(`Compression: Deleted ${deletedRows} duplicate metric entries`);
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    logger.error("Error during compression: " + err.message);
  }
  span.end();
}
