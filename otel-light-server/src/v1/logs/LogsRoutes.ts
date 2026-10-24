import { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { OTelLogger } from "../../OTelContext";
import { DbUtilsNoTelemetryBatchInsert } from "../../utils-std-ts/DbUtilsNoTelemetry";
import {
  SignalInsertEntry,
  SignalRollupsRecordSignalInsert,
} from "../../SignalRollups";
import { SignalIngestionRegisterJsonProtocol } from "../SignalIngestion";
import {
  SignalUtilsCheckAuthHeader,
  SignalUtilsGetIngestionBodyLimit,
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";

const logger = OTelLogger().createModuleLogger("v1/logs");

// OTLP fields are optional: a minimal but valid payload may omit the nested
// arrays, so only the types are validated (missing arrays default to []).
const BODY_SCHEMA = {
  type: "object",
  properties: {
    resourceLogs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          scopeLogs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                logRecords: {
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

export class LogsRoutes {
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const resourceLog of (req.body as any).resourceLogs ?? []) {
            const resourceServiceName = SignalUtilsGetServiceName(
              resourceLog.resource,
            );
            const resourceServiceVersion = SignalUtilsGetServiceVersion(
              resourceLog.resource,
            );
            for (const scopeLog of resourceLog.scopeLogs ?? []) {
              const rows = [];
              for (const logRecord of scopeLog.logRecords ?? []) {
                const attrs = logRecord.attributes || [];
                // Per-record override with resource-level fallback: must not
                // leak into subsequent records of the same resource group.
                let serviceName =
                  attrs.find((a) => a?.key === "service.name")?.value
                    ?.stringValue || resourceServiceName;
                let serviceVersion =
                  attrs.find((a) => a?.key === "service.version")?.value
                    ?.stringValue || resourceServiceVersion;
                // Standard OTLP LogRecord fields win; the trace.id/span.id
                // attributes are kept as a fallback for older exporters.
                const traceId =
                  logRecord.traceId ||
                  attrs.find((a) => a?.key === "trace.id")?.value
                    ?.stringValue ||
                  null;
                const spanId =
                  logRecord.spanId ||
                  attrs.find((a) => a?.key === "span.id")?.value?.stringValue ||
                  null;
                if (serviceName) serviceName = serviceName.substring(0, 2000);
                if (serviceVersion)
                  serviceVersion = serviceVersion.substring(0, 2000);
                const keywords =
                  `${serviceName}:${serviceVersion} ${serviceName} ${serviceVersion} ${logRecord.severityText} ${logRecord.body?.stringValue}`.substring(
                    0,
                    4000,
                  );
                let logText: string;
                if (logRecord.body?.stringValue) {
                  logText = logRecord.body.stringValue || "";
                } else if (logRecord.body?.kvlistValue) {
                  logText =
                    "Key Values: \n" +
                    JSON.stringify(logRecord.body.kvlistValue.values, null, 2);
                } else {
                  logger.info(
                    "Unknown Log Body: " + JSON.stringify(logRecord.body),
                  );
                  logText =
                    "Log Object: \n" + JSON.stringify(logRecord.body ?? null);
                }
                const logTime = Number(
                  logRecord.timeUnixNano ?? Date.now() * 1_000_000,
                );
                rollupEntries.push({
                  serviceName,
                  serviceVersion,
                  time: logTime,
                });
                rows.push([
                  serviceName,
                  serviceVersion,
                  traceId,
                  spanId,
                  logTime,
                  logRecord.severityText ?? "",
                  logText,
                  JSON.stringify(attrs),
                  keywords.toLowerCase(),
                  randomUUID(),
                ]);
              }
              await DbUtilsNoTelemetryBatchInsert(
                'INTO logs ("serviceName", "serviceVersion", "traceId", "spanId", "time", "severity", "logText", "attributes", "keywords", "recordId")',
                10,
                rows,
              );
            }
          }

          try {
            await SignalRollupsRecordSignalInsert("logs", rollupEntries);
          } catch (rollupErr) {
            // Signals are stored: do not fail the request (client would retry
            // and duplicate records). A recount can rebuild the rollup later.
            logger.error("Failed to update log rollups", rollupErr);
          }

          return res.status(200).send({});
        } catch (err) {
          logger.error("Error ingesting logs", err);
          return res.status(500).send({ error: "Internal Server Error" });
        }
      },
    );
  }
}
