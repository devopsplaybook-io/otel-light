import { FastifyInstance } from "fastify";
import { Readable } from "stream";
import { AuthHasScope } from "@devopsplaybook.io/common-utils";
import { Log } from "../model/Log";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import {
  AnalyticsUtilsGetDefaultFromTime,
  AnalyticsUtilsCompressJson,
  AnalyticsUtilsGetSQLVariable,
  AnalyticsUtilsGetTimeParam,
  AnalyticsUtilsParseOffset,
} from "./AnalyticsUtils";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";
import {
  AnalyticsFiltersAttributesSql,
  AnalyticsFiltersKeywordsSql,
  AnalyticsFiltersParse,
} from "./AnalyticsFilters";
import {
  ANALYTICS_EXPORT_LOGS_CSV_HEADER,
  AnalyticsExportContentType,
  AnalyticsExportGetMaxRows,
  AnalyticsExportLogCsvRow,
  AnalyticsExportLogJsonl,
  AnalyticsExportParseFormat,
  AnalyticsExportStream,
} from "./AnalyticsExport";

const PAGE_SIZE = 200;

export class AnalyticsLogsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{
      Querystring: {
        from?: number;
        to?: number;
        keywords?: string;
        attr?: string | string[];
        severity?: string;
        serviceName?: string;
        serviceVersion?: string;
        offset?: number;
        afterTime?: number;
        afterRecordId?: string;
        before?: number;
        beforeRecordId?: string;
      };
    }>("/", async (req, res) => {
      try {
        await AuthHasScope(req, res, "logs");
      } catch {
        return;
      }
      const parsedOffset = AnalyticsUtilsParseOffset(req.query.offset);
      if (parsedOffset === null) {
        return res.status(400).send({ error: "Invalid offset" });
      }
      const dbType = DbUtilsGetType();
      const sqlParams = [];
      const varAt = (index: number) =>
        AnalyticsUtilsGetSQLVariable(dbType, index);
      const isRefresh = req.query.afterTime !== undefined;
      const hasBefore = req.query.before !== undefined;
      // Keyset pagination: when `before` is provided, use cursor instead of OFFSET.
      // This avoids the O(n) scan cost of large OFFSET values on big tables.
      const offset = isRefresh || hasBefore ? 0 : parsedOffset;

      const fromTime = req.query.from || AnalyticsUtilsGetDefaultFromTime();
      let sqlWhere =
        " WHERE time >= " + varAt(sqlParams.length + 1);
      sqlParams.push(AnalyticsUtilsGetTimeParam(fromTime));

      if (req.query.to) {
        sqlWhere +=
          " AND time <= " + varAt(sqlParams.length + 1);
        sqlParams.push(AnalyticsUtilsGetTimeParam(req.query.to));
      }
      // Composite cursors (time, recordId): equal timestamps are common with
      // batched ingestion, so a timestamp-only cursor would skip records.
      if (isRefresh) {
        if (req.query.afterRecordId) {
          const idx = sqlParams.length + 1;
          sqlWhere +=
            ` AND (time > ${varAt(idx)}` +
            ` OR (time = ${varAt(idx + 1)} AND recordId > ${varAt(idx + 2)}))`;
          sqlParams.push(
            AnalyticsUtilsGetTimeParam(req.query.afterTime),
            AnalyticsUtilsGetTimeParam(req.query.afterTime),
            req.query.afterRecordId,
          );
        } else {
          sqlWhere +=
            " AND time > " + varAt(sqlParams.length + 1);
          sqlParams.push(AnalyticsUtilsGetTimeParam(req.query.afterTime));
        }
      }
      if (hasBefore) {
        if (req.query.beforeRecordId) {
          const idx = sqlParams.length + 1;
          sqlWhere +=
            ` AND (time < ${varAt(idx)}` +
            ` OR (time = ${varAt(idx + 1)} AND recordId < ${varAt(idx + 2)}))`;
          sqlParams.push(
            AnalyticsUtilsGetTimeParam(req.query.before),
            AnalyticsUtilsGetTimeParam(req.query.before),
            req.query.beforeRecordId,
          );
        } else {
          sqlWhere +=
            " AND time < " + varAt(sqlParams.length + 1);
          sqlParams.push(AnalyticsUtilsGetTimeParam(req.query.before));
        }
      }
      const parsedFilters = AnalyticsFiltersParse(req.query);
      if (parsedFilters.error) {
        return res.status(400).send({ error: parsedFilters.error });
      }
      const filters = parsedFilters.filters;
      const filterCtx = { dbType, params: sqlParams, varAt };
      sqlWhere += AnalyticsFiltersKeywordsSql(filterCtx, "keywords", filters.keywords);
      sqlWhere += AnalyticsFiltersAttributesSql(
        filterCtx,
        "attributes",
        filters.attributes,
      );
      if (filters.severity) {
        sqlWhere +=
          " AND severity = " + varAt(sqlParams.length + 1);
        sqlParams.push(filters.severity);
      }
      if (filters.serviceName) {
        sqlWhere +=
          ' AND "serviceName" = ' + varAt(sqlParams.length + 1);
        sqlParams.push(filters.serviceName);
      }
      if (filters.serviceVersion) {
        sqlWhere +=
          ' AND "serviceVersion" = ' + varAt(sqlParams.length + 1);
        sqlParams.push(filters.serviceVersion);
      }

      const limitVar = varAt(sqlParams.length + 1);
      const offsetVar = varAt(sqlParams.length + 2);
      sqlParams.push(PAGE_SIZE, offset);
      const rawLogs = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.GET_LOGS(sqlWhere, limitVar, offsetVar)[dbType],
        sqlParams,
      );
      const logs = [];
      rawLogs.forEach((rawLog) => {
        logs.push(new Log(rawLog));
      });

      const response = {
        logs: await AnalyticsUtilsCompressJson(logs, "gzip"),
        compressed: true,
        hasMore: rawLogs.length === PAGE_SIZE,
      };
      return res.status(200).send(response);
    });

    // Streamed export of the complete filtered result set. Paging parameters
    // are ignored: the export always starts at the newest matching record and
    // walks the result in keyset chunks up to ANALYTICS_EXPORT_MAX_ROWS.
    fastify.get<{
      Querystring: {
        from?: number;
        to?: number;
        keywords?: string;
        attr?: string | string[];
        severity?: string;
        serviceName?: string;
        serviceVersion?: string;
        format?: string;
      };
    }>("/export", async (req, res) => {
      try {
        await AuthHasScope(req, res, "logs");
      } catch {
        return;
      }
      const format = AnalyticsExportParseFormat(req.query.format);
      if (!format) {
        return res.status(400).send({ error: "Invalid format" });
      }
      const parsedFilters = AnalyticsFiltersParse(req.query);
      if (parsedFilters.error) {
        return res.status(400).send({ error: parsedFilters.error });
      }
      const filters = parsedFilters.filters;
      const dbType = DbUtilsGetType();
      const varAt = (index: number) =>
        AnalyticsUtilsGetSQLVariable(dbType, index);
      const fromTime = req.query.from || AnalyticsUtilsGetDefaultFromTime();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fetchChunk = async (cursor: any, limit: number) => {
        const params: unknown[] = [];
        let where = " WHERE time >= " + varAt(params.length + 1);
        params.push(AnalyticsUtilsGetTimeParam(fromTime));
        if (req.query.to) {
          where += " AND time <= " + varAt(params.length + 1);
          params.push(AnalyticsUtilsGetTimeParam(req.query.to));
        }
        if (cursor) {
          const idx = params.length + 1;
          where +=
            ` AND (time < ${varAt(idx)}` +
            ` OR (time = ${varAt(idx + 1)} AND recordId < ${varAt(idx + 2)}))`;
          params.push(cursor.time, cursor.time, cursor.id);
        }
        const ctx = { dbType, params, varAt };
        where += AnalyticsFiltersKeywordsSql(ctx, "keywords", filters.keywords);
        where += AnalyticsFiltersAttributesSql(
          ctx,
          "attributes",
          filters.attributes,
        );
        if (filters.severity) {
          where += " AND severity = " + varAt(params.length + 1);
          params.push(filters.severity);
        }
        if (filters.serviceName) {
          where += ' AND "serviceName" = ' + varAt(params.length + 1);
          params.push(filters.serviceName);
        }
        if (filters.serviceVersion) {
          where += ' AND "serviceVersion" = ' + varAt(params.length + 1);
          params.push(filters.serviceVersion);
        }
        const limitVar = varAt(params.length + 1);
        params.push(limit);
        return DbUtilsNoTelemetryQuerySQL(
          SQL_QUERIES.EXPORT_LOGS(where, limitVar)[dbType],
          params,
        );
      };

      const maxRows = AnalyticsExportGetMaxRows();
      res.header("Content-Type", AnalyticsExportContentType(format));
      res.header(
        "Content-Disposition",
        `attachment; filename="logs-export.${format}"`,
      );
      res.header("X-Export-Max-Rows", String(maxRows));
      res.header("X-Export-Format", format);
      res.header("Cache-Control", "no-store");
      const stream = AnalyticsExportStream({
        format,
        maxRows,
        header: ANALYTICS_EXPORT_LOGS_CSV_HEADER,
        fetchChunk,
        cursorOf: (row) => ({ time: Number(row.time), id: String(row.recordId) }),
        toCsv: AnalyticsExportLogCsvRow,
        toJsonl: AnalyticsExportLogJsonl,
      });
      return res.send(Readable.from(stream));
    });
  }
}

// SQL

const SQL_QUERIES = {
  GET_LOGS: (sqlWhere: string, limitVar: string, offsetVar: string) => ({
    postgres: `SELECT "time", "severity", "serviceName", "serviceVersion", "traceId", "spanId", "logText", "attributes", "recordId" FROM logs ${sqlWhere} ORDER BY "time" DESC, "recordId" DESC LIMIT ${limitVar} OFFSET ${offsetVar}`,
    sqlite: `SELECT time, severity, serviceName, serviceVersion, traceId, spanId, logText, attributes, recordId FROM logs ${sqlWhere} ORDER BY time DESC, recordId DESC LIMIT ${limitVar} OFFSET ${offsetVar}`,
  }),
  EXPORT_LOGS: (sqlWhere: string, limitVar: string) => ({
    postgres: `SELECT "time", "severity", "serviceName", "serviceVersion", "traceId", "spanId", "logText", "attributes", "recordId" FROM logs ${sqlWhere} ORDER BY "time" DESC, "recordId" DESC LIMIT ${limitVar}`,
    sqlite: `SELECT time, severity, serviceName, serviceVersion, traceId, spanId, logText, attributes, recordId FROM logs ${sqlWhere} ORDER BY time DESC, recordId DESC LIMIT ${limitVar}`,
  }),
};
