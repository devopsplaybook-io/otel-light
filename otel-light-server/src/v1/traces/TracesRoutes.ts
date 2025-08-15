import { FastifyInstance } from "fastify";
import { find } from "lodash";
import { SqlDbUtilsNoTelemetryExecSQL } from "../../utils-std-ts/SqlDbUtilsNoTelemetry";

export class TracesRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.post("/", async (req, res) => {
      (req.body as any).resourceSpans.forEach((resourceSpan) => {
        let serviceName =
          find(resourceSpan.resource.attributes, { key: "service.name" })?.value
            ?.stringValue || "unknown";
        let serviceVersion =
          find(resourceSpan.resource.attributes, { key: "service.version" })
            ?.value?.stringValue || "unknown";
        resourceSpan.scopeSpans.forEach((scopeSpan) => {
          scopeSpan.spans.forEach(async (span) => {
            serviceName =
              find(span.attributes, { key: "service.name" })?.value
                ?.stringValue || serviceName;
            serviceVersion =
              find(span.attributes, { key: "service.version" })?.value
                ?.stringValue || serviceVersion;
            await SqlDbUtilsNoTelemetryExecSQL(
              "INSERT INTO traces (traceId, spanId, name, serviceName, serviceVersion, startTime, endTime, statusCode, atttributes, rawSpan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                span.traceId,
                span.spanId,
                span.name,
                serviceName,
                serviceVersion,
                span.startTimeUnixNano,
                span.endTimeUnixNano,
                span.status.code,
                JSON.stringify(span.attributes),
                JSON.stringify(span),
              ]
            );
          });
        });
      });

      return res.status(201).send({});
    });
  }
}
