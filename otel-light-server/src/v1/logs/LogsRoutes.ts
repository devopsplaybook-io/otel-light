import { FastifyInstance } from "fastify";
import { find } from "lodash";
import { SqlDbUtilsNoTelemetryExecSQL } from "../../utils-std-ts/SqlDbUtilsNoTelemetry";
import {
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";

export class LogsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.post("/", async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req.body as any).resourceLogs.forEach((resourceLog) => {
        let serviceName = SignalUtilsGetServiceName(resourceLog.resource);
        let serviceVersion = SignalUtilsGetServiceVersion(resourceLog.resource);
        resourceLog.scopeLogs.forEach((scopeLog) => {
          scopeLog.logRecords.forEach(async (logRecord) => {
            serviceName =
              find(logRecord.attributes, { key: "service.name" })?.value
                ?.stringValue || serviceName;
            serviceVersion =
              find(logRecord.attributes, { key: "service.version" })?.value
                ?.stringValue || serviceVersion;
            const keywords = `${serviceName} ${serviceVersion} ${logRecord.severityText} ${logRecord.body.stringValue}`;
            if (!logRecord.body.stringValue) {
              console.log(logRecord.body);
            }
            await SqlDbUtilsNoTelemetryExecSQL(
              "INSERT INTO logs (serviceName, serviceVersion, time, severity, logText, atttributes, keywords) " +
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
              [
                serviceName,
                serviceVersion,
                logRecord.timeUnixNano,
                logRecord.severityText,
                logRecord.body.stringValue || "",
                JSON.stringify(logRecord.attributes),
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
