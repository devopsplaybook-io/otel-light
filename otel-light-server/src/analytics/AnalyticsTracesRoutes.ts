import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { Trace } from "../model/Trace";
import { Span } from "../model/Span";
import { SqlDbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/SqlDbUtilsNoTelemetry";

export class AnalyticsTracesRoutes {
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
        sqlWhere += " rootSpan.startTime >= ? ";
        sqlParams.push(req.query.from);
        hasWheres = true;
      }
      if (req.query.to) {
        if (hasWheres) {
          sqlWhere += " AND ";
        }
        sqlWhere += " rootSpan.startTime <= ? ";
        sqlParams.push(req.query.to);
        hasWheres = true;
      }
      if (req.query.keywords) {
        if (hasWheres) {
          sqlWhere += " AND ";
        }
        sqlWhere += " rootSpan.keywords LIKE ? ";
        sqlParams.push(`%${req.query.keywords}%`);
      }

      const rawTraces = await SqlDbUtilsNoTelemetryQuerySQL(
        "SELECT " +
          "MIN(t.startTime) AS startTime, " +
          "MAX(t.endTime) AS endTime, " +
          "t.traceId, " +
          "COUNT(*) as spanCount, " +
          "rootSpan.name AS name, " +
          "rootSpan.serviceName AS serviceName, " +
          "rootSpan.serviceVersion AS serviceVersion " +
          "FROM traces t " +
          "LEFT JOIN traces rootSpan ON rootSpan.traceId = t.traceId AND rootSpan.parentSpanId IS NULL " +
          sqlWhere +
          " GROUP BY t.traceId " +
          " ORDER BY t.startTime DESC ",
        sqlParams
      );
      const traces = [];
      rawTraces.forEach((rawTrace) => {
        traces.push(new Trace(rawTrace));
      });

      return res.status(200).send({ traces });
    });

    fastify.get<{
      Params: {
        traceId: string;
      };
    }>("/:traceId/spans", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const rawSpans = await SqlDbUtilsNoTelemetryQuerySQL(
        "SELECT * " +
          " FROM traces " +
          " WHERE traceId = ? " +
          " ORDER BY startTime ",
        [req.params.traceId]
      );
      const spans = [];
      rawSpans.forEach((rawSpan) => {
        spans.push(new Span(rawSpan));
      });

      return res.status(200).send({ spans });
    });
  }
}
