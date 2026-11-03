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
import {
  SignalNormalizationId,
  SignalNormalizationSeverity,
  SignalNormalizationTimeUnixNano,
  SignalNormalizationTruncate,
  SIGNAL_KEYWORDS_MAX_LENGTH,
  SIGNAL_LOG_TEXT_MAX_LENGTH,
  SIGNAL_NAME_MAX_LENGTH,
} from "../../SignalNormalization";

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
          let rejectedLogRecords = 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const resourceLog of (req.body as any).resourceLogs ?? []) {
            const resourceServiceName = SignalNormalizationTruncate(
              SignalUtilsGetServiceName(resourceLog.resource),
              SIGNAL_NAME_MAX_LENGTH,
            );
            const resourceServiceVersion = SignalNormalizationTruncate(
              SignalUtilsGetServiceVersion(resourceLog.resource),
              SIGNAL_NAME_MAX_LENGTH,
            );
            for (const scopeLog of resourceLog.scopeLogs ?? []) {
              const rows = [];
              for (const logRecord of scopeLog.logRecords ?? []) {
                const attrs = logRecord.attributes || [];
                // Per-record override with resource-level fallback: must not
                // leak into subsequent records of the same resource group.
                const serviceName =
                  SignalNormalizationTruncate(
                    attrs.find((a) => a?.key === "service.name")?.value
                      ?.stringValue,
                    SIGNAL_NAME_MAX_LENGTH,
                  ) || resourceServiceName;
                const serviceVersion =
                  SignalNormalizationTruncate(
                    attrs.find((a) => a?.key === "service.version")?.value
                      ?.stringValue,
                    SIGNAL_NAME_MAX_LENGTH,
                  ) || resourceServiceVersion;
                // Standard OTLP LogRecord fields win; the trace.id/span.id
                // attributes are kept as a fallback for older exporters.
                const traceId =
                  SignalNormalizationId(logRecord.traceId) ??
                  SignalNormalizationId(
                    attrs.find((a) => a?.key === "trace.id")?.value?.stringValue,
                  );
                const spanId =
                  SignalNormalizationId(logRecord.spanId) ??
                  SignalNormalizationId(
                    attrs.find((a) => a?.key === "span.id")?.value?.stringValue,
                  );
                const severity = SignalNormalizationSeverity(
                  logRecord.severityText,
                  logRecord.severityNumber,
                );
                // A missing time falls back to the ingestion time; an
                // explicitly provided but invalid time rejects that record
                // only, so the rest of the batch is still stored.
                const parsedTime = SignalNormalizationTimeUnixNano(
                  logRecord.timeUnixNano,
                );
                if (parsedTime.kind === "invalid") {
                  rejectedLogRecords++;
                  continue;
                }
                const logTime =
                  parsedTime.kind === "valid"
                    ? parsedTime.value
                    : Date.now() * 1_000_000;
                const keywords = SignalNormalizationTruncate(
                  `${serviceName}:${serviceVersion} ${serviceName} ${serviceVersion} ${severity} ${logRecord.body?.stringValue}`,
                  SIGNAL_KEYWORDS_MAX_LENGTH,
                ).toLowerCase();
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
                logText = SignalNormalizationTruncate(
                  logText,
                  SIGNAL_LOG_TEXT_MAX_LENGTH,
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
                  severity,
                  logText,
                  JSON.stringify(attrs),
                  keywords,
                  randomUUID(),
                ]);
              }
              if (rows.length > 0) {
                await DbUtilsNoTelemetryBatchInsert(
                  'INTO logs ("serviceName", "serviceVersion", "traceId", "spanId", "time", "severity", "logText", "attributes", "keywords", "recordId")',
                  10,
                  rows,
                );
              }
            }
          }

          try {
            await SignalRollupsRecordSignalInsert("logs", rollupEntries);
          } catch (rollupErr) {
            // Signals are stored: do not fail the request (client would retry
            // and duplicate records). A recount can rebuild the rollup later.
            logger.error("Failed to update log rollups", rollupErr);
          }

          if (rejectedLogRecords > 0) {
            return res.status(200).send({
              partialSuccess: {
                rejectedLogRecords: String(rejectedLogRecords),
                errorMessage:
                  "Log records with an invalid timeUnixNano were rejected.",
              },
            });
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
