import { FastifyInstance } from "fastify";
import { Readable } from "stream";
import { AuthHasScope } from "@devopsplaybook.io/common-utils";
import { Trace } from "../model/Trace";
import { Span } from "../model/Span";
import { Log } from "../model/Log";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  AnalyticsUtilsCompressJson,
  AnalyticsUtilsGetDefaultFromTime24h,
  AnalyticsUtilsGetSQLVariable,
  AnalyticsUtilsGetTimeParam,
  AnalyticsUtilsParseOffset,
} from "./AnalyticsUtils";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";
import {
  AnalyticsFiltersAttributesSql,
  AnalyticsFiltersDurationSql,
  AnalyticsFiltersKeywordsSql,
  AnalyticsFiltersParse,
} from "./AnalyticsFilters";
import {
  ANALYTICS_EXPORT_TRACES_CSV_HEADER,
  AnalyticsExportContentType,
  AnalyticsExportGetMaxRows,
  AnalyticsExportParseFormat,
  AnalyticsExportStream,
  AnalyticsExportTraceCsvRow,
  AnalyticsExportTraceJsonl,
} from "./AnalyticsExport";

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
        attr?: string | string[];
        traceId?: string;
        errorsOnly?: string;
        status?: string;
        durationMin?: string | number;
        durationMax?: string | number;
        serviceName?: string;
        serviceVersion?: string;
        name?: string;
        offset?: number;
        afterTime?: number;
        afterTraceId?: string;
        before?: number;
        beforeTraceId?: string;
      };
    }>("/", async (req, res) => {
      try {
        await AuthHasScope(req, res, "traces");
      } catch {
        return;
      }

      const parsedOffset = AnalyticsUtilsParseOffset(req.query.offset);
      if (parsedOffset === null) {
        return res.status(400).send({ error: "Invalid offset" });
      }
      const isRefresh = req.query.afterTime !== undefined;
      const hasBefore = req.query.before !== undefined;
      // Keyset pagination: when `before` is provided, use cursor instead of OFFSET.
      // This avoids the O(n) scan cost of large OFFSET values on big tables.
      const effectiveOffset = isRefresh || hasBefore ? 0 : parsedOffset;
      const errorsOnly = req.query.errorsOnly === "true";
      const dbType = DbUtilsGetType();
      // Quote an identifier for the target DB: PostgreSQL needs double-quotes
      // to preserve camelCase column names created with quoted identifiers.
      const q = (ident: string) =>
        dbType === "postgres" ? `"${ident}"` : ident;
      const varAt = (index: number) =>
        AnalyticsUtilsGetSQLVariable(dbType, index);

      // Build roots CTE: find root spans matching all filters first.
      // This avoids the expensive self-JOIN with WHERE on the JOINed side.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rootsParams: any[] = [];
      let rootsWhere = `${q("parentSpanId")} IS NULL`;

      if (req.query.traceId) {
        rootsWhere +=
          ` AND ${q("traceId")} = ` + varAt(rootsParams.length + 1);
        rootsParams.push(req.query.traceId);
      } else {
        if (req.query.from) {
          rootsWhere +=
            ` AND ${q("startTime")} >= ` + varAt(rootsParams.length + 1);
          rootsParams.push(AnalyticsUtilsGetTimeParam(req.query.from));
        }
        // Composite cursors (startTime, traceId): equal timestamps must not be
        // skipped, so the boundary timestamp alone is not sufficient.
        if (isRefresh) {
          if (req.query.afterTraceId) {
            const idx = rootsParams.length + 1;
            rootsWhere +=
              ` AND (${q("startTime")} > ${varAt(idx)}` +
              ` OR (${q("startTime")} = ${varAt(idx + 1)}` +
              ` AND ${q("traceId")} > ${varAt(idx + 2)}))`;
            rootsParams.push(
              AnalyticsUtilsGetTimeParam(req.query.afterTime),
              AnalyticsUtilsGetTimeParam(req.query.afterTime),
              req.query.afterTraceId,
            );
          } else {
            rootsWhere +=
              ` AND ${q("startTime")} > ` + varAt(rootsParams.length + 1);
            rootsParams.push(AnalyticsUtilsGetTimeParam(req.query.afterTime));
          }
        }
        if (req.query.to) {
          rootsWhere +=
            ` AND ${q("startTime")} <= ` + varAt(rootsParams.length + 1);
          rootsParams.push(AnalyticsUtilsGetTimeParam(req.query.to));
        }
        if (hasBefore) {
          if (req.query.beforeTraceId) {
            const idx = rootsParams.length + 1;
            rootsWhere +=
              ` AND (${q("startTime")} < ${varAt(idx)}` +
              ` OR (${q("startTime")} = ${varAt(idx + 1)}` +
              ` AND ${q("traceId")} < ${varAt(idx + 2)}))`;
            rootsParams.push(
              AnalyticsUtilsGetTimeParam(req.query.before),
              AnalyticsUtilsGetTimeParam(req.query.before),
              req.query.beforeTraceId,
            );
          } else {
            rootsWhere +=
              ` AND ${q("startTime")} < ` + varAt(rootsParams.length + 1);
            rootsParams.push(AnalyticsUtilsGetTimeParam(req.query.before));
          }
        }
      }

      const parsedFilters = AnalyticsFiltersParse(req.query, { traces: true });
      if (parsedFilters.error) {
        return res.status(400).send({ error: parsedFilters.error });
      }
      const filters = parsedFilters.filters;
      const filterCtx = { dbType, params: rootsParams, varAt };
      rootsWhere += AnalyticsFiltersKeywordsSql(
        filterCtx,
        q("keywords"),
        filters.keywords,
      );
      rootsWhere += AnalyticsFiltersAttributesSql(
        filterCtx,
        `traces.${q("attributes")}`,
        filters.attributes,
      );

      if (filters.serviceName) {
        rootsWhere +=
          ` AND ${q("serviceName")} = ` + varAt(rootsParams.length + 1);
        rootsParams.push(filters.serviceName);
      }

      if (filters.serviceVersion) {
        rootsWhere +=
          ` AND ${q("serviceVersion")} = ` + varAt(rootsParams.length + 1);
        rootsParams.push(filters.serviceVersion);
      }

      if (req.query.name && String(req.query.name).trim()) {
        rootsWhere +=
          ` AND ${q("name")} = ` + varAt(rootsParams.length + 1);
        rootsParams.push(String(req.query.name).trim());
      }

      if (filters.status !== undefined) {
        rootsWhere +=
          ` AND ${q("statusCode")} = ` + varAt(rootsParams.length + 1);
        rootsParams.push(filters.status);
      }

      rootsWhere += AnalyticsFiltersDurationSql(
        filterCtx,
        `traces.${q("traceId")}`,
        filters.durationMinNs,
        filters.durationMaxNs,
      );

      // errorsOnly must filter BEFORE the LIMIT (in the roots CTE), otherwise
      // a page can come back short and hasMore/pagination become inconsistent.
      // EXISTS covers the root span itself and any child span of the trace.
      if (errorsOnly) {
        rootsWhere +=
          ` AND EXISTS (SELECT 1 FROM traces e WHERE e.${q("traceId")} = traces.${q("traceId")}` +
          ` AND e.${q("statusCode")} = ${varAt(rootsParams.length + 1)})`;
        rootsParams.push(SpanStatusCode.ERROR);
      }

      // Outer query: aggregates only the traces found by the roots CTE.
      // Bound parameters follow the SQL text: rootsWhere, then LIMIT/OFFSET
      // inside the CTE, then the outer $statusCode variable.
      const limitVarIdx = rootsParams.length + 1;
      const offsetVarIdx = rootsParams.length + 2;
      const statusCodeVarIdx = rootsParams.length + 3;

      const allParams = [
        ...rootsParams,
        PAGE_SIZE,
        effectiveOffset,
        SpanStatusCode.ERROR,
      ];

      const rawTraces = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.GET_TRACES_CTE(
          rootsWhere,
          varAt(limitVarIdx),
          varAt(offsetVarIdx),
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
      try {
        await AuthHasScope(req, res, "logs");
      } catch {
        return;
      }

      const rawLogs = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.GET_TRACE_LOGS[DbUtilsGetType()],
        [req.params.traceId],
      );
      const logs = [];
      rawLogs.forEach((rawLog) => {
        logs.push(new Log(rawLog));
      });

      return res.status(200).send({ logs });
    });

    // Streamed export of the complete filtered trace result set (aggregated
    // per trace, root-span attributes included). Paging parameters are
    // ignored; the walk is keyset-paginated and bounded by
    // ANALYTICS_EXPORT_MAX_ROWS.
    fastify.get<{
      Querystring: {
        from?: number;
        to?: number;
        keywords?: string;
        attr?: string | string[];
        errorsOnly?: string;
        status?: string;
        durationMin?: string | number;
        durationMax?: string | number;
        serviceName?: string;
        serviceVersion?: string;
        name?: string;
        format?: string;
      };
    }>("/export", async (req, res) => {
      try {
        await AuthHasScope(req, res, "traces");
      } catch {
        return;
      }
      const format = AnalyticsExportParseFormat(req.query.format);
      if (!format) {
        return res.status(400).send({ error: "Invalid format" });
      }
      const parsedFilters = AnalyticsFiltersParse(req.query, { traces: true });
      if (parsedFilters.error) {
        return res.status(400).send({ error: parsedFilters.error });
      }
      const filters = parsedFilters.filters;
      const errorsOnly = req.query.errorsOnly === "true";
      const dbType = DbUtilsGetType();
      const q = (ident: string) =>
        dbType === "postgres" ? `"${ident}"` : ident;
      const varAt = (index: number) =>
        AnalyticsUtilsGetSQLVariable(dbType, index);
      const fromTime =
        req.query.from || AnalyticsUtilsGetDefaultFromTime24h();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fetchChunk = async (cursor: any, limit: number) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const params: any[] = [];
        let where = `${q("parentSpanId")} IS NULL`;
        where += ` AND ${q("startTime")} >= ` + varAt(params.length + 1);
        params.push(AnalyticsUtilsGetTimeParam(fromTime));
        if (req.query.to) {
          where += ` AND ${q("startTime")} <= ` + varAt(params.length + 1);
          params.push(AnalyticsUtilsGetTimeParam(req.query.to));
        }
        if (cursor) {
          const idx = params.length + 1;
          where +=
            ` AND (${q("startTime")} < ${varAt(idx)}` +
            ` OR (${q("startTime")} = ${varAt(idx + 1)}` +
            ` AND ${q("traceId")} < ${varAt(idx + 2)}))`;
          params.push(cursor.time, cursor.time, cursor.id);
        }
        const ctx = { dbType, params, varAt };
        where += AnalyticsFiltersKeywordsSql(ctx, q("keywords"), filters.keywords);
        where += AnalyticsFiltersAttributesSql(
          ctx,
          `traces.${q("attributes")}`,
          filters.attributes,
        );
        if (filters.serviceName) {
          where += ` AND ${q("serviceName")} = ` + varAt(params.length + 1);
          params.push(filters.serviceName);
        }
        if (filters.serviceVersion) {
          where += ` AND ${q("serviceVersion")} = ` + varAt(params.length + 1);
          params.push(filters.serviceVersion);
        }
        if (req.query.name && String(req.query.name).trim()) {
          where += ` AND ${q("name")} = ` + varAt(params.length + 1);
          params.push(String(req.query.name).trim());
        }
        if (filters.status !== undefined) {
          where += ` AND ${q("statusCode")} = ` + varAt(params.length + 1);
          params.push(filters.status);
        }
        where += AnalyticsFiltersDurationSql(
          ctx,
          `traces.${q("traceId")}`,
          filters.durationMinNs,
          filters.durationMaxNs,
        );
        if (errorsOnly) {
          where +=
            ` AND EXISTS (SELECT 1 FROM traces e WHERE e.${q("traceId")} = traces.${q("traceId")}` +
            ` AND e.${q("statusCode")} = ${varAt(params.length + 1)})`;
          params.push(SpanStatusCode.ERROR);
        }
        const limitVar = varAt(params.length + 1);
        const statusCodeVar = varAt(params.length + 2);
        params.push(limit, SpanStatusCode.ERROR);
        return DbUtilsNoTelemetryQuerySQL(
          SQL_QUERIES.EXPORT_TRACES(where, limitVar, statusCodeVar)[dbType],
          params,
        );
      };

      const maxRows = AnalyticsExportGetMaxRows();
      res.header("Content-Type", AnalyticsExportContentType(format));
      res.header(
        "Content-Disposition",
        `attachment; filename="traces-export.${format}"`,
      );
      res.header("X-Export-Max-Rows", String(maxRows));
      res.header("X-Export-Format", format);
      res.header("Cache-Control", "no-store");
      const stream = AnalyticsExportStream({
        format,
        maxRows,
        header: ANALYTICS_EXPORT_TRACES_CSV_HEADER,
        fetchChunk,
        cursorOf: (row) => ({
          time: Number(row.startTime),
          id: String(row.traceId),
        }),
        toCsv: AnalyticsExportTraceCsvRow,
        toJsonl: AnalyticsExportTraceJsonl,
      });
      return res.send(Readable.from(stream));
    });
  }
}

// SQL

const SQL_QUERIES = {
  // Two-phase CTE approach: first find root spans matching filters (index-only scan
  // on idx_traces_rootspan_time), then aggregate only those traces' child spans.
  // statusCodeVarIdx is the 1-based parameter index for SpanStatusCode.ERROR.
  // Page ordering is (root startTime DESC, traceId DESC) — the same key used by
  // the keyset cursors — so equal startTimes cannot skip or duplicate traces.
  GET_TRACES_CTE: (
    rootsWhere: string,
    limitVar: string,
    offsetVar: string,
    statusCodeVarIdx: number,
  ) => ({
    postgres: `
      WITH roots AS (
        SELECT "traceId", "name", "serviceName", "serviceVersion", "startTime"
        FROM traces
        WHERE ${rootsWhere}
        ORDER BY "startTime" DESC, "traceId" DESC
        LIMIT ${limitVar} OFFSET ${offsetVar}
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
      GROUP BY t."traceId", r."name", r."serviceName", r."serviceVersion", r."startTime"
      ORDER BY r."startTime" DESC, t."traceId" DESC`,
    sqlite: `
      WITH roots AS (
        SELECT traceId, name, serviceName, serviceVersion, startTime
        FROM traces
        WHERE ${rootsWhere}
        ORDER BY startTime DESC, traceId DESC
        LIMIT ${limitVar} OFFSET ${offsetVar}
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
      GROUP BY t.traceId, r.name, r.serviceName, r.serviceVersion, r.startTime
      ORDER BY r.startTime DESC, t.traceId DESC`,
  }),
  GET_TRACE_SPANS: {
    postgres: `SELECT "traceId", "spanId", "parentSpanId", "name", "serviceName", "serviceVersion", "startTime", "endTime", "statusCode", "rawSpan" FROM traces WHERE "traceId" = $1 ORDER BY "startTime"`,
    sqlite: `SELECT traceId, spanId, parentSpanId, name, serviceName, serviceVersion, startTime, endTime, statusCode, rawSpan FROM traces WHERE traceId = ? ORDER BY startTime`,
  },
  GET_TRACE_LOGS: {
    postgres: `SELECT * FROM logs WHERE "traceId" = $1`,
    sqlite: `SELECT * FROM logs WHERE traceId = ?`,
  },
  // Same two-phase shape as GET_TRACES_CTE, plus root-span attributes so the
  // export carries the attribute set of the matched root span.
  EXPORT_TRACES: (
    rootsWhere: string,
    limitVar: string,
    statusCodeVar: string,
  ) => ({
    postgres: `
      WITH roots AS (
        SELECT "traceId", "name", "serviceName", "serviceVersion", "startTime", "attributes"
        FROM traces
        WHERE ${rootsWhere}
        ORDER BY "startTime" DESC, "traceId" DESC
        LIMIT ${limitVar}
      )
      SELECT  MIN(t."startTime") AS "startTime",
              MAX(t."endTime") AS "endTime",
              t."traceId",
              COUNT(*) as "spanCount",
              r."name" AS "name",
              r."serviceName" AS "serviceName",
              r."serviceVersion" AS "serviceVersion",
              COUNT(CASE WHEN t."statusCode" = ${statusCodeVar} THEN 1 END) AS "nbErrors",
              r."attributes" AS "attributes"
      FROM traces t
        JOIN roots r ON r."traceId" = t."traceId"
      GROUP BY t."traceId", r."name", r."serviceName", r."serviceVersion", r."startTime", r."attributes"
      ORDER BY r."startTime" DESC, t."traceId" DESC`,
    sqlite: `
      WITH roots AS (
        SELECT traceId, name, serviceName, serviceVersion, startTime, attributes
        FROM traces
        WHERE ${rootsWhere}
        ORDER BY startTime DESC, traceId DESC
        LIMIT ${limitVar}
      )
      SELECT  MIN(t.startTime) AS startTime,
              MAX(t.endTime) AS endTime,
              t.traceId,
              COUNT(*) as spanCount,
              r.name AS name,
              r.serviceName AS serviceName,
              r.serviceVersion AS serviceVersion,
              COUNT(CASE WHEN t.statusCode = ? THEN 1 END) AS nbErrors,
              r.attributes AS attributes
      FROM traces t
        JOIN roots r ON r.traceId = t.traceId
      GROUP BY t.traceId, r.name, r.serviceName, r.serviceVersion, r.startTime, r.attributes
      ORDER BY r.startTime DESC, t.traceId DESC`,
  }),
};
