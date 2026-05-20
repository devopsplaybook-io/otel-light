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

const PAGE_SIZE = 200;

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
        offset?: number;
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
      const offset = isRefresh ? 0 : req.query.offset || 0;
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
        SQL_QUERIES.GET_METRICS(sqlWhere, PAGE_SIZE, offset)[DbUtilsGetType()],
        sqlParams,
      );
      const metrics = [];
      rawMetrics.forEach((rawMetric) => {
        metrics.push(new Metric(rawMetric));
      });

      const response = {
        metrics: await AnalyticsUtilsCompressJson(metrics, "gzip"),
        compressed: true,
        hasMore: rawMetrics.length === PAGE_SIZE,
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
      const sqlParams = [];
      const fromTime = req.query.from || AnalyticsUtilsGetDefaultFromTime();
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

      if (req.query.serviceName && String(req.query.serviceName).trim()) {
        sqlWhere +=
          ' AND "serviceName" = ' +
          AnalyticsUtilsGetSQLVariable(DbUtilsGetType(), sqlParams.length + 1);
        sqlParams.push(String(req.query.serviceName).trim());
      }

      if (req.query.keywords?.trim()) {
        const kw = `%${req.query.keywords.toLowerCase().trim()}%`;
        sqlWhere +=
          " AND (name LIKE " +
          AnalyticsUtilsGetSQLVariable(DbUtilsGetType(), sqlParams.length + 1) +
          ' OR "serviceName" LIKE ' +
          AnalyticsUtilsGetSQLVariable(DbUtilsGetType(), sqlParams.length + 2) +
          ")";
        sqlParams.push(kw, kw);
      }

      const rawMetrics = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.GET_METRICS_NAMES(sqlWhere)[DbUtilsGetType()],
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
  GET_METRICS: (sqlWhere: string, limit: number, offset: number) => ({
    postgres: `SELECT "name", "serviceName", "serviceVersion", "time", "type", "rawMetric" FROM metrics ${sqlWhere} ORDER BY "time" DESC LIMIT ${limit} OFFSET ${offset}`,
    sqlite: `SELECT name, serviceName, serviceVersion, time, type, rawMetric FROM metrics ${sqlWhere} ORDER BY "time" DESC LIMIT ${limit} OFFSET ${offset}`,
  }),
  GET_METRICS_NAMES: (sqlWhere: string) => ({
    postgres: `SELECT DISTINCT "name", "serviceName", "type" FROM metrics ${sqlWhere} ORDER BY "serviceName", "name", "type"`,
    sqlite: `SELECT DISTINCT name, serviceName, type FROM metrics ${sqlWhere} ORDER BY serviceName, name, type`,
  }),
};
