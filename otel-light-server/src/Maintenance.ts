import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "./Config";
import { Logger } from "./utils-std-ts/Logger";
import { SqlDbUtilsNoTelemetryExecSQL } from "./utils-std-ts/SqlDbUtilsNoTelemetry";
import { StandardTracerStartSpan } from "./utils-std-ts/StandardTracer";

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
  logger.info("Performing maintenance tasks");
  const span = StandardTracerStartSpan("MaintenancePerform");

  const traceRetentionMs = config.TRACES_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const traceDeleteTimestamp = (Date.now() - traceRetentionMs) * 1_000_000;
  await SqlDbUtilsNoTelemetryExecSQL("DELETE FROM traces WHERE startTime < ?", [
    traceDeleteTimestamp,
  ]);

  const metricsRetentionMs =
    config.METRICS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const metricsDeleteTimestamp = (Date.now() - metricsRetentionMs) * 1_000_000;
  await SqlDbUtilsNoTelemetryExecSQL("DELETE FROM metrics WHERE time < ?", [
    metricsDeleteTimestamp,
  ]);

  const logsRetentionMs = config.LOGS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const logsDeleteTimestamp = (Date.now() - logsRetentionMs) * 1_000_000;
  await SqlDbUtilsNoTelemetryExecSQL("DELETE FROM logs WHERE time < ?", [
    logsDeleteTimestamp,
  ]);

  span.end();

  setTimeout(() => {
    MaintenancePerform().catch((err) => {
      logger.error("Error during maintenance tasks: " + err.message);
    });
  }, 6 * 3600 * 1000);
}
