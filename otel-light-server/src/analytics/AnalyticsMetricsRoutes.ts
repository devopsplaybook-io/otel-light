import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { Span } from "../model/Span";
import { SqlDbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/SqlDbUtilsNoTelemetry";
import { Metric } from "../model/Metric";

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
      let sqlWhere = " WHERE ";
      let hasWheres = false;
      if (req.query.from) {
        sqlWhere += " time >= ? ";
        sqlParams.push(req.query.from);
        hasWheres = true;
      }
      if (req.query.to) {
        if (hasWheres) {
          sqlWhere += " AND ";
        }
        sqlWhere += " time <= ? ";
        sqlParams.push(req.query.to);
        hasWheres = true;
      }
      if (req.query.keywords) {
        if (hasWheres) {
          sqlWhere += " AND ";
        }
        sqlWhere += " keywords LIKE ? ";
        sqlParams.push(`%${req.query.keywords}%`);
      }

      const rawMetrics = await SqlDbUtilsNoTelemetryQuerySQL(
        "SELECT * FROM metrics " + sqlWhere,
        sqlParams
      );
      const metrics = [];
      rawMetrics.forEach((rawMetric) => {
        metrics.push(new Metric(rawMetric));
      });

      return res.status(200).send({ metrics });
    });
  }
}
