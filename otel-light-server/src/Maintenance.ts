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
  MaintenancePerform();
}

// Private Functions

async function MaintenancePerform() {
  logger.info("Performing maintenance tasks");
  const span = StandardTracerStartSpan("MaintenancePerform");
  const retentionMs = config.TRACES_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const traceDeleteTimestamp = (Date.now() - retentionMs) * 1_000_000;
  await SqlDbUtilsNoTelemetryExecSQL("DELETE FROM traces WHERE startTime < ?", [
    traceDeleteTimestamp,
  ]);
  span.end();

  setTimeout(() => {
    MaintenancePerform();
  }, 6 * 3600 * 1000);
}
