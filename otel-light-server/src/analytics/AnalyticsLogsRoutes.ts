import { FastifyInstance } from "fastify";
import { AuthHasScope } from "@devopsplaybook.io/common-utils";
import { Log } from "../model/Log";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import {
  AnalyticsUtilsEscapeLike,
  AnalyticsUtilsGetDefaultFromTime,
  AnalyticsUtilsCompressJson,
  AnalyticsUtilsGetSQLVariable,
  AnalyticsUtilsGetTimeParam,
  AnalyticsUtilsParseOffset,
} from "./AnalyticsUtils";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";
import { SignalNormalizationSeverity } from "../SignalNormalization";

const PAGE_SIZE = 200;

export class AnalyticsLogsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{
      Querystring: {
        from?: number;
        to?: number;
        keywords?: string;
        severity?: string;
        serviceName?: string;
        serviceVersion?: string;
        offset?: number;
        afterTime?: number;
        afterRecordId?: string;
        before?: number;
        beforeRecordId?: string;
      };
    }>("/", async (req, res) => {
      try {
        await AuthHasScope(req, res, "logs");
      } catch {
        return;
      }
      const parsedOffset = AnalyticsUtilsParseOffset(req.query.offset);
      if (parsedOffset === null) {
        return res.status(400).send({ error: "Invalid offset" });
      }
      const dbType = DbUtilsGetType();
      const sqlParams = [];
      const varAt = (index: number) =>
        AnalyticsUtilsGetSQLVariable(dbType, index);
      const isRefresh = req.query.afterTime !== undefined;
      const hasBefore = req.query.before !== undefined;
      // Keyset pagination: when `before` is provided, use cursor instead of OFFSET.
      // This avoids the O(n) scan cost of large OFFSET values on big tables.
      const offset = isRefresh || hasBefore ? 0 : parsedOffset;

      const fromTime = req.query.from || AnalyticsUtilsGetDefaultFromTime();
      let sqlWhere =
        " WHERE time >= " + varAt(sqlParams.length + 1);
      sqlParams.push(AnalyticsUtilsGetTimeParam(fromTime));

      if (req.query.to) {
        sqlWhere +=
          " AND time <= " + varAt(sqlParams.length + 1);
        sqlParams.push(AnalyticsUtilsGetTimeParam(req.query.to));
      }
      // Composite cursors (time, recordId): equal timestamps are common with
      // batched ingestion, so a timestamp-only cursor would skip records.
      if (isRefresh) {
        if (req.query.afterRecordId) {
          const idx = sqlParams.length + 1;
          sqlWhere +=
            ` AND (time > ${varAt(idx)}` +
            ` OR (time = ${varAt(idx + 1)} AND recordId > ${varAt(idx + 2)}))`;
          sqlParams.push(
            AnalyticsUtilsGetTimeParam(req.query.afterTime),
            AnalyticsUtilsGetTimeParam(req.query.afterTime),
            req.query.afterRecordId,
          );
        } else {
          sqlWhere +=
            " AND time > " + varAt(sqlParams.length + 1);
          sqlParams.push(AnalyticsUtilsGetTimeParam(req.query.afterTime));
        }
      }
      if (hasBefore) {
        if (req.query.beforeRecordId) {
          const idx = sqlParams.length + 1;
          sqlWhere +=
            ` AND (time < ${varAt(idx)}` +
            ` OR (time = ${varAt(idx + 1)} AND recordId < ${varAt(idx + 2)}))`;
          sqlParams.push(
            AnalyticsUtilsGetTimeParam(req.query.before),
            AnalyticsUtilsGetTimeParam(req.query.before),
            req.query.beforeRecordId,
          );
        } else {
          sqlWhere +=
            " AND time < " + varAt(sqlParams.length + 1);
          sqlParams.push(AnalyticsUtilsGetTimeParam(req.query.before));
        }
      }
      if (req.query.keywords?.trim()) {
        sqlWhere +=
          " AND keywords LIKE " + varAt(sqlParams.length + 1) + " ESCAPE '\\'";
        sqlParams.push(
          `%${AnalyticsUtilsEscapeLike(req.query.keywords.toLowerCase().trim())}%`,
        );
      }
      const severity = SignalNormalizationSeverity(req.query.severity);
      if (severity) {
        sqlWhere +=
          " AND severity = " + varAt(sqlParams.length + 1);
        sqlParams.push(severity);
      }
      if (req.query.serviceName && String(req.query.serviceName).trim()) {
        sqlWhere +=
          ' AND "serviceName" = ' + varAt(sqlParams.length + 1);
        sqlParams.push(String(req.query.serviceName).trim());
      }
      if (req.query.serviceVersion && String(req.query.serviceVersion).trim()) {
        sqlWhere +=
          ' AND "serviceVersion" = ' + varAt(sqlParams.length + 1);
        sqlParams.push(String(req.query.serviceVersion).trim());
      }

      const limitVar = varAt(sqlParams.length + 1);
      const offsetVar = varAt(sqlParams.length + 2);
      sqlParams.push(PAGE_SIZE, offset);
      const rawLogs = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.GET_LOGS(sqlWhere, limitVar, offsetVar)[dbType],
        sqlParams,
      );
      const logs = [];
      rawLogs.forEach((rawLog) => {
        logs.push(new Log(rawLog));
      });

      const response = {
        logs: await AnalyticsUtilsCompressJson(logs, "gzip"),
        compressed: true,
        hasMore: rawLogs.length === PAGE_SIZE,
      };
      return res.status(200).send(response);
    });
  }
}

// SQL

const SQL_QUERIES = {
  GET_LOGS: (sqlWhere: string, limitVar: string, offsetVar: string) => ({
    postgres: `SELECT "time", "severity", "serviceName", "serviceVersion", "traceId", "spanId", "logText", "attributes", "recordId" FROM logs ${sqlWhere} ORDER BY "time" DESC, "recordId" DESC LIMIT ${limitVar} OFFSET ${offsetVar}`,
    sqlite: `SELECT time, severity, serviceName, serviceVersion, traceId, spanId, logText, attributes, recordId FROM logs ${sqlWhere} ORDER BY time DESC, recordId DESC LIMIT ${limitVar} OFFSET ${offsetVar}`,
  }),
};
