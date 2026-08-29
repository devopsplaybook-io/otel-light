import { FastifyInstance } from "fastify";
import { AuthGetUserSession, AuthHasScope } from "@devopsplaybook.io/common-utils";
import { Trace } from "../model/Trace";
import { Span } from "../model/Span";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  AnalyticsUtilsCompressJson,
  AnalyticsUtilsGetSQLVariable,
} from "./AnalyticsUtils";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";

const PAGE_SIZE = 200;

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
        serviceName?: string;
        serviceVersion?: string;
        offset?: number;
        afterTime?: number;
        before?: number;
      };
    }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      try {
        await AuthHasScope(req, res, "traces");
      } catch {
        return;
      }

      const isRefresh = req.query.afterTime !== undefined;
      const offset = isRefresh ? 0 : req.query.offset || 0;
      const hasBefore = req.query.before !== undefined;
      // Keyset pagination: when `before` is provided, use cursor instead of OFFSET.
      const effectiveOffset = isRefresh || hasBefore ? 0 : offset;
      const errorsOnly = req.query.errorsOnly === "true";
      const dbType = DbUtilsGetType();
      // Quote an identifier for the target DB: PostgreSQL needs double-quotes
      // to preserve camelCase column names created with quoted identifiers.
      const q = (ident: string) =>
        dbType === "postgres" ? `"${ident}"` : ident;

      // Build roots CTE: find root spans matching all filters first.
      // This avoids the expensive self-JOIN with WHERE on the JOINed side.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rootsParams: any[] = [];
      let rootsWhere = `${q("parentSpanId")} IS NULL`;

      if (req.query.traceId) {
        rootsWhere +=
          ` AND ${q("traceId")} = ` +
          AnalyticsUtilsGetSQLVariable(dbType, rootsParams.length + 1);
        rootsParams.push(req.query.traceId);
      } else {
        if (req.query.from) {
          rootsWhere +=
            ` AND ${q("startTime")} >= ` +
            AnalyticsUtilsGetSQLVariable(dbType, rootsParams.length + 1);
          rootsParams.push(req.query.from);
        }
        if (isRefresh) {
          rootsWhere +=
            ` AND ${q("startTime")} > ` +
            AnalyticsUtilsGetSQLVariable(dbType, rootsParams.length + 1);
          rootsParams.push(req.query.afterTime);
        }
        if (req.query.to) {
          rootsWhere +=
            ` AND ${q("startTime")} <= ` +
            AnalyticsUtilsGetSQLVariable(dbType, rootsParams.length + 1);
          rootsParams.push(req.query.to);
        }
        if (hasBefore) {
          rootsWhere +=
            ` AND ${q("startTime")} < ` +
            AnalyticsUtilsGetSQLVariable(dbType, rootsParams.length + 1);
          rootsParams.push(req.query.before);
        }
      }

      if (req.query.keywords?.trim()) {
        rootsWhere +=
          ` AND ${q("keywords")} LIKE ` +
          AnalyticsUtilsGetSQLVariable(dbType, rootsParams.length + 1);
        rootsParams.push(`%${req.query.keywords.toLowerCase().trim()}%`);
      }

      if (req.query.serviceName && String(req.query.serviceName).trim()) {
        rootsWhere +=
          ` AND ${q("serviceName")} = ` +
          AnalyticsUtilsGetSQLVariable(dbType, rootsParams.length + 1);
        rootsParams.push(String(req.query.serviceName).trim());
      }

      if (req.query.serviceVersion && String(req.query.serviceVersion).trim()) {
        rootsWhere +=
          ` AND ${q("serviceVersion")} = ` +
          AnalyticsUtilsGetSQLVariable(dbType, rootsParams.length + 1);
        rootsParams.push(String(req.query.serviceVersion).trim());
      }

      // Outer query: aggregates only the traces found by the roots CTE.
      // $statusCode variable index = rootsParams.length + 1 (1-based).
      const statusCodeVarIdx = rootsParams.length + 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outerParams: any[] = [SpanStatusCode.ERROR];
      if (errorsOnly && dbType === "sqlite") {
        outerParams.push(SpanStatusCode.ERROR);
      }

      const allParams = [...rootsParams, ...outerParams];

      const rawTraces = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.GET_TRACES_CTE(
          rootsWhere,
          errorsOnly,
          PAGE_SIZE,
          effectiveOffset,
          statusCodeVarIdx,
        )[dbType],
        allParams,
      );
      const traces = [];
      rawTraces.forEach((rawTrace) => {
        traces.push(new Trace(rawTrace));
      });

      const response = {
        traces: await AnalyticsUtilsCompressJson(traces, "gzip"),
        compressed: true,
        hasMore: rawTraces.length === PAGE_SIZE,
      };
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
      try {
        await AuthHasScope(req, res, "traces");
      } catch {
        return;
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
      try {
        await AuthHasScope(req, res, "traces");
      } catch {
        return;
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
  // Two-phase CTE approach: first find root spans matching filters (index-only scan
  // on idx_traces_rootspan_time), then aggregate only those traces' child spans.
  // statusCodeVarIdx is the 1-based parameter index for SpanStatusCode.ERROR.
  GET_TRACES_CTE: (
    rootsWhere: string,
    errorsOnly: boolean,
    limit: number,
    offset: number,
    statusCodeVarIdx: number,
  ) => {
    const havingPostgres = errorsOnly
      ? ` HAVING COUNT(CASE WHEN t."statusCode" = $${statusCodeVarIdx} THEN 1 END) > 0`
      : "";
    // SQLite uses positional ? placeholders — the statusCode param naturally
    // sits at the boundary between rootsParams and outerParams in allParams.
    const havingSqlite = errorsOnly
      ? " HAVING COUNT(CASE WHEN t.statusCode = ? THEN 1 END) > 0"
      : "";
    return {
      postgres: `
      WITH roots AS (
        SELECT "traceId", "name", "serviceName", "serviceVersion", "startTime"
        FROM traces
        WHERE ${rootsWhere}
        ORDER BY "startTime" DESC
        LIMIT ${limit} OFFSET ${offset}
      )
      SELECT  MIN(t."startTime") AS "startTime",
              MAX(t."endTime") AS "endTime",
              t."traceId",
              COUNT(*) as "spanCount",
              r."name" AS "name",
              r."serviceName" AS "serviceName",
              r."serviceVersion" AS "serviceVersion",
              COUNT(CASE WHEN t."statusCode" = $${statusCodeVarIdx} THEN 1 END) AS "nbErrors"
      FROM traces t
        JOIN roots r ON r."traceId" = t."traceId"
      GROUP BY t."traceId", r."name", r."serviceName", r."serviceVersion"${havingPostgres}
      ORDER BY "startTime" DESC`,
      sqlite: `
      WITH roots AS (
        SELECT traceId, name, serviceName, serviceVersion, startTime
        FROM traces
        WHERE ${rootsWhere}
        ORDER BY startTime DESC
        LIMIT ${limit} OFFSET ${offset}
      )
      SELECT  MIN(t.startTime) AS startTime,
              MAX(t.endTime) AS endTime,
              t.traceId,
              COUNT(*) as spanCount,
              r.name AS name,
              r.serviceName AS serviceName,
              r.serviceVersion AS serviceVersion,
              COUNT(CASE WHEN t.statusCode = ? THEN 1 END) AS nbErrors
      FROM traces t
        JOIN roots r ON r.traceId = t.traceId
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
