import { FastifyInstance } from "fastify";
import { find } from "lodash";
import { DbUtilsNoTelemetryExecSQL } from "../../utils-std-ts/DbUtilsNoTelemetry";
import {
  SignalUtilsCheckAuthHeader,
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";

export class TracesRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.post("/", async (req, res) => {
      if (!SignalUtilsCheckAuthHeader(req)) {
        return res.status(401).send({});
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req.body as any).resourceSpans.forEach((resourceSpan) => {
        let serviceName = SignalUtilsGetServiceName(resourceSpan.resource);
        let serviceVersion = SignalUtilsGetServiceVersion(
          resourceSpan.resource,
        );
        resourceSpan.scopeSpans.forEach((scopeSpan) => {
          scopeSpan.spans.forEach(async (span) => {
            serviceName =
              find(span.attributes, { key: "service.name" })?.value
                ?.stringValue || serviceName;
            serviceVersion =
              find(span.attributes, { key: "service.version" })?.value
                ?.stringValue || serviceVersion;

            const keywords = `${serviceName}:${serviceVersion} ${serviceName} ${serviceVersion} ${span.name} ${span.status.code} ${span.traceId} ${span.spanId} ${span.parentSpanId}`;
            await DbUtilsNoTelemetryExecSQL(
              SQL_QUERIES.INSERT_TRACE,
              [
                span.traceId,
                span.spanId,
                span.parentSpanId,
                span.name,
                serviceName,
                serviceVersion,
                span.startTimeUnixNano,
                span.endTimeUnixNano,
                span.status.code,
                JSON.stringify(span.attributes),
                JSON.stringify(span),
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
  INSERT_TRACE:
    "INSERT INTO traces (traceId, spanId, parentSpanId, name, serviceName, serviceVersion, startTime, endTime, statusCode, attributes, rawSpan, keywords) " +
    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
};
