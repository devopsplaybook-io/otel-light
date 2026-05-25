import { FastifyInstance } from "fastify";
import { OTelLogger } from "../../OTelContext";
import {
  SignalUtilsCheckAuthHeader,
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";
import { DbUtilsNoTelemetryBatchInsert } from "../../utils-std-ts/DbUtilsNoTelemetry";

const logger = OTelLogger().createModuleLogger("v1/metrics");

export class MetricsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.post("/", async (req, res) => {
      try {
        if (!SignalUtilsCheckAuthHeader(req)) {
          return res.status(401).send({});
        }
        const timeUnixNano = Date.now() * 1_000_000;
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
              rows.push([
                metric.name ? metric.name.substring(0, 2000) : metric.name,
                serviceName ? serviceName.substring(0, 2000) : serviceName,
                serviceVersion
                  ? serviceVersion.substring(0, 2000)
                  : serviceVersion,
                metricType,
                timeUnixNano,
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

        return res.status(201).send({});
      } catch (err) {
        logger.error("Error ingesting metrics", err);
        return res.status(500).send({ error: "Internal Server Error" });
      }
    });
  }
}
