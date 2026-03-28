import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { Trace } from "../model/Trace";
import { Span } from "../model/Span";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  AnalyticsUtilsCompressJson,
  AnalyticsUtilsGetSQLVariable,
  AnalyticsUtilsResultLimit,
} from "./AnalyticsUtils";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";

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
        errorsOnly?: string;
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
        sqlWhere = appendWhereCondition(
          sqlWhere,
          't."traceId" = ' +
            AnalyticsUtilsGetSQLVariable(
              DbUtilsGetType(),
              sqlParams.length + 1,
            ),
        );
        sqlParams.push(req.query.traceId);
      }

      if (req.query.from) {
        sqlWhere = appendWhereCondition(
          sqlWhere,
          'rootSpan."startTime" >= ' +
            AnalyticsUtilsGetSQLVariable(
              DbUtilsGetType(),
              sqlParams.length + 1,
            ),
        );
        sqlParams.push(req.query.from);
      }
      if (req.query.to) {
        sqlWhere = appendWhereCondition(
          sqlWhere,
          'rootSpan."startTime" <= ' +
            AnalyticsUtilsGetSQLVariable(
              DbUtilsGetType(),
              sqlParams.length + 1,
            ),
        );
        sqlParams.push(req.query.to);
      }
      if (req.query.keywords?.trim()) {
        sqlWhere = appendWhereCondition(
          sqlWhere,
          "rootSpan.keywords LIKE " +
            AnalyticsUtilsGetSQLVariable(
              DbUtilsGetType(),
              sqlParams.length + 1,
            ),
        );
        sqlParams.push(`%${req.query.keywords.toLowerCase().trim()}%`);
      }

      const errorsOnly = req.query.errorsOnly === "true";
      if (errorsOnly && DbUtilsGetType() === "sqlite") {
        sqlParams.push(SpanStatusCode.ERROR);
      }

      const rawTraces = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.GET_TRACES(sqlWhere, errorsOnly)[DbUtilsGetType()],
        sqlParams,
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

      const rawSpans = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.GET_TRACE_SPANS[DbUtilsGetType()],
        [req.params.traceId],
      );
      const spans = [];
      rawSpans.forEach((rawSpan) => {
        spans.push(new Span(rawSpan));
      });

      return res.status(200).send({ spans });
    });

    fastify.get<{
      Params: {
        traceId: string;
      };
    }>("/:traceId/logs", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const rawLogs = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.GET_TRACE_LOGS[DbUtilsGetType()],
        [req.params.traceId],
      );
      const logs = [];
      rawLogs.forEach((rawLog) => {
        logs.push(new Span(rawLog));
      });

      return res.status(200).send({ logs });
    });
  }
}

// SQL

const SQL_QUERIES = {
  GET_TRACES: (sqlWhere: string, errorsOnly: boolean) => {
    const havingPostgres = errorsOnly
      ? ' HAVING COUNT(CASE WHEN t."statusCode" = $1 THEN 1 END) > 0'
      : "";
    const havingSqlite = errorsOnly
      ? " HAVING COUNT(CASE WHEN t.statusCode = ? THEN 1 END) > 0"
      : "";
    return {
      postgres: `
      SELECT  MIN(t."startTime") AS "startTime", 
              MAX(t."endTime") AS "endTime", 
              t."traceId", 
              COUNT(*) as "spanCount", 
              rootSpan."name" AS "name", 
              rootSpan."serviceName" AS "serviceName", 
              rootSpan."serviceVersion" AS "serviceVersion", 
              COUNT(CASE WHEN t."statusCode" = $1 THEN 1 END) AS "nbErrors" 
      FROM traces t 
        LEFT JOIN traces rootSpan ON rootSpan."traceId" = t."traceId" AND rootSpan."parentSpanId" IS NULL${sqlWhere} 
      GROUP BY t."traceId", rootSpan."name", rootSpan."serviceName", rootSpan."serviceVersion"${havingPostgres} 
      ORDER BY "startTime" DESC`,
      sqlite: `
      SELECT  MIN(t.startTime) AS startTime, 
              MAX(t.endTime) AS endTime, 
              t.traceId, 
              COUNT(*) as spanCount, 
              rootSpan.name AS name, 
              rootSpan.serviceName AS serviceName, 
              rootSpan.serviceVersion AS serviceVersion, 
              COUNT(CASE WHEN t.statusCode = ? THEN 1 END) AS nbErrors 
      FROM traces t 
        LEFT JOIN traces rootSpan ON rootSpan.traceId = t.traceId AND rootSpan.parentSpanId IS NULL${sqlWhere} 
      GROUP BY t.traceId${havingSqlite} 
      ORDER BY t.startTime DESC`,
    };
  },
  GET_TRACE_SPANS: {
    postgres: `SELECT * FROM traces WHERE "traceId" = $1 ORDER BY "startTime"`,
    sqlite: `SELECT * FROM traces WHERE traceId = ? ORDER BY startTime`,
  },
  GET_TRACE_LOGS: {
    postgres: `SELECT * FROM logs WHERE "traceId" = $1`,
    sqlite: `SELECT * FROM logs WHERE traceId = ?`,
  },
};
