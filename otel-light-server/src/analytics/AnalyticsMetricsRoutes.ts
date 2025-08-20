import { FastifyInstance } from "fastify";
import { Metric } from "../model/Metric";
import { AuthGetUserSession } from "../users/Auth";
import { SqlDbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/SqlDbUtilsNoTelemetry";
import {
  AnalyticsUtilsCompressJson,
  AnalyticsUtilsGetDefaultFromTime,
  AnalyticsUtilsResultLimitMetrics,
} from "./AnalyticsUtils";

export class AnalyticsMetricsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{
      Querystring: {
        from?: number;
        to?: number;
        keywords?: string;
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
      if (req.query.keywords?.trim()) {
        sqlWhere += " AND keywords LIKE ? ";
        sqlParams.push(`%${req.query.keywords.trim()}%`);
      }

      const rawMetrics = await SqlDbUtilsNoTelemetryQuerySQL(
        `SELECT * FROM metrics ${sqlWhere} LIMIT ${AnalyticsUtilsResultLimitMetrics}`,
        sqlParams
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
        (response as any).warning = "To much data. Results are truncated";
      }
      return res.status(200).send(response);
    });
  }
}
