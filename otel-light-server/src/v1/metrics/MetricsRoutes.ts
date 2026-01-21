import { FastifyInstance } from "fastify";
import {
  SignalUtilsCheckAuthHeader,
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";
import { DbUtilsNoTelemetryExecSQL } from "../../utils-std-ts/DbUtilsNoTelemetry";

export class MetricsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.post("/", async (req, res) => {
      if (!SignalUtilsCheckAuthHeader(req)) {
        return res.status(401).send({});
      }
      const timeUnixNano = Date.now() * 1_000_000;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req.body as any).resourceMetrics.forEach((resourceMetric) => {
        const serviceName = SignalUtilsGetServiceName(resourceMetric.resource);
        const serviceVersion = SignalUtilsGetServiceVersion(
          resourceMetric.resource,
        );
        resourceMetric.scopeMetrics.forEach((scopeMetric) => {
          scopeMetric.metrics.forEach(async (metric) => {
            let metricType = "unknown";
            if (metric.gauge) metricType = "gauge";
            else if (metric.sum) metricType = "sum";
            else if (metric.histogram) metricType = "histogram";
            else if (metric.exponentialHistogram)
              metricType = "exponentialHistogram";
            else if (metric.summary) metricType = "summary";
            const keywords = `${serviceName}:${serviceVersion} ${serviceName} ${serviceVersion} ${metric.name}`;
            await DbUtilsNoTelemetryExecSQL(
              SQL_QUERIES.INSERT_METRIC,
              [
                metric.name,
                serviceName,
                serviceVersion,
                metricType,
                timeUnixNano,
                JSON.stringify(resourceMetric.resource.attributes),
                JSON.stringify(metric),
                keywords.toLowerCase(),
              ],
            );
          });
        });
      });

      return res.status(201).send({});
    });
  }
}

// SQL

const SQL_QUERIES = {
  INSERT_METRIC:
    "INSERT INTO metrics (name, serviceName, serviceVersion, type, time, attributes, rawMetric, keywords) " +
    " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
};
