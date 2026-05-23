import { FastifyInstance } from "fastify";
import { AuthGetUserSession, AuthHasScope } from "../users/Auth";
import { Log } from "../model/Log";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import {
  AnalyticsUtilsGetDefaultFromTime,
  AnalyticsUtilsCompressJson,
  AnalyticsUtilsGetSQLVariable,
} from "./AnalyticsUtils";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";

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
        before?: number;
      };
    }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      try {
        await AuthHasScope(req, res, "logs");
      } catch {
        return;
      }
      const dbType = DbUtilsGetType();
      const sqlParams = [];
      const isRefresh = req.query.afterTime !== undefined;
      const hasBefore = req.query.before !== undefined;
      // Keyset pagination: when `before` is provided, use cursor instead of OFFSET.
      // This avoids the O(n) scan cost of large OFFSET values on big tables.
      const offset = isRefresh || hasBefore ? 0 : req.query.offset || 0;

      const fromTime = req.query.from || AnalyticsUtilsGetDefaultFromTime();
      let sqlWhere =
        " WHERE time >= " +
        AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1);
      sqlParams.push(fromTime);

      if (req.query.to) {
        sqlWhere +=
          " AND time <= " +
          AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1);
        sqlParams.push(req.query.to);
      }
      if (isRefresh) {
        sqlWhere +=
          " AND time > " +
          AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1);
        sqlParams.push(req.query.afterTime);
      }
      if (hasBefore) {
        sqlWhere +=
          " AND time < " +
          AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1);
        sqlParams.push(req.query.before);
      }
      if (req.query.keywords?.trim()) {
        sqlWhere +=
          " AND keywords LIKE " +
          AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1);
        sqlParams.push(`%${req.query.keywords.toLowerCase().trim()}%`);
      }
      if (req.query.severity?.trim()) {
        sqlWhere +=
          " AND severity = " +
          AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1);
        sqlParams.push(req.query.severity.toLowerCase().trim());
      }
      if (req.query.serviceName && String(req.query.serviceName).trim()) {
        sqlWhere +=
          ' AND "serviceName" = ' +
          AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1);
        sqlParams.push(String(req.query.serviceName).trim());
      }
      if (req.query.serviceVersion && String(req.query.serviceVersion).trim()) {
        sqlWhere +=
          ' AND "serviceVersion" = ' +
          AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1);
        sqlParams.push(String(req.query.serviceVersion).trim());
      }

      const rawLogs = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.GET_LOGS(sqlWhere, PAGE_SIZE, offset)[dbType],
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
  GET_LOGS: (sqlWhere: string, limit: number, offset: number) => ({
    postgres: `SELECT "time", "severity", "serviceName", "serviceVersion", "traceId", "spanId", "logText", "attributes" FROM logs ${sqlWhere} ORDER BY "time" DESC LIMIT ${limit} OFFSET ${offset}`,
    sqlite: `SELECT time, severity, serviceName, serviceVersion, traceId, spanId, logText, attributes FROM logs ${sqlWhere} ORDER BY time DESC LIMIT ${limit} OFFSET ${offset}`,
  }),
};
