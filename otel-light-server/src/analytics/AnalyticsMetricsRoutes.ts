import { AnalyticsCacheFilterMetricsNames } from "./AnalyticsCache";
import { FastifyInstance } from "fastify";
import { Metric } from "../model/Metric";
import { AuthGetUserSession, AuthHasScope } from "@devopsplaybook.io/common-utils";
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
        maxPoints?: number;
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

      const resultLimit =
        parsePositiveInt(req.query.limit, AnalyticsUtilsResultLimitMetrics) ||
        AnalyticsUtilsResultLimitMetrics;
      // When maxPoints is set, rows are downsampled server-side (evenly over
      // the time range) so the client receives a bounded payload instead of
      // paginating through the full data set only to downsample it locally.
      const maxPoints = parsePositiveInt(
        req.query.maxPoints,
        AnalyticsUtilsResultLimitMetrics,
      );
      let rawMetrics;
      if (maxPoints) {
        const countRows = await DbUtilsNoTelemetryQuerySQL(
          SQL_QUERIES.COUNT_METRICS(sqlWhere)[dbType],
          sqlParams,
        );
        const totalCount = Number(countRows[0]?.total || 0);
        const step = Math.max(1, Math.ceil(totalCount / maxPoints));
        if (step > 1) {
          rawMetrics = await DbUtilsNoTelemetryQuerySQL(
            SQL_QUERIES.GET_METRICS_SAMPLED(sqlWhere, step, maxPoints)[dbType],
            sqlParams,
          );
        } else {
          rawMetrics = await DbUtilsNoTelemetryQuerySQL(
            SQL_QUERIES.GET_METRICS(sqlWhere, maxPoints)[dbType],
            sqlParams,
          );
        }
      } else {
        rawMetrics = await DbUtilsNoTelemetryQuerySQL(
          SQL_QUERIES.GET_METRICS(sqlWhere, resultLimit)[dbType],
          sqlParams,
        );
      }
      const metrics = [];
      rawMetrics.forEach((rawMetric) => {
        metrics.push(new Metric(rawMetric));
      });

      const response = {
        metrics: await AnalyticsUtilsCompressJson(metrics, "gzip"),
        compressed: true,
      };
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

function parsePositiveInt(value: unknown, max: number): number | null {
  const parsed = parseInt(String(value ?? ""), 10);
  if (isNaN(parsed) || parsed < 1) {
    return null;
  }
  return Math.min(parsed, max);
}

const SQL_QUERIES = {
  GET_METRICS: (sqlWhere: string, limit: number) => ({
    postgres: `SELECT "name", "serviceName", "serviceVersion", "time", "type", "rawMetric" FROM metrics ${sqlWhere} ORDER BY "time" DESC LIMIT ${limit}`,
    sqlite: `SELECT name, serviceName, serviceVersion, time, type, rawMetric FROM metrics ${sqlWhere} ORDER BY time DESC LIMIT ${limit}`,
  }),
  COUNT_METRICS: (sqlWhere: string) => ({
    postgres: `SELECT COUNT(*) AS total FROM metrics ${sqlWhere}`,
    sqlite: `SELECT COUNT(*) AS total FROM metrics ${sqlWhere}`,
  }),
  // Evenly samples 1 row every `step` rows (keeping the most recent one) so
  // that at most `maxPoints` rows are returned whatever the total volume.
  GET_METRICS_SAMPLED: (sqlWhere: string, step: number, maxPoints: number) => ({
    postgres: `SELECT "name", "serviceName", "serviceVersion", "time", "type", "rawMetric" FROM (SELECT "name", "serviceName", "serviceVersion", "time", "type", "rawMetric", ROW_NUMBER() OVER (ORDER BY "time" DESC) AS rn FROM metrics ${sqlWhere}) sampled WHERE (rn % ${step}) = 1 ORDER BY "time" DESC LIMIT ${maxPoints}`,
    sqlite: `SELECT name, serviceName, serviceVersion, time, type, rawMetric FROM (SELECT name, serviceName, serviceVersion, time, type, rawMetric, ROW_NUMBER() OVER (ORDER BY time DESC) AS rn FROM metrics ${sqlWhere}) WHERE (rn % ${step}) = 1 ORDER BY time DESC LIMIT ${maxPoints}`,
  }),
};
