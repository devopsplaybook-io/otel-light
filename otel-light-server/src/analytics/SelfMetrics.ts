import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "../Config";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { SqlDbUtilsQuerySQL } from "../utils-std-ts/SqlDbUtils";
import { StandardMeterCreateObservableGauge } from "../utils-std-ts/StandardMeter";

const signalData = {
  traces: { count: 0 },
  metrics: { count: 0 },
  logs: { count: 0 },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function SelfMetricsInit(context: Span, configIn: Config) {
  const span = StandardTracerStartSpan("SelfMetricsInit", context);
  StandardMeterCreateObservableGauge(
    "signals.storage",
    (observableResult) => {
      observableResult.observe(signalData.traces.count, { signal: "traces" });
      observableResult.observe(signalData.metrics.count, { signal: "metrics" });
      observableResult.observe(signalData.logs.count, { signal: "logs" });
    },
    { description: "Signal storage counts" }
  );
  SelfMetricsRefreshMetrics();

  span.end();
}

// Private Functions

async function SelfMetricsRefreshMetrics(): Promise<void> {
  const span = StandardTracerStartSpan("SelfMetricsRefreshMetrics");
  const tracesRowCount = await SqlDbUtilsQuerySQL(
    span,
    "SELECT COUNT(*) as nbtraces FROM traces"
  );
  signalData.traces.count = tracesRowCount[0].nbtraces;
  const metricsRowCount = await SqlDbUtilsQuerySQL(
    span,
    "SELECT COUNT(*) as nbmetrics FROM metrics"
  );
  signalData.metrics.count = metricsRowCount[0].nbmetrics;
  const logsRowCount = await SqlDbUtilsQuerySQL(
    span,
    "SELECT COUNT(*) as nblogs FROM logs"
  );
  signalData.logs.count = logsRowCount[0].nblogs;
  span.end();
  setTimeout(() => {
    SelfMetricsRefreshMetrics();
  }, 60_000);
}
