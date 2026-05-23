import { Span } from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode } from "@opentelemetry/api";
import * as fse from "fs-extra";
import * as path from "path";
import * as schedule from "node-schedule";
import { Config } from "../Config";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import { AnalyticsUtilsGetSQLVariable } from "./AnalyticsUtils";

const logger = OTelLogger().createModuleLogger("LongestTracesReport");

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LongestTraceReportEntry {
  traceId: string;
  name: string;
  serviceName: string;
  serviceVersion: string;
  startTime: number;
  endTime: number;
  spanCount: number;
  nbErrors: number;
  duration: number;
}

export interface LongestTraceReport {
  generatedAt: string;
  periodDays: number;
  topN: number;
  fromTime: number;
  toTime: number;
  traces: LongestTraceReportEntry[];
}

// ── Module state ───────────────────────────────────────────────────────────────

let reportFilePath: string;
let config: Config;

// ── Public Interface ───────────────────────────────────────────────────────────

export async function LongestTracesReportInit(
  context: Span,
  configIn: Config,
): Promise<void> {
  const span = OTelTracer().startSpan("LongestTracesReportInit", context);
  config = configIn;
  reportFilePath = path.join(
    configIn.DATA_DIR,
    "cache",
    "longestTracesReport.json",
  );

  logger.info(
    `Longest traces report storage initialized at: ${reportFilePath}`,
  );

  // Schedule daily generation
  const cronExpr = configIn.STATIC_REPORT_SCHEDULE_CRON;
  logger.info(`Scheduling longest traces report: ${cronExpr}`);
  schedule.scheduleJob(cronExpr, () => {
    LongestTracesReportGenerate().catch((err) =>
      logger.error(
        `Failed to generate scheduled longest traces report: ${err.message}`,
      ),
    );
  });

  // Generate on startup if no cached report exists
  const cached = await LongestTracesReportGetCached();
  if (!cached) {
    logger.info(
      "No cached longest traces report found, triggering initial generation",
    );
    LongestTracesReportGenerate().catch((err) =>
      logger.error(
        `Failed to generate initial longest traces report: ${err.message}`,
      ),
    );
  }

  span.end();
}

export async function LongestTracesReportGetCached(): Promise<LongestTraceReport | null> {
  try {
    if (!(await fse.pathExists(reportFilePath))) {
      return null;
    }
    return await fse.readJson(reportFilePath);
  } catch (error) {
    logger.error(
      `Failed to read cached longest traces report: ${error.message}`,
    );
    return null;
  }
}

export async function LongestTracesReportGenerate(): Promise<void> {
  const span = OTelTracer().startSpan("LongestTracesReportGenerate");
  try {
    logger.info("Generating longest traces report", span);

    const topN = config.STATIC_REPORT_TOP_N;
    const periodDays = config.STATIC_REPORT_PERIOD_DAYS;
    const nowNs = Date.now() * 1_000_000;
    const toTime = nowNs;
    const fromTime = nowNs - periodDays * 24 * 60 * 60 * 1_000_000_000;

    const dbType = DbUtilsGetType();
    const q = (ident: string) => (dbType === "postgres" ? `"${ident}"` : ident);
    const statusCodeVarIdx = 1;

    // Query: find the top N traces by duration within the period
    const rawRows = await DbUtilsNoTelemetryQuerySQL(
      SQL_QUERIES.GET_LONGEST_TRACES(
        q,
        topN,
        periodDays,
        statusCodeVarIdx,
        dbType,
      ),
      [SpanStatusCode.ERROR],
    );

    const traces: LongestTraceReportEntry[] = rawRows.map((row) => ({
      traceId: row.traceId,
      name: row.name,
      serviceName: row.serviceName,
      serviceVersion: row.serviceVersion ?? "",
      startTime: Number(row.startTime),
      endTime: Number(row.endTime),
      spanCount: Number(row.spanCount),
      nbErrors: Number(row.nbErrors),
      duration: Number(row.duration),
    }));

    const report: LongestTraceReport = {
      generatedAt: new Date().toISOString(),
      periodDays,
      topN,
      fromTime,
      toTime,
      traces,
    };

    await fse.ensureDir(path.dirname(reportFilePath));
    await fse.writeJson(reportFilePath, report);

    logger.info(
      `Longest traces report generated: ${traces.length} traces (top ${topN}, last ${periodDays} days)`,
      span,
    );
  } catch (err) {
    span.setStatus({ code: 2, message: err.message });
    logger.error("Error generating longest traces report", err, span);
  }
  span.end();
}

// ── SQL ────────────────────────────────────────────────────────────────────────

const SQL_QUERIES = {
  GET_LONGEST_TRACES: (
    q: (ident: string) => string,
    _topN: number,
    _periodDays: number,
    statusCodeVarIdx: number,
    dbType: string,
  ) => {
    // Use nanoseconds.  The time window is: now - periodDays in nanoseconds.
    const fromExpr = `CAST( (CAST( (strftime('%s','now') * 1000) AS INTEGER) - ${_periodDays * 24 * 60 * 60 * 1000}) * 1000000 AS INTEGER)`;
    const fromPostgres = `(EXTRACT(EPOCH FROM NOW()) * 1000 - ${_periodDays * 24 * 60 * 60 * 1000}) * 1000000`;
    const stsCodePg = `${AnalyticsUtilsGetSQLVariable("postgres", statusCodeVarIdx)}`;
    const stsCodeLite = `${AnalyticsUtilsGetSQLVariable("sqlite", statusCodeVarIdx)}`;

    return dbType === "postgres"
      ? `
      WITH roots AS (
        SELECT ${q("traceId")}, ${q("name")}, ${q("serviceName")}, ${q("serviceVersion")}, ${q("startTime")}, ${q("endTime")}
        FROM traces
        WHERE ${q("parentSpanId")} IS NULL
          AND ${q("startTime")} >= ${fromPostgres}
        ORDER BY (${q("endTime")} - ${q("startTime")}) DESC
        LIMIT ${_topN}
      )
      SELECT r.${q("traceId")},
             r.${q("name")},
             r.${q("serviceName")},
             r.${q("serviceVersion")},
             r.${q("startTime")},
             r.${q("endTime")},
             COUNT(*)::int AS ${q("spanCount")},
             COUNT(CASE WHEN t.${q("statusCode")} = ${stsCodePg} THEN 1 END)::int AS ${q("nbErrors")},
             (r.${q("endTime")} - r.${q("startTime")}) AS duration
      FROM traces t
        JOIN roots r ON r.${q("traceId")} = t.${q("traceId")}
      GROUP BY r.${q("traceId")}, r.${q("name")}, r.${q("serviceName")}, r.${q("serviceVersion")}, r.${q("startTime")}, r.${q("endTime")}
      ORDER BY duration DESC`
      : `
      WITH roots AS (
        SELECT traceId, name, serviceName, serviceVersion, startTime, endTime
        FROM traces
        WHERE parentSpanId IS NULL
          AND startTime >= ${fromExpr}
        ORDER BY (endTime - startTime) DESC
        LIMIT ${_topN}
      )
      SELECT r.traceId,
             r.name,
             r.serviceName,
             r.serviceVersion,
             r.startTime,
             r.endTime,
             COUNT(*) AS spanCount,
             COUNT(CASE WHEN t.statusCode = ${stsCodeLite} THEN 1 END) AS nbErrors,
             (r.endTime - r.startTime) AS duration
      FROM traces t
        JOIN roots r ON r.traceId = t.traceId
      GROUP BY r.traceId, r.name, r.serviceName, r.serviceVersion, r.startTime, r.endTime
      ORDER BY duration DESC`;
  },
};
