import { FastifyInstance } from "fastify";
import { AuthHasScope } from "@devopsplaybook.io/common-utils";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  AnalyticsUtilsCompressJson,
  AnalyticsUtilsGetDefaultFromTime24h,
  AnalyticsUtilsGetSQLVariable,
  AnalyticsUtilsGetTimeParam,
} from "./AnalyticsUtils";
import {
  AnalyticsStatsCacheBuildKey,
  AnalyticsStatsCacheGet,
  AnalyticsStatsCacheSet,
  AnalyticsStatsGetSampleCap,
} from "./AnalyticsStatsCache";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";

const DEFAULT_LOGS_STATS_BUCKET_NS = 3600 * 1_000_000_000;
const MINUTE_NS = 60 * 1_000_000_000;

// Minute-rounded windows keep repeated dashboard loads (a moving `from`) on
// the same deterministic SQL and on the same cache entry.
function roundTimeDownToMinute(
  value: string | number | undefined,
): string | number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return value;
  }
  return Math.floor(value / MINUTE_NS) * MINUTE_NS;
}

function roundTimeUpToMinute(
  value: string | number | undefined,
): string | number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return value;
  }
  return Math.ceil(value / MINUTE_NS) * MINUTE_NS;
}

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
        keywords?: string;
        severity?: string;
        serviceName?: string;
        serviceVersion?: string;
        bucketNs?: number;
      };
    }>("/logs/stats", async (req, res) => {
      try {
        await AuthHasScope(req, res, "logs");
      } catch {
        return;
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
        sqlParams.push(AnalyticsUtilsGetTimeParam(req.query.from));
      }
      if (req.query.to) {
        appendWhere(
          "time <= " +
            AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1),
        );
        sqlParams.push(AnalyticsUtilsGetTimeParam(req.query.to));
      }
      if (req.query.keywords?.trim()) {
        appendWhere(
          "keywords LIKE " +
            AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1),
        );
        sqlParams.push(`%${req.query.keywords.toLowerCase().trim()}%`);
      }
      if (req.query.severity?.trim()) {
        appendWhere(
          "severity = " +
            AnalyticsUtilsGetSQLVariable(dbType, sqlParams.length + 1),
        );
        sqlParams.push(req.query.severity.toLowerCase().trim());
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
      const bucketNsRaw = Number(req.query.bucketNs);
      const bucketNs =
        Number.isFinite(bucketNsRaw) && bucketNsRaw > 0
          ? bucketNsRaw
          : DEFAULT_LOGS_STATS_BUCKET_NS;

      // The bucket size parameter is referenced exactly once (the query
      // returns the bucket *index*; the NS timestamp is computed below).
      // SQLite binds `?` by textual position: the bucket placeholder sits in
      // the SELECT list, before the WHERE placeholders, so it must be bound
      // first. Postgres uses an explicit `$N` index and appends instead.
      const bucketParamIdx = sqlParams.length + 1;
      const statsParams =
        dbType === "sqlite"
          ? [bucketNs, ...sqlParams]
          : [...sqlParams, bucketNs];

      const rawRows = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.LOGS_STATS(sqlWhere, bucketParamIdx)[dbType],
        statsParams,
      );

      // Build response: buckets array + severity counts
      const severityCounts: Record<string, number> = {};
      const bucketMap: Record<number, Record<string, number>> = {};
      let totalCount = 0;

      for (const row of rawRows) {
        const sev = (row.severity || "UNKNOWN").toUpperCase();
        const bucket = Number(row.bucketIdx) * bucketNs;
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
        includePercentiles?: string;
      };
    }>("/traces/stats", async (req, res) => {
      try {
        await AuthHasScope(req, res, "traces");
      } catch {
        return;
      }

      const dbType = DbUtilsGetType();
      // Quote an identifier for the target DB: PostgreSQL needs double-quotes
      // to preserve camelCase column names created with quoted identifiers.
      const q = (ident: string) =>
        dbType === "postgres" ? `"${ident}"` : ident;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rootsParams: any[] = [];
      let rootsWhere = `${q("parentSpanId")} IS NULL`;

      const includePercentiles = !["false", "0", "no"].includes(
        String(req.query.includePercentiles ?? "true")
          .trim()
          .toLowerCase(),
      );
      const serviceName = String(req.query.serviceName ?? "").trim();
      const serviceVersion = String(req.query.serviceVersion ?? "").trim();

      // Default window: bound the aggregation scan unless the caller asked
      // for an explicit range (the web UI always sends `from`). Windows are
      // rounded to whole minutes so repeated loads are deterministic and
      // share a cache entry.
      const fromTime = roundTimeDownToMinute(
        AnalyticsUtilsGetTimeParam(
          req.query.from || AnalyticsUtilsGetDefaultFromTime24h(),
        ),
      );
      const toTime = req.query.to
        ? roundTimeUpToMinute(
            AnalyticsUtilsGetTimeParam(req.query.to),
          )
        : undefined;

      const cacheKey = AnalyticsStatsCacheBuildKey(
        fromTime,
        toTime,
        serviceName || undefined,
        serviceVersion || undefined,
        includePercentiles,
      );
      const cached = AnalyticsStatsCacheGet(cacheKey);
      if (cached) {
        return res.status(200).send(cached);
      }

      rootsWhere +=
        ` AND ${q("startTime")} >= ` +
        AnalyticsUtilsGetSQLVariable(dbType, rootsParams.length + 1);
      rootsParams.push(fromTime);

      if (toTime !== undefined) {
        rootsWhere +=
          ` AND ${q("startTime")} <= ` +
          AnalyticsUtilsGetSQLVariable(dbType, rootsParams.length + 1);
        rootsParams.push(toTime);
      }
      if (serviceName) {
        rootsWhere +=
          ` AND ${q("serviceName")} = ` +
          AnalyticsUtilsGetSQLVariable(dbType, rootsParams.length + 1);
        rootsParams.push(serviceName);
      }
      if (serviceVersion) {
        rootsWhere +=
          ` AND ${q("serviceVersion")} = ` +
          AnalyticsUtilsGetSQLVariable(dbType, rootsParams.length + 1);
        rootsParams.push(serviceVersion);
      }

      const statusCodeVarIdx = rootsParams.length + 1;
      const allParams = [...rootsParams, SpanStatusCode.ERROR];

      const rawRows = await DbUtilsNoTelemetryQuerySQL(
        SQL_QUERIES.TRACES_STATS(rootsWhere, statusCodeVarIdx)[dbType],
        allParams,
      );

      // Deterministic, bounded stride sample of full-trace durations (same
      // measure as avgDuration) for the percentiles, grouped like the web
      // client does: serviceName||serviceVersion||name. Values stay in ns.
      // The stride is derived from the exact trace count, so identical
      // requests always return identical percentiles and the sample never
      // exceeds ANALYTICS_STATS_SAMPLE_CAP.
      const sampleDurations: Record<string, number[]> = {};
      const totalTraces = rawRows.reduce(
        (sum: number, row: { traceCount: number }) =>
          sum + Number(row.traceCount || 0),
        0,
      );
      if (includePercentiles && totalTraces > 0) {
        const stride = Math.max(
          1,
          Math.ceil(totalTraces / AnalyticsStatsGetSampleCap()),
        );
        const sampleRows = await DbUtilsNoTelemetryQuerySQL(
          SQL_QUERIES.TRACES_DURATION_SAMPLE(
            rootsWhere,
            rootsParams.length + 1,
          )[dbType],
          [...rootsParams, stride],
        );
        for (const row of sampleRows) {
          const key = [row.serviceName || "", row.serviceVersion || "", row.name || ""].join("||");
          if (!sampleDurations[key]) sampleDurations[key] = [];
          sampleDurations[key].push(Number(row.duration));
        }
      }
      const percentileOf = (
        durations: number[],
        pct: number,
        fallback: number,
      ): number => {
        if (durations.length === 0) return fallback;
        const sorted = [...durations].sort((a, b) => a - b);
        const idx = Math.ceil((pct / 100) * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
      };

      // Build grouped trace stats
      const groups = rawRows.map((row) => {
        const avgDuration = Number(row.avgDuration);
        const key = [row.serviceName || "", row.serviceVersion || "", row.name || ""].join("||");
        const durations = sampleDurations[key] || [];
        const group = {
          serviceName: row.serviceName,
          serviceVersion: row.serviceVersion,
          name: row.name,
          traceCount: Number(row.traceCount),
          avgSpanCount: Number(row.avgSpanCount),
          nbErrors: Number(row.nbErrors),
          avgDuration,
        };
        if (includePercentiles) {
          return {
            ...group,
            p90: percentileOf(durations, 90, avgDuration),
            p95: percentileOf(durations, 95, avgDuration),
          };
        }
        return group;
      });

      const payload = {
        groups: await AnalyticsUtilsCompressJson(groups, "gzip"),
        compressed: true,
      };
      AnalyticsStatsCacheSet(cacheKey, payload);
      return res.status(200).send(payload);
    });
  }
}

// SQL

const SQL_QUERIES = {
  LOGS_STATS: (sqlWhere: string, bucketParamIdx: number) => ({
    postgres: `
      SELECT "severity",
             FLOOR("time"::decimal / $${bucketParamIdx})::bigint AS "bucketIdx",
             COUNT(*)::int AS cnt
      FROM logs${sqlWhere}
      GROUP BY "severity", "bucketIdx"
      ORDER BY "bucketIdx"`,
    sqlite: `
      SELECT severity,
             CAST(time / ? AS INTEGER) AS bucketIdx,
             COUNT(*) AS cnt
      FROM logs${sqlWhere}
      GROUP BY severity, bucketIdx
      ORDER BY bucketIdx`,
  }),
  // Deterministic stride sample of per-trace durations (MAX(endTime) −
  // MIN(startTime), the same measure as avgDuration) reused for the P90/P95
  // percentiles. Rows are ranked on stable keys and every `stride`-th one is
  // kept: bounded work, identical results for identical requests (no RANDOM),
  // and at most `cap` rows because stride = ceil(traceCount / cap). The stride
  // placeholder is the last bound parameter (after rootsWhere).
  TRACES_DURATION_SAMPLE: (rootsWhere: string, strideParamIdx: number) => ({
    postgres: `
      WITH roots AS (
        SELECT "traceId", "name", "serviceName", "serviceVersion"
        FROM traces
        WHERE ${rootsWhere}
      ),
      trace_durations AS (
        SELECT t."traceId",
               MIN(t."startTime") AS "startTime",
               MAX(t."endTime") AS "endTime"
        FROM traces t
        JOIN roots r ON r."traceId" = t."traceId"
        GROUP BY t."traceId"
      ),
      ranked AS (
        SELECT d."startTime",
               d."endTime",
               r."name",
               r."serviceName",
               r."serviceVersion",
               ROW_NUMBER() OVER (
                 ORDER BY d."startTime", d."traceId", r."serviceName", r."name"
               ) AS rn
        FROM trace_durations d
        JOIN roots r ON r."traceId" = d."traceId"
      )
      SELECT "name",
             "serviceName",
             "serviceVersion",
             ("endTime" - "startTime") AS "duration"
      FROM ranked
      WHERE (rn - 1) % $${strideParamIdx} = 0`,
    sqlite: `
      WITH roots AS (
        SELECT traceId, name, serviceName, serviceVersion
        FROM traces
        WHERE ${rootsWhere}
      ),
      trace_durations AS (
        SELECT t.traceId,
               MIN(t.startTime) AS startTime,
               MAX(t.endTime) AS endTime
        FROM traces t
        JOIN roots r ON r.traceId = t.traceId
        GROUP BY t.traceId
      ),
      ranked AS (
        SELECT d.startTime,
               d.endTime,
               r.name,
               r.serviceName,
               r.serviceVersion,
               ROW_NUMBER() OVER (
                 ORDER BY d.startTime, d.traceId, r.serviceName, r.name
               ) AS rn
        FROM trace_durations d
        JOIN roots r ON r.traceId = d.traceId
      )
      SELECT name,
             serviceName,
             serviceVersion,
             (endTime - startTime) AS duration
      FROM ranked
      WHERE (rn - 1) % ? = 0`,
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
