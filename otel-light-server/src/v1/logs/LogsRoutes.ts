import { FastifyInstance } from "fastify";
import { find } from "lodash";
import { DbUtilsNoTelemetryExecSQL } from "../../utils-std-ts/DbUtilsNoTelemetry";
import {
  SignalUtilsCheckAuthHeader,
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";
import { DbUtilsGetType } from "../../utils-std-ts/DbUtils";
export class LogsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.post("/", async (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req.body as any).resourceLogs.forEach((resourceLog) => {
        if (!SignalUtilsCheckAuthHeader(req)) {
          return res.status(401).send({});
        }
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
            const traceId = find(logRecord.attributes, { key: "trace.id" })
              ?.value?.stringValue;
            const spanId = find(logRecord.attributes, { key: "span.id" })?.value
              ?.stringValue;
            const keywords = `${serviceName}:${serviceVersion} ${serviceName} ${serviceVersion} ${logRecord.severityText} ${logRecord.body.stringValue}`;
            let logText = "";
            if (logRecord.body.stringValue) {
              logText = logRecord.body.stringValue || "";
            } else if (logRecord.body.kvlistValue) {
              logText =
                "Key Values: \n" +
                JSON.stringify(logRecord.body.kvlistValue.values, null, 2);
            } else {
              console.log("Unknown Log Body" + JSON.stringify(logRecord.body));
              logText = "Log Object: \n" + JSON.stringify(logRecord.body);
            }
            await DbUtilsNoTelemetryExecSQL(
              SQL_QUERIES.INSERT_LOG[DbUtilsGetType()],
              [
                serviceName,
                serviceVersion,
                traceId,
                spanId,
                logRecord.timeUnixNano,
                logRecord.severityText,
                logText,
                JSON.stringify(logRecord.attributes),
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
  INSERT_LOG: {
    postgres:
      'INSERT INTO logs ("serviceName", "serviceVersion", "traceId", "spanId", "time", "severity", "logText", "attributes", "keywords") ' +
      " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    sqlite:
      "INSERT INTO logs (serviceName, serviceVersion, traceId, spanId, time, severity, logText, attributes, keywords) " +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  },
};
