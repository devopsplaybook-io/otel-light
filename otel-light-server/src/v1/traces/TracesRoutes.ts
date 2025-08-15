import { FastifyInstance } from "fastify";
import { find } from "lodash";
import { SqlDbUtilsNoTelemetryExecSQL } from "../../utils-std-ts/SqlDbUtilsNoTelemetry";

export class TracesRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.post("/", async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

            const keywords =
              serviceName +
              " " +
              serviceVersion +
              " " +
              span.name +
              " " +
              span.status.code +
              span.traceId +
              "" +
              span.spanId +
              "" +
              span.parentSpanId;
            await SqlDbUtilsNoTelemetryExecSQL(
              "INSERT INTO traces (traceId, spanId, parentSpanId, name, serviceName, serviceVersion, startTime, endTime, statusCode, atttributes, rawSpan, keywords) " +
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
              ]
            );
          });
        });
      });

      return res.status(201).send({});
    });
  }
}
