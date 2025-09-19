import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { Trace } from "../model/Trace";
import { Span } from "../model/Span";
import { SqlDbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/SqlDbUtilsNoTelemetry";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  AnalyticsUtilsCompressJson,
  AnalyticsUtilsGetDefaultFromTime,
  AnalyticsUtilsResultLimit,
} from "./AnalyticsUtils";

export class AnalyticsTracesRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{
      Querystring: {
        from?: number;
        to?: number;
        keywords?: string;
        traceId?: string;
      };
    }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }

      let sqlWhere = "";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sqlParams: any[] = [SpanStatusCode.ERROR];
      const appendWhereCondition = (where: string, condition: string) => {
        if (where.length === 0) {
          where = " WHERE ";
        } else {
          where += " AND ";
        }
        where += condition;
        return where;
      };

      if (req.query.traceId) {
        sqlWhere = appendWhereCondition(sqlWhere, "t.traceId = ?");
        sqlParams.push(req.query.traceId);
      }

      if (req.query.from) {
        sqlWhere = appendWhereCondition(sqlWhere, "rootSpan.startTime >= ?");
        sqlParams.push(req.query.from);
      }
      if (req.query.to) {
        sqlWhere = appendWhereCondition(sqlWhere, "rootSpan.startTime <= ?");
        sqlParams.push(req.query.to);
      }
      if (req.query.keywords?.trim()) {
        sqlWhere = appendWhereCondition(sqlWhere, "rootSpan.keywords LIKE ?");
        sqlParams.push(`%${req.query.keywords.trim()}%`);
      }

      const rawTraces = await SqlDbUtilsNoTelemetryQuerySQL(
        "SELECT " +
          "MIN(t.startTime) AS startTime, " +
          "MAX(t.endTime) AS endTime, " +
          "t.traceId, " +
          "COUNT(*) as spanCount, " +
          "rootSpan.name AS name, " +
          "rootSpan.serviceName AS serviceName, " +
          "rootSpan.serviceVersion AS serviceVersion, " +
          "COUNT(CASE WHEN t.statusCode = ? THEN 1 END) AS nbErrors " +
          "FROM traces t " +
          `LEFT JOIN traces rootSpan ON rootSpan.traceId = t.traceId AND rootSpan.parentSpanId IS NULL` +
          sqlWhere +
          " GROUP BY t.traceId " +
          " ORDER BY t.startTime DESC ",
        sqlParams
      );
      const traces = [];
      rawTraces.forEach((rawTrace) => {
        traces.push(new Trace(rawTrace));
      });

      const response = {
        traces: await AnalyticsUtilsCompressJson(traces, "gzip"),
        compressed: true,
      };
      if (rawTraces.length >= AnalyticsUtilsResultLimit) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (response as any).warning = "Too much data. Results are truncated";
      }
      return res.status(200).send(response);
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
