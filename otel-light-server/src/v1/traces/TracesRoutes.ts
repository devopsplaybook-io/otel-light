import { FastifyInstance } from "fastify";
import { OTelLogger } from "../../OTelContext";
import { DbUtilsNoTelemetryBatchInsert } from "../../utils-std-ts/DbUtilsNoTelemetry";
import {
  SignalUtilsCheckAuthHeader,
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";

const logger = OTelLogger().createModuleLogger("v1/traces");

export class TracesRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.post("/", async (req, res) => {
      try {
        if (!SignalUtilsCheckAuthHeader(req)) {
          return res.status(401).send({});
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const resourceSpan of (req.body as any).resourceSpans) {
          let serviceName = SignalUtilsGetServiceName(resourceSpan.resource);
          let serviceVersion = SignalUtilsGetServiceVersion(
            resourceSpan.resource,
          );
          for (const scopeSpan of resourceSpan.scopeSpans) {
            const rows = [];
            for (const span of scopeSpan.spans) {
              const attrs = span.attributes || [];
              serviceName =
                attrs.find((a) => a?.key === "service.name")?.value
                  ?.stringValue || serviceName;
              serviceVersion =
                attrs.find((a) => a?.key === "service.version")?.value
                  ?.stringValue || serviceVersion;

              const keywords =
                `${serviceName}:${serviceVersion} ${serviceName} ${serviceVersion} ${span.name} ${span.status.code} ${span.traceId} ${span.spanId} ${span.parentSpanId}`.substring(
                  0,
                  4000,
                );
              rows.push([
                span.traceId,
                span.spanId,
                span.parentSpanId,
                span.name ? span.name.substring(0, 2000) : span.name,
                serviceName ? serviceName.substring(0, 2000) : serviceName,
                serviceVersion
                  ? serviceVersion.substring(0, 2000)
                  : serviceVersion,
                span.startTimeUnixNano,
                span.endTimeUnixNano,
                span.status.code,
                JSON.stringify(span.attributes),
                JSON.stringify(span),
                keywords.toLowerCase(),
              ]);
            }
            await DbUtilsNoTelemetryBatchInsert(
              'INTO traces ("traceId", "spanId", "parentSpanId", "name", "serviceName", "serviceVersion", "startTime", "endTime", "statusCode", "attributes", "rawSpan", "keywords")',
              12,
              rows,
            );
          }
        }

        return res.status(201).send({});
      } catch (err) {
        logger.error("Error ingesting traces", err);
        return res.status(500).send({ error: "Internal Server Error" });
      }
    });
  }
}
