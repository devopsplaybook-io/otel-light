import { FastifyInstance } from "fastify";
import { OTelLogger } from "../../OTelContext";
import { DbUtilsNoTelemetryBatchInsert } from "../../utils-std-ts/DbUtilsNoTelemetry";
import {
  SignalUtilsCheckAuthHeader,
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";

const logger = OTelLogger().createModuleLogger("v1/logs");
export class LogsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.post("/", async (req, res) => {
      try {
        if (!SignalUtilsCheckAuthHeader(req)) {
          return res.status(401).send({});
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const resourceLog of (req.body as any).resourceLogs) {
          let serviceName = SignalUtilsGetServiceName(resourceLog.resource);
          let serviceVersion = SignalUtilsGetServiceVersion(
            resourceLog.resource,
          );
          for (const scopeLog of resourceLog.scopeLogs) {
            const rows = [];
            for (const logRecord of scopeLog.logRecords) {
              const attrs = logRecord.attributes || [];
              serviceName =
                attrs.find((a) => a?.key === "service.name")?.value
                  ?.stringValue || serviceName;
              serviceVersion =
                attrs.find((a) => a?.key === "service.version")?.value
                  ?.stringValue || serviceVersion;
              const traceId =
                attrs.find((a) => a?.key === "trace.id")?.value?.stringValue ||
                null;
              const spanId =
                attrs.find((a) => a?.key === "span.id")?.value?.stringValue ||
                null;
              if (serviceName) serviceName = serviceName.substring(0, 2000);
              if (serviceVersion)
                serviceVersion = serviceVersion.substring(0, 2000);
              const keywords =
                `${serviceName}:${serviceVersion} ${serviceName} ${serviceVersion} ${logRecord.severityText} ${logRecord.body.stringValue}`.substring(
                  0,
                  4000,
                );
              let logText: string;
              if (logRecord.body.stringValue) {
                logText = logRecord.body.stringValue || "";
              } else if (logRecord.body.kvlistValue) {
                logText =
                  "Key Values: \n" +
                  JSON.stringify(logRecord.body.kvlistValue.values, null, 2);
              } else {
                console.log(
                  "Unknown Log Body" + JSON.stringify(logRecord.body),
                );
                logText = "Log Object: \n" + JSON.stringify(logRecord.body);
              }
              rows.push([
                serviceName,
                serviceVersion,
                traceId,
                spanId,
                logRecord.timeUnixNano,
                logRecord.severityText,
                logText,
                JSON.stringify(logRecord.attributes),
                keywords.toLowerCase(),
              ]);
            }
            await DbUtilsNoTelemetryBatchInsert(
              'INTO logs ("serviceName", "serviceVersion", "traceId", "spanId", "time", "severity", "logText", "attributes", "keywords")',
              9,
              rows,
            );
          }
        }
        return res.status(201).send({});
      } catch (err) {
        logger.error("Error ingesting logs", err);
        return res.status(500).send({ error: "Internal Server Error" });
      }
    });
  }
}
