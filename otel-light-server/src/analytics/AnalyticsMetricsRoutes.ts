import { FastifyInstance } from "fastify";
import { Metric } from "../model/Metric";
import { AuthGetUserSession } from "../users/Auth";
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
      };
    }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const sqlParams = [];
      const fromTime = req.query.from || AnalyticsUtilsGetDefaultFromTime();
      const isRefresh = req.query.afterTime !== undefined;
      let sqlWhere =
        " WHERE time >= " +
        AnalyticsUtilsGetSQLVariable(DbUtilsGetType(), sqlParams.length + 1);
      sqlParams.push(fromTime);

      if (req.query.to) {
        sqlWhere +=
          " AND time <= " +
          AnalyticsUtilsGetSQLVariable(DbUtilsGetType(), sqlParams.length + 1);
        sqlParams.push(req.query.to);
      }
      if (isRefresh) {
        sqlWhere +=
          " AND time > " +
          AnalyticsUtilsGetSQLVariable(DbUtilsGetType(), sqlParams.length + 1);
        sqlParams.push(req.query.afterTime);
      }
      if (req.query.serviceName && String(req.query.serviceName).trim()) {
        sqlWhere +=
          ' AND "serviceName" = ' +
          AnalyticsUtilsGetSQLVariable(DbUtilsGetType(), sqlParams.length + 1);
        sqlParams.push(String(req.query.serviceName).trim());
      }
      if (req.query.name && String(req.query.name).trim()) {
        sqlWhere +=
          " AND name = " +
          AnalyticsUtilsGetSQLVariable(DbUtilsGetType(), sqlParams.length + 1);
        sqlParams.push(String(req.query.name).trim());
      }
      const rawMetrics = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.GET_METRICS(sqlWhere, AnalyticsUtilsResultLimitMetrics)[
          DbUtilsGetType()
        ],
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
      if (rawMetrics.length >= AnalyticsUtilsResultLimitMetrics) {
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
      const dbType = DbUtilsGetType();
      const sqlParams = [];
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

      if (req.query.serviceName && String(req.query.serviceName).trim()) {
        sqlWhere +=
          ' AND "serviceName" = ' +
          AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1);
        sqlParams.push(String(req.query.serviceName).trim());
      }

      const hasKeywords = !!req.query.keywords?.trim();
      if (hasKeywords) {
        const kw = `%${req.query.keywords.toLowerCase().trim()}%`;
        sqlWhere +=
          " AND (name LIKE " +
          AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1) +
          ' OR "serviceName" LIKE ' +
          AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 2) +
          ")";
        sqlParams.push(kw, kw);
      }

      // Use recursive CTE skip scan for PostgreSQL when no keywords filter.
      // Skip scan does O(unique_names) index lookups instead of scanning all rows.
      // Fall back to DISTINCT when keywords (LIKE) is active or for SQLite.
      const template = hasKeywords
        ? SQL_QUERIES.GET_METRICS_NAMES_DISTINCT(sqlWhere)
        : SQL_QUERIES.GET_METRICS_NAMES_SKIP_SCAN(sqlWhere);
      const rawMetrics = await DbUtilsNoTelemetryQuerySQL(
        template[dbType],
        sqlParams,
      );
      const metricsNames: {
        serviceName: string;
        name: string;
        type: string;
      }[] = [];
      rawMetrics.forEach((rawMetric) => {
        metricsNames.push({
          serviceName: rawMetric.serviceName,
          name: rawMetric.name,
          type: rawMetric.type,
        });
      });

      const response = {
        metricsNames: await AnalyticsUtilsCompressJson(metricsNames, "gzip"),
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
  // Recursive CTE skip scan: finds each unique (serviceName, name, type) triplet
  // with a single index lookup per unique value, instead of scanning all matching rows.
  // Falls back to DISTINCT when keywords filter is active (LIKE defeats skip scan).
  GET_METRICS_NAMES_SKIP_SCAN: (sqlWhere: string) => ({
    postgres: `
      WITH RECURSIVE names AS (
        SELECT "name", "serviceName", "type"
        FROM metrics
        ${sqlWhere}
        ORDER BY "serviceName", "name", "type"
        LIMIT 1
        UNION ALL
        SELECT m."name", m."serviceName", m."type"
        FROM names n
        CROSS JOIN LATERAL (
          SELECT "name", "serviceName", "type"
          FROM metrics
          ${sqlWhere}
            AND ("serviceName", "name", "type") > (n."serviceName", n."name", n."type")
          ORDER BY "serviceName", "name", "type"
          LIMIT 1
        ) m
      )
      SELECT * FROM names
      ORDER BY "serviceName", "name", "type"`,
    sqlite: `SELECT DISTINCT name, serviceName, type FROM metrics ${sqlWhere} ORDER BY serviceName, name, type`,
  }),
  // Regular DISTINCT fallback — used when keywords (LIKE) filter is active,
  // since the skip-scan CTE cannot incorporate OR'd LIKE conditions efficiently.
  GET_METRICS_NAMES_DISTINCT: (sqlWhere: string) => ({
    postgres: `SELECT DISTINCT "name", "serviceName", "type" FROM metrics ${sqlWhere} ORDER BY "serviceName", "name", "type"`,
    sqlite: `SELECT DISTINCT name, serviceName, type FROM metrics ${sqlWhere} ORDER BY serviceName, name, type`,
  }),
};
