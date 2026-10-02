import { FastifyInstance } from "fastify";
import { OTelLogger } from "../../OTelContext";
import {
  SignalUtilsCheckAuthHeader,
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";
import { DbUtilsNoTelemetryBatchInsert } from "../../utils-std-ts/DbUtilsNoTelemetry";
import {
  MetricNameInsertEntry,
  SignalInsertEntry,
  SignalRollupsRecordMetricNamesInsert,
  SignalRollupsRecordSignalInsert,
} from "../../SignalRollups";

const logger = OTelLogger().createModuleLogger("v1/metrics");

const BODY_SCHEMA = {
  type: "object",
  required: ["resourceMetrics"],
  properties: {
    resourceMetrics: {
      type: "array",
      items: {
        type: "object",
        required: ["scopeMetrics"],
        properties: {
          scopeMetrics: {
            type: "array",
            items: {
              type: "object",
              required: ["metrics"],
              properties: {
                metrics: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { attributes: { type: "array" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

// Prefer the OTLP data point measurement time over the ingestion time so
// delayed/batched exporters and backfills land in the right time window.
// The raw value is kept as-is (JSON uint64 strings preserve full precision).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMetricTimeUnixNano(metric: any, fallback: number): number | string {
  const dataPoints =
    metric.gauge?.dataPoints ??
    metric.sum?.dataPoints ??
    metric.histogram?.dataPoints ??
    metric.exponentialHistogram?.dataPoints ??
    metric.summary?.dataPoints ??
    [];
  for (const dataPoint of dataPoints) {
    const timeUnixNano = dataPoint?.timeUnixNano;
    if (
      timeUnixNano !== undefined &&
      timeUnixNano !== null &&
      timeUnixNano !== "" &&
      Number(timeUnixNano) > 0
    ) {
      return timeUnixNano;
    }
  }
  return fallback;
}

export class MetricsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.post("/", { schema: { body: BODY_SCHEMA } }, async (req, res) => {
      try {
        if (!SignalUtilsCheckAuthHeader(req)) {
          return res.status(401).send({});
        }
        const ingestionTime = Date.now() * 1_000_000;
        const rollupEntries: SignalInsertEntry[] = [];
        const rollupNameEntries: MetricNameInsertEntry[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const resourceMetric of (req.body as any).resourceMetrics) {
          const serviceName = SignalUtilsGetServiceName(
            resourceMetric.resource,
          );
          const serviceVersion = SignalUtilsGetServiceVersion(
            resourceMetric.resource,
          );
          for (const scopeMetric of resourceMetric.scopeMetrics) {
            const rows = [];
            for (const metric of scopeMetric.metrics) {
              let metricType = "unknown";
              if (metric.gauge) metricType = "gauge";
              else if (metric.sum) metricType = "sum";
              else if (metric.histogram) metricType = "histogram";
              else if (metric.exponentialHistogram)
                metricType = "exponentialHistogram";
              else if (metric.summary) metricType = "summary";
              const keywords =
                `${serviceName}:${serviceVersion} ${serviceName} ${serviceVersion} ${metric.name}`.substring(
                  0,
                  4000,
                );
              const rawMetricTime = getMetricTimeUnixNano(metric, ingestionTime);
              rollupEntries.push({
                serviceName,
                serviceVersion,
                time: Number(rawMetricTime),
              });
              rollupNameEntries.push({
                serviceName,
                name: metric.name || "",
                type: metricType,
                time: Number(rawMetricTime),
              });
              rows.push([
                metric.name ? metric.name.substring(0, 2000) : metric.name,
                serviceName ? serviceName.substring(0, 2000) : serviceName,
                serviceVersion
                  ? serviceVersion.substring(0, 2000)
                  : serviceVersion,
                metricType,
                rawMetricTime,
                JSON.stringify(resourceMetric.resource.attributes),
                JSON.stringify(metric),
                keywords.toLowerCase(),
              ]);
            }
            await DbUtilsNoTelemetryBatchInsert(
              'INTO metrics ("name", "serviceName", "serviceVersion", "type", "time", "attributes", "rawMetric", "keywords")',
              8,
              rows,
            );
          }
        }

        try {
          await SignalRollupsRecordSignalInsert("metrics", rollupEntries);
          await SignalRollupsRecordMetricNamesInsert(rollupNameEntries);
        } catch (rollupErr) {
          // Signals are stored: do not fail the request (client would retry
          // and duplicate metrics). A recount can rebuild the rollups later.
          logger.error("Failed to update metric rollups", rollupErr);
        }

        return res.status(201).send({});
      } catch (err) {
        logger.error("Error ingesting metrics", err);
        return res.status(500).send({ error: "Internal Server Error" });
      }
    });
  }
}
