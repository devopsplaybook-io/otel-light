import { FastifyInstance } from "fastify";
import { OTelLogger } from "../../OTelContext";
import { DbUtilsNoTelemetryBatchInsert } from "../../utils-std-ts/DbUtilsNoTelemetry";
import {
  SignalInsertEntry,
  SignalRollupsRecordSignalInsert,
} from "../../SignalRollups";
import {
  SignalUtilsCheckAuthHeader,
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";

const logger = OTelLogger().createModuleLogger("v1/traces");

const BODY_SCHEMA = {
  type: "object",
  required: ["resourceSpans"],
  properties: {
    resourceSpans: {
      type: "array",
      items: {
        type: "object",
        required: ["scopeSpans"],
        properties: {
          scopeSpans: {
            type: "array",
            items: {
              type: "object",
              required: ["spans"],
              properties: {
                spans: {
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

export class TracesRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.post("/", { schema: { body: BODY_SCHEMA } }, async (req, res) => {
      try {
        if (!SignalUtilsCheckAuthHeader(req)) {
          return res.status(401).send({});
        }
        const rollupEntries: SignalInsertEntry[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const resourceSpan of (req.body as any).resourceSpans) {
          const resourceServiceName = SignalUtilsGetServiceName(
            resourceSpan.resource,
          );
          const resourceServiceVersion = SignalUtilsGetServiceVersion(
            resourceSpan.resource,
          );
          for (const scopeSpan of resourceSpan.scopeSpans) {
            const rows = [];
            for (const span of scopeSpan.spans) {
              const attrs = span.attributes || [];
              // Per-span override with resource-level fallback: must not
              // leak into subsequent spans of the same resource group.
              const serviceName =
                attrs.find((a) => a?.key === "service.name")?.value
                  ?.stringValue || resourceServiceName;
              const serviceVersion =
                attrs.find((a) => a?.key === "service.version")?.value
                  ?.stringValue || resourceServiceVersion;

              const keywords =
                `${serviceName}:${serviceVersion} ${serviceName} ${serviceVersion} ${span.name} ${span.status?.code} ${span.traceId} ${span.spanId} ${span.parentSpanId}`.substring(
                  0,
                  4000,
                );
              rollupEntries.push({
                serviceName,
                serviceVersion,
                time: Number(span.startTimeUnixNano),
              });
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
                span.status?.code ?? 0,
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

        try {
          await SignalRollupsRecordSignalInsert("traces", rollupEntries);
        } catch (rollupErr) {
          // Signals are stored: do not fail the request (client would retry
          // and duplicate spans). A recount can rebuild the rollup later.
          logger.error("Failed to update trace rollups", rollupErr);
        }

        return res.status(201).send({});
      } catch (err) {
        logger.error("Error ingesting traces", err);
        return res.status(500).send({ error: "Internal Server Error" });
      }
    });
  }
}
