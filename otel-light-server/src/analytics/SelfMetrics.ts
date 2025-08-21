import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "../Config";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { SqlDbUtilsQuerySQL } from "../utils-std-ts/SqlDbUtils";
import { StandardMeterCreateObservableGauge } from "../utils-std-ts/StandardMeter";

const signalData = {
  traces: [],
  metrics: [],
  logs: [],
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function SelfMetricsInit(context: Span, configIn: Config) {
  const span = StandardTracerStartSpan("SelfMetricsInit", context);
  StandardMeterCreateObservableGauge(
    "signals.traces",
    (observableResult) => {
      signalData.traces.forEach((service) => {
        const serviceTag = `${service.name}:${service.version}`;
        observableResult.observe(service.traces, {
          service: `${serviceTag ? serviceTag : "unknown service"}`,
        });
      });
    },
    { description: "Count of traces per services" }
  );
  StandardMeterCreateObservableGauge(
    "signals.metrics",
    (observableResult) => {
      signalData.metrics.forEach((service) => {
        const serviceTag = `${service.name}:${service.version}`;
        observableResult.observe(service.metrics, {
          service: `${serviceTag ? serviceTag : "unknown service"}`,
        });
      });
    },
    { description: "Count of metrics per services" }
  );
  StandardMeterCreateObservableGauge(
    "signals.logs",
    (observableResult) => {
      signalData.logs.forEach((service) => {
        const serviceTag = `${service.name}:${service.version}`;
        observableResult.observe(service.logs, {
          service: `${serviceTag ? serviceTag : "unknown service"}`,
        });
      });
    },
    { description: "Count of logs per services" }
  );
  SelfMetricsRefreshMetrics();

  span.end();
}

// Private Functions

async function SelfMetricsRefreshMetrics(): Promise<void> {
  const span = StandardTracerStartSpan("SelfMetricsRefreshMetrics");
  // Traces
  const tracesRowCount = await SqlDbUtilsQuerySQL(
    span,
    "SELECT serviceName, serviceVersion, COUNT(*) as nbtraces FROM traces GROUP BY serviceName, serviceVersion"
  );
  const servicesTraces = [];
  tracesRowCount.forEach((row) => {
    servicesTraces.push({
      name: row.serviceName,
      version: row.serviceVersion,
      traces: row.nbtraces,
    });
  });
  signalData.traces = servicesTraces;
  // Metrics
  const metricsRowCount = await SqlDbUtilsQuerySQL(
    span,
    "SELECT serviceName, serviceVersion, COUNT(*) as nbmetrics FROM metrics GROUP BY serviceName, serviceVersion"
  );
  const servicesMetrics = [];
  metricsRowCount.forEach((row) => {
    servicesMetrics.push({
      name: row.serviceName,
      version: row.serviceVersion,
      metrics: row.nbmetrics,
    });
  });
  signalData.metrics = servicesMetrics;
  // Logs
  const logsRowCount = await SqlDbUtilsQuerySQL(
    span,
    "SELECT serviceName, serviceVersion, COUNT(*) as nblogs FROM logs GROUP BY serviceName, serviceVersion"
  );
  const servicesLogs = [];
  logsRowCount.forEach((row) => {
    servicesLogs.push({
      name: row.serviceName,
      version: row.serviceVersion,
      logs: row.nblogs,
    });
  });
  signalData.logs = servicesLogs;
  //
  span.end();
  setTimeout(() => {
    SelfMetricsRefreshMetrics();
  }, 60_000);
}
