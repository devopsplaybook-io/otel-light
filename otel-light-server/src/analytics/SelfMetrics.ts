import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "../Config";
import { OTelMeter, OTelTracer } from "../OTelContext";
import { DbUtilsQuerySQL } from "../utils-std-ts/DbUtils";

const signalData = {
  traces: [],
  metrics: [],
  logs: [],
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function SelfMetricsInit(context: Span, configIn: Config) {
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
    { description: "Count of traces per services" },
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
    { description: "Count of metrics per services" },
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
    { description: "Count of logs per services" },
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
    { description: "Total count of each signal type across all services" },
  );

  SelfMetricsRefreshMetrics();

  span.end();
}

// Private Functions

async function SelfMetricsRefreshMetrics(): Promise<void> {
  const span = OTelTracer().startSpan("SelfMetricsRefreshMetrics");
  // Traces
  const tracesRowCount = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.COUNT_TRACES,
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
  const metricsRowCount = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.COUNT_METRICS,
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
  const logsRowCount = await DbUtilsQuerySQL(
    span,
    SQL_QUERIES.COUNT_LOGS,
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

// SQL

const SQL_QUERIES = {
  COUNT_TRACES: "SELECT serviceName, serviceVersion, COUNT(*) as nbtraces FROM traces GROUP BY serviceName, serviceVersion",
  COUNT_METRICS: "SELECT serviceName, serviceVersion, COUNT(*) as nbmetrics FROM metrics GROUP BY serviceName, serviceVersion",
  COUNT_LOGS: "SELECT serviceName, serviceVersion, COUNT(*) as nblogs FROM logs GROUP BY serviceName, serviceVersion",
};
