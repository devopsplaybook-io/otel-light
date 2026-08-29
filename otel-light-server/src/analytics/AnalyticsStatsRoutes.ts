import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "@devopsplaybook.io/common-utils";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  AnalyticsUtilsCompressJson,
  AnalyticsUtilsGetSQLVariable,
} from "./AnalyticsUtils";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";

export class AnalyticsStatsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    // Logs stats: server-side aggregation by time bucket + severity.
    // Replaces the client-side loop that fetched every page sequentially.
    fastify.get<{
      Querystring: {
        from?: number;
        to?: number;
        serviceName?: string;
        serviceVersion?: string;
        bucketNs?: number;
      };
    }>("/logs/stats", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const dbType = DbUtilsGetType();
      const sqlParams: (string | number)[] = [];

      let sqlWhere = "";
      const appendWhere = (condition: string) => {
        sqlWhere += sqlWhere ? " AND " : " WHERE ";
        sqlWhere += condition;
      };

      if (req.query.from) {
        appendWhere(
          "time >= " +
            AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1),
        );
        sqlParams.push(req.query.from);
      }
      if (req.query.to) {
        appendWhere(
          "time <= " +
            AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1),
        );
        sqlParams.push(req.query.to);
      }
      if (req.query.serviceName && String(req.query.serviceName).trim()) {
        appendWhere(
          ' "serviceName" = ' +
            AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1),
        );
        sqlParams.push(String(req.query.serviceName).trim());
      }
      if (req.query.serviceVersion && String(req.query.serviceVersion).trim()) {
        appendWhere(
          ' "serviceVersion" = ' +
            AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1),
        );
        sqlParams.push(String(req.query.serviceVersion).trim());
      }

      // Default bucket width: 1 hour in nanoseconds if not specified
      const bucketNs = req.query.bucketNs || 3600 * 1_000_000_000;

      // Add bucketNs twice (once for the bucket expression, once for ordering)
      // We push it once more for the SQL query parameterization.
      // Actually, the SQL uses it only once; no need for the second.
      const bucketParamIdx = sqlParams.length + 1;
      sqlParams.push(bucketNs);

      const rawRows = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.LOGS_STATS(sqlWhere, bucketParamIdx)[dbType],
        sqlParams,
      );

      // Build response: buckets array + severity counts
      const severityCounts: Record<string, number> = {};
      const bucketMap: Record<number, Record<string, number>> = {};
      let totalCount = 0;

      for (const row of rawRows) {
        const sev = (row.severity || "UNKNOWN").toUpperCase();
        const bucket = Number(row.bucket);
        const cnt = Number(row.cnt);
        if (!bucketMap[bucket]) bucketMap[bucket] = {};
        bucketMap[bucket][sev] = (bucketMap[bucket][sev] || 0) + cnt;
        severityCounts[sev] = (severityCounts[sev] || 0) + cnt;
        totalCount += cnt;
      }

      const buckets = Object.entries(bucketMap)
        .map(([bucketNs, sevs]) => ({
          bucket: Number(bucketNs),
          severities: sevs,
        }))
        .sort((a, b) => a.bucket - b.bucket);

      return res.status(200).send({
        buckets,
        totalCount,
        severityCounts,
      });
    });

    // Traces stats: server-side aggregation by serviceName/name.
    // Replaces the single-page fetch + client-side grouping.
    fastify.get<{
      Querystring: {
        from?: number;
        to?: number;
        serviceName?: string;
        serviceVersion?: string;
      };
    }>("/traces/stats", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const dbType = DbUtilsGetType();
      // Quote an identifier for the target DB: PostgreSQL needs double-quotes
      // to preserve camelCase column names created with quoted identifiers.
      const q = (ident: string) =>
        dbType === "postgres" ? `"${ident}"` : ident;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rootsParams: any[] = [];
      let rootsWhere = `${q("parentSpanId")} IS NULL`;

      if (req.query.from) {
        rootsWhere +=
          ` AND ${q("startTime")} >= ` +
          AnalyticsUtilsGetSQLVariable(dbType, rootsParams.length + 1);
        rootsParams.push(req.query.from);
      }
      if (req.query.to) {
        rootsWhere +=
          ` AND ${q("startTime")} <= ` +
          AnalyticsUtilsGetSQLVariable(dbType, rootsParams.length + 1);
        rootsParams.push(req.query.to);
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

      const statusCodeVarIdx = rootsParams.length + 1;
      const allParams = [...rootsParams, SpanStatusCode.ERROR];

      const rawRows = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.TRACES_STATS(rootsWhere, statusCodeVarIdx)[dbType],
        allParams,
      );

      // Build grouped trace stats
      const groups = rawRows.map((row) => ({
        serviceName: row.serviceName,
        serviceVersion: row.serviceVersion,
        name: row.name,
        traceCount: Number(row.traceCount),
        avgSpanCount: Number(row.avgSpanCount),
        nbErrors: Number(row.nbErrors),
        avgDuration: Number(row.avgDuration),
      }));

      return res.status(200).send({
        groups: await AnalyticsUtilsCompressJson(groups, "gzip"),
        compressed: true,
      });
    });
  }
}

// SQL

const SQL_QUERIES = {
  LOGS_STATS: (sqlWhere: string, bucketParamIdx: number) => ({
    postgres: `
      SELECT "severity",
             (FLOOR("time"::decimal / $${bucketParamIdx}) * $${bucketParamIdx})::bigint AS bucket,
             COUNT(*)::int AS cnt
      FROM logs${sqlWhere}
      GROUP BY "severity", bucket
      ORDER BY bucket`,
    sqlite: `
      SELECT severity,
             (CAST(time / ? AS INTEGER) * ?) AS bucket,
             COUNT(*) AS cnt
      FROM logs${sqlWhere}
      GROUP BY severity, bucket
      ORDER BY bucket`,
  }),
  TRACES_STATS: (rootsWhere: string, statusCodeVarIdx: number) => ({
    postgres: `
      WITH roots AS (
        SELECT "traceId", "name", "serviceName", "serviceVersion"
        FROM traces
        WHERE ${rootsWhere}
      )
      SELECT r."name",
             r."serviceName",
             r."serviceVersion",
             COUNT(*)::int AS "traceCount",
             AVG(t."spanCount")::float AS "avgSpanCount",
             SUM(t."nbErrors")::int AS "nbErrors",
             AVG(t."endTime" - t."startTime")::float AS "avgDuration"
      FROM (
        SELECT t."traceId",
               COUNT(*)::int AS "spanCount",
               MIN(t."startTime") AS "startTime",
               MAX(t."endTime") AS "endTime",
               COUNT(CASE WHEN t."statusCode" = $${statusCodeVarIdx} THEN 1 END)::int AS "nbErrors"
        FROM traces t
        JOIN roots r ON r."traceId" = t."traceId"
        GROUP BY t."traceId"
      ) t
      JOIN roots r ON r."traceId" = t."traceId"
      GROUP BY r."name", r."serviceName", r."serviceVersion"
      ORDER BY "traceCount" DESC`,
    sqlite: `
      WITH roots AS (
        SELECT traceId, name, serviceName, serviceVersion
        FROM traces
        WHERE ${rootsWhere}
      )
      SELECT r.name,
             r.serviceName,
             r.serviceVersion,
             COUNT(*) AS traceCount,
             AVG(t.spanCount) AS avgSpanCount,
             SUM(t.nbErrors) AS nbErrors,
             AVG(t.endTime - t.startTime) AS avgDuration
      FROM (
        SELECT t.traceId,
               COUNT(*) AS spanCount,
               MIN(t.startTime) AS startTime,
               MAX(t.endTime) AS endTime,
               COUNT(CASE WHEN t.statusCode = ? THEN 1 END) AS nbErrors
        FROM traces t
        JOIN roots r ON r.traceId = t.traceId
        GROUP BY t.traceId
      ) t
      JOIN roots r ON r.traceId = t.traceId
      GROUP BY r.name, r.serviceName, r.serviceVersion
      ORDER BY traceCount DESC`,
  }),
};
