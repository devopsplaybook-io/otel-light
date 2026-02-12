import { FastifyInstance } from "fastify";
import { Metric } from "../model/Metric";
import { AuthGetUserSession } from "../users/Auth";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import {
  AnalyticsUtilsCompressJson,
  AnalyticsUtilsGetDefaultFromTime,
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
      };
    }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const sqlParams = [];
      const fromTime = req.query.from || AnalyticsUtilsGetDefaultFromTime();
      let sqlWhere = " WHERE time >= ? ";
      sqlParams.push(fromTime);

      if (req.query.to) {
        sqlWhere += " AND time <= ? ";
        sqlParams.push(req.query.to);
      }
      if (req.query.serviceName?.trim()) {
        sqlWhere += " AND serviceName = ? ";
        sqlParams.push(req.query.serviceName.trim());
      }
      if (req.query.name?.trim()) {
        sqlWhere += " AND name = ? ";
        sqlParams.push(req.query.name.trim());
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
      };
    }>("/names", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const sqlParams = [];
      const fromTime = req.query.from || AnalyticsUtilsGetDefaultFromTime();
      let sqlWhere = " WHERE time >= ? ";
      sqlParams.push(fromTime);

      if (req.query.to) {
        sqlWhere += " AND time <= ? ";
        sqlParams.push(req.query.to);
      }

      if (req.query.keywords?.trim()) {
        const kw = `%${req.query.keywords.trim()}%`;
        sqlWhere += " AND (name LIKE ? OR serviceName LIKE ?)";
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
  GET_METRICS: (sqlWhere: string, limit: number) => ({
    postgres: `SELECT * FROM metrics ${sqlWhere} LIMIT ${limit}`,
    sqlite: `SELECT * FROM metrics ${sqlWhere} LIMIT ${limit}`,
  }),
  GET_METRICS_NAMES: (sqlWhere: string) => ({
    postgres: `SELECT DISTINCT "name", "serviceName", "type" FROM metrics ${sqlWhere} ORDER BY "serviceName", "name", "type"`,
    sqlite: `SELECT DISTINCT name, serviceName, type FROM metrics ${sqlWhere} ORDER BY serviceName, name, type`,
  }),
};
