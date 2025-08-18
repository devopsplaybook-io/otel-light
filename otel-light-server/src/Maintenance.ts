import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "./Config";
import { Logger } from "./utils-std-ts/Logger";
import { SqlDbUtilsNoTelemetryExecSQL } from "./utils-std-ts/SqlDbUtilsNoTelemetry";
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

async function MaintenancePerform() {
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
      let timeColumn = "time";
      switch (deleteRule.signalType) {
        case "traces":
          tableName = "traces";
          timeColumn = "startTime";
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
      const nbRows = await SqlDbUtilsExecSQL(
        span,
        `DELETE FROM ${tableName} WHERE ${timeColumn} < ? AND keywords LIKE ?`,
        [deleteTimestamp, deleteRule.pattern.replace("*", "%")]
      );
      logger.info(
        `Rule (signal=${deleteRule.signalType} ; age > ${deleteRule.periodHours} hours ; pattern=${deleteRule.pattern}) deleted ${nbRows} rows`
      );
    }
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    logger.error("Error during maintenance tasks: " + err.message);
  }
  span.end();

  setTimeout(() => {
    MaintenancePerform().catch((err) => {
      logger.error("Error during maintenance tasks: " + err.message);
    });
  }, 6 * 3600 * 1000);
}
