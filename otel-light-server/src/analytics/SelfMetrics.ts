import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "../Config";
import { OTelLogger, OTelMeter, OTelTracer } from "../OTelContext";
import { SignalRollupsGetAllCounts } from "../SignalRollups";

const logger = OTelLogger().createModuleLogger("SelfMetrics");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const signalData: { traces: any[]; metrics: any[]; logs: any[] } = {
  traces: [],
  metrics: [],
  logs: [],
};

let config: Config;

export async function SelfMetricsInit(context: Span, configIn: Config) {
  config = configIn;
  const span = OTelTracer().startSpan("SelfMetricsInit", context);
  OTelMeter().createObservableGauge(
    "signals.traces",
    (observableResult) => {
      signalData.traces.forEach((service) => {
        const serviceTag = `${service.name}:${service.version}`;
        observableResult.observe(service.traces, {
          service: `${serviceTag ? serviceTag : "unknown service"}`,
        });
      });
    },
    "Count of traces per services",
  );
  OTelMeter().createObservableGauge(
    "signals.metrics",
    (observableResult) => {
      signalData.metrics.forEach((service) => {
        const serviceTag = `${service.name}:${service.version}`;
        observableResult.observe(service.metrics, {
          service: `${serviceTag ? serviceTag : "unknown service"}`,
        });
      });
    },
    "Count of metrics per services",
  );
  OTelMeter().createObservableGauge(
    "signals.logs",
    (observableResult) => {
      signalData.logs.forEach((service) => {
        const serviceTag = `${service.name}:${service.version}`;
        observableResult.observe(service.logs, {
          service: `${serviceTag ? serviceTag : "unknown service"}`,
        });
      });
    },
    "Count of logs per services",
  );
  OTelMeter().createObservableGauge(
    "signals.totals",
    (observableResult) => {
      const totalTraces = signalData.traces.reduce(
        (sum, service) => sum + (service.traces || 0),
        0,
      );
      observableResult.observe(totalTraces, { signal: "traces" });
      const totalMetrics = signalData.metrics.reduce(
        (sum, service) => sum + (service.metrics || 0),
        0,
      );
      observableResult.observe(totalMetrics, { signal: "metrics" });
      const totalLogs = signalData.logs.reduce(
        (sum, service) => sum + (service.logs || 0),
        0,
      );
      observableResult.observe(totalLogs, { signal: "logs" });
    },
    "Total count of each signal type across all services",
  );

  SelfMetricsRefreshMetrics();
  setInterval(() => {
    SelfMetricsRefreshMetrics();
  }, config.METRICS_SELF_REFRESH_MINUTES * 60_000);

  span.end();
}

// Private Functions

async function SelfMetricsRefreshMetrics(): Promise<void> {
  const span = OTelTracer().startSpan("SelfMetricsRefreshMetrics");
  try {
    // Rollup read instead of three full-table COUNT GROUP BY scans (M4)
    const rows = await SignalRollupsGetAllCounts();
    const traces = [];
    const metrics = [];
    const logs = [];
    for (const row of rows) {
      const entry = {
        name: row.serviceName,
        version: row.serviceVersion,
      };
      if (row.signalType === "traces") {
        traces.push({ ...entry, traces: row.count });
      } else if (row.signalType === "metrics") {
        metrics.push({ ...entry, metrics: row.count });
      } else if (row.signalType === "logs") {
        logs.push({ ...entry, logs: row.count });
      }
    }
    signalData.traces = traces;
    signalData.metrics = metrics;
    signalData.logs = logs;
  } catch (err) {
    // Keep the previous values on failure rather than resetting to empty
    logger.error("Failed to refresh self metrics from signal rollups", err, span);
  }
  span.end();
}
