import { FastifyInstance } from "fastify";
import { OTelLogger } from "../../OTelContext";
import {
  SignalInsertEntry,
  SignalRollupsRecordSignalInsert,
} from "../../SignalRollups";
import {
  SignalIngestionInsertTracesIgnoreDuplicates,
  SignalIngestionRegisterJsonProtocol,
  SignalIngestionSpanKey,
} from "../SignalIngestion";
import {
  SignalUtilsCheckAuthHeader,
  SignalUtilsGetIngestionBodyLimit,
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";

const logger = OTelLogger().createModuleLogger("v1/traces");

const TABLE_COLS =
  'INTO traces ("traceId", "spanId", "parentSpanId", "name", "serviceName", "serviceVersion", "startTime", "endTime", "statusCode", "attributes", "rawSpan", "keywords")';

// OTLP fields are optional: a minimal but valid payload may omit the nested
// arrays, so only the types are validated (missing arrays default to []).
const BODY_SCHEMA = {
  type: "object",
  properties: {
    resourceSpans: {
      type: "array",
      items: {
        type: "object",
        properties: {
          scopeSpans: {
            type: "array",
            items: {
              type: "object",
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

interface SpanInsertEntry {
  key: string;
  entry: SignalInsertEntry;
}

export class TracesRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    SignalIngestionRegisterJsonProtocol(fastify);
    fastify.post(
      "/",
      {
        schema: { body: BODY_SCHEMA },
        bodyLimit: SignalUtilsGetIngestionBodyLimit(),
      },
      async (req, res) => {
        try {
          if (!SignalUtilsCheckAuthHeader(req)) {
            return res.status(401).send({});
          }
          const rollupEntries: SignalInsertEntry[] = [];
          let rejectedSpans = 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const resourceSpan of (req.body as any).resourceSpans ?? []) {
            const resourceServiceName = SignalUtilsGetServiceName(
              resourceSpan.resource,
            );
            const resourceServiceVersion = SignalUtilsGetServiceVersion(
              resourceSpan.resource,
            );
            for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
              const rows = [];
              const spanEntries: SpanInsertEntry[] = [];
              for (const span of scopeSpan.spans ?? []) {
                if (
                  !span.traceId ||
                  !span.spanId ||
                  !(Number(span.startTimeUnixNano) > 0) ||
                  !(Number(span.endTimeUnixNano) > 0)
                ) {
                  rejectedSpans++;
                  continue;
                }
                const attrs = span.attributes || [];
                // Per-span override with resource-level fallback: must not
                // leak into subsequent spans of the same resource group.
                const serviceName =
                  attrs.find((a) => a?.key === "service.name")?.value
                    ?.stringValue || resourceServiceName;
                const serviceVersion =
                  attrs.find((a) => a?.key === "service.version")?.value
                    ?.stringValue || resourceServiceVersion;
                const name = span.name ? span.name.substring(0, 2000) : "";

                const keywords =
                  `${serviceName}:${serviceVersion} ${serviceName} ${serviceVersion} ${name} ${span.status?.code} ${span.traceId} ${span.spanId} ${span.parentSpanId}`.substring(
                    0,
                    4000,
                  );
                spanEntries.push({
                  key: SignalIngestionSpanKey(span.traceId, span.spanId),
                  entry: {
                    serviceName,
                    serviceVersion,
                    time: Number(span.startTimeUnixNano),
                  },
                });
                rows.push([
                  span.traceId,
                  span.spanId,
                  span.parentSpanId ?? null,
                  name,
                  serviceName ? serviceName.substring(0, 2000) : serviceName,
                  serviceVersion
                    ? serviceVersion.substring(0, 2000)
                    : serviceVersion,
                  span.startTimeUnixNano,
                  span.endTimeUnixNano,
                  span.status?.code ?? 0,
                  JSON.stringify(attrs),
                  JSON.stringify(span),
                  keywords.toLowerCase(),
                ]);
              }
              if (rows.length > 0) {
                const insertedKeys =
                  await SignalIngestionInsertTracesIgnoreDuplicates(
                    TABLE_COLS,
                    12,
                    rows,
                  );
                // Count a rollup entry only once per span actually inserted:
                // replayed batches must not inflate counts or percentiles.
                const countedKeys = new Set<string>();
                for (const { key, entry } of spanEntries) {
                  if (insertedKeys.has(key) && !countedKeys.has(key)) {
                    countedKeys.add(key);
                    rollupEntries.push(entry);
                  }
                }
              }
            }
          }

          try {
            await SignalRollupsRecordSignalInsert("traces", rollupEntries);
          } catch (rollupErr) {
            // Signals are stored: do not fail the request (client would retry
            // and duplicate spans). A recount can rebuild the rollup later.
            logger.error("Failed to update trace rollups", rollupErr);
          }

          if (rejectedSpans > 0) {
            return res.status(200).send({
              partialSuccess: {
                rejectedSpans: String(rejectedSpans),
                errorMessage:
                  "Spans missing traceId/spanId or valid start/end times were rejected.",
              },
            });
          }
          return res.status(200).send({});
        } catch (err) {
          logger.error("Error ingesting traces", err);
          return res.status(500).send({ error: "Internal Server Error" });
        }
      },
    );
  }
}
