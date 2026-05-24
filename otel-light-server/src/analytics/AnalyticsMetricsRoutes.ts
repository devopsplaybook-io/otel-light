import { AnalyticsCacheFilterMetricsNames } from "./AnalyticsCache";
import { FastifyInstance } from "fastify";
import { Metric } from "../model/Metric";
import { AuthGetUserSession, AuthHasScope } from "../users/Auth";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import {
  AnalyticsUtilsCompressJson,
  AnalyticsUtilsGetDefaultFromTime,
  AnalyticsUtilsGetSQLVariable,
  AnalyticsUtilsResultLimitMetrics,
} from "./AnalyticsUtils";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";

export class AnalyticsMetricsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{
      Querystring: {
        from?: number;
        to?: number;
        serviceName?: string;
        name?: string;
        afterTime?: number;
        beforeTime?: number;
        limit?: number;
      };
    }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      try {
        await AuthHasScope(req, res, "metrics");
      } catch {
        return;
      }
      const dbType = DbUtilsGetType();
      const sqlParams = [];
      const fromTime = req.query.from || AnalyticsUtilsGetDefaultFromTime();
      const isRefresh = req.query.afterTime !== undefined;
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
      if (req.query.serviceName && String(req.query.serviceName).trim()) {
        sqlWhere +=
          ' AND "serviceName" = ' +
          AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1);
        sqlParams.push(String(req.query.serviceName).trim());
      }
      if (req.query.name && String(req.query.name).trim()) {
        sqlWhere +=
          " AND name = " +
          AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1);
        sqlParams.push(String(req.query.name).trim());
      }

      // Cursor-based pagination: fetch records older than beforeTime
      if (req.query.beforeTime) {
        sqlWhere +=
          " AND time < " +
          AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1);
        sqlParams.push(req.query.beforeTime);
      }

      const resultLimit = req.query.limit || AnalyticsUtilsResultLimitMetrics;
      const rawMetrics = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.GET_METRICS(sqlWhere, resultLimit)[dbType],
        sqlParams,
      );
      const metrics = [];
      rawMetrics.forEach((rawMetric) => {
        metrics.push(new Metric(rawMetric));
      });

      const response = {
        metrics: await AnalyticsUtilsCompressJson(metrics, "gzip"),
        compressed: true,
      };
      if (rawMetrics.length >= resultLimit) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (response as any).warning = "Too much data. Results are truncated";
      }
      return res.status(200).send(response);
    });

    fastify.get<{
      Querystring: {
        from?: number;
        to?: number;
        keywords?: string;
        serviceName?: string;
      };
    }>("/names", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      try {
        await AuthHasScope(req, res, "metrics");
      } catch {
        return;
      }

      const names = AnalyticsCacheFilterMetricsNames(
        req.query.serviceName,
        req.query.keywords,
        req.query.from,
        req.query.to,
      );

      const response = {
        metricsNames: await AnalyticsUtilsCompressJson(names, "gzip"),
        compressed: true,
      };
      return res.status(200).send(response);
    });
  }
}

// SQL

const SQL_QUERIES = {
  GET_METRICS: (sqlWhere: string, limit: number) => ({
    postgres: `SELECT "name", "serviceName", "serviceVersion", "time", "type", "rawMetric" FROM metrics ${sqlWhere} ORDER BY "time" DESC LIMIT ${limit}`,
    sqlite: `SELECT name, serviceName, serviceVersion, time, type, rawMetric FROM metrics ${sqlWhere} ORDER BY time DESC LIMIT ${limit}`,
  }),
};
