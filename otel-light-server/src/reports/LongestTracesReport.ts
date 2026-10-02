import { Span } from "@opentelemetry/sdk-trace-base";
import * as fse from "fs-extra";
import * as path from "path";
import * as schedule from "node-schedule";
import { Config } from "../Config";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import { TraceGroupReport, TraceGroupSeries } from "./TraceGroupReportTypes";

const logger = OTelLogger().createModuleLogger("LongestTracesReport");

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

  const cronExpr = configIn.STATIC_REPORT_SCHEDULE_CRON;
  logger.info(`Scheduling longest traces report: ${cronExpr}`);
  schedule.scheduleJob(cronExpr, () => {
    LongestTracesReportGenerate().catch((err) =>
      logger.error(
        `Failed to generate scheduled longest traces report: ${err.message}`,
      ),
    );
  });

  const cached = await LongestTracesReportGetCached();
  if (!cached) {
    const delayMinutes = Math.max(
      Number(configIn.LONGEST_TRACES_STARTUP_DELAY_MINUTES) || 0,
      0,
    );
    logger.info(
      `No cached longest traces report found, scheduling initial generation in ${delayMinutes} minute(s)`,
    );
    setTimeout(
      () =>
        LongestTracesReportGenerate().catch((err) =>
          logger.error(
            `Failed to generate initial longest traces report: ${err.message}`,
          ),
        ),
      delayMinutes * 60 * 1000,
    ).unref();
  }
  span.end();
}

export async function LongestTracesReportGetCached(): Promise<TraceGroupReport | null> {
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
    const bucketNs = 86_400_000_000_000; // 1 day in nanoseconds

    const dbType = DbUtilsGetType();
    const q = (ident: string) => (dbType === "postgres" ? `"${ident}"` : ident);

    // Step 1: find top N groups by max duration over the full period
    const topGroups = await DbUtilsNoTelemetryQuerySQL(
      SQL_QUERIES.TOP_GROUPS_BY_DURATION(q, topN, periodDays, dbType),
    );

    if (!topGroups || topGroups.length === 0) {
      const emptyReport: TraceGroupReport = {
        generatedAt: new Date().toISOString(),
        periodDays,
        topN,
        bucketNs,
        series: [],
      };
      await fse.ensureDir(path.dirname(reportFilePath));
      await fse.writeJson(reportFilePath, emptyReport);
      logger.info("Longest traces report generated: 0 groups", span);
      span.end();
      return;
    }

    // Step 2: get daily time series for each top group using a CTE
    const groupFilters = buildGroupFilterCTE(topGroups);
    const rawTimeSeries = await DbUtilsNoTelemetryQuerySQL(
      SQL_QUERIES.GROUP_TIME_SERIES_DURATION(
        q,
        bucketNs,
        periodDays,
        groupFilters.cte,
        dbType,
      ),
      groupFilters.params,
    );

    // Step 3: assemble the report
    const seriesMap = new Map<string, TraceGroupSeries>();
    for (const row of rawTimeSeries) {
      const key = `${row.serviceName}::${row.name}`;
      if (!seriesMap.has(key)) {
        seriesMap.set(key, {
          serviceName: row.serviceName,
          name: row.name,
          dataPoints: [],
        });
      }
      seriesMap.get(key).dataPoints.push({
        bucket: Number(row.bucket),
        value: Number(row.value),
      });
    }

    // Sort data points by bucket and keep only the top N groups
    const reportSeries: TraceGroupSeries[] = [];
    for (const group of topGroups) {
      const key = `${group.serviceName}::${group.name}`;
      const series = seriesMap.get(key);
      if (series) {
        series.dataPoints.sort((a, b) => a.bucket - b.bucket);
        reportSeries.push(series);
      }
    }

    const report: TraceGroupReport = {
      generatedAt: new Date().toISOString(),
      periodDays,
      topN,
      bucketNs,
      series: reportSeries,
    };

    await fse.ensureDir(path.dirname(reportFilePath));
    await fse.writeJson(reportFilePath, report);

    logger.info(
      `Longest traces report generated: ${reportSeries.length} groups (top ${topN}, last ${periodDays} days)`,
      span,
    );
  } catch (err) {
    span.setStatus({ code: 2, message: err.message });
    logger.error("Error generating longest traces report", err, span);
  }
  span.end();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Group filters are passed as bound parameters (values originate from
// telemetry and must never be interpolated into the SQL text).
function buildGroupFilterCTE(topGroups: { serviceName: string; name: string }[]): {
  cte: string;
  params: string[];
} {
  if (topGroups.length === 0) {
    return { cte: "SELECT NULL AS svc, NULL AS nm WHERE 1=0", params: [] };
  }

  const dbType = DbUtilsGetType();
  const params: string[] = [];
  const rows = topGroups.map((g, i) => {
    params.push(g.serviceName, g.name);
    if (dbType === "postgres") {
      return `SELECT $${i * 2 + 1} AS svc, $${i * 2 + 2} AS nm`;
    }
    return "SELECT ? AS svc, ? AS nm";
  });
  return { cte: rows.join(" UNION ALL "), params };
}

// ── SQL ────────────────────────────────────────────────────────────────────────

const SQL_QUERIES = {
  TOP_GROUPS_BY_DURATION: (
    q: (ident: string) => string,
    _topN: number,
    _periodDays: number,
    dbType: string,
  ) => {
    const fromExpr = `CAST( (CAST( (strftime('%s','now') * 1000) AS INTEGER) - ${_periodDays * 24 * 60 * 60 * 1000}) * 1000000 AS INTEGER)`;
    const fromPostgres = `(EXTRACT(EPOCH FROM NOW()) * 1000 - ${_periodDays * 24 * 60 * 60 * 1000}) * 1000000`;

    if (dbType === "postgres") {
      return `
      WITH grp AS (
        SELECT ${q("serviceName")}, ${q("name")},
               MAX(${q("endTime")} - ${q("startTime")}) AS metric
        FROM traces
        WHERE ${q("parentSpanId")} IS NULL
          AND ${q("startTime")} >= ${fromPostgres}
        GROUP BY ${q("serviceName")}, ${q("name")}
      )
      SELECT g.${q("serviceName")}, g.${q("name")}, g.metric
      FROM grp g
      ORDER BY g.metric DESC
      LIMIT ${_topN}`;
    }

    return `
    WITH grp AS (
      SELECT serviceName, name,
             MAX(endTime - startTime) AS metric
      FROM traces
      WHERE parentSpanId IS NULL
        AND startTime >= ${fromExpr}
      GROUP BY serviceName, name
    )
    SELECT g.serviceName, g.name, g.metric
    FROM grp g
    ORDER BY g.metric DESC
    LIMIT ${_topN}`;
  },

  GROUP_TIME_SERIES_DURATION: (
    q: (ident: string) => string,
    _bucketNs: number,
    _periodDays: number,
    groupFilterCTE: string,
    dbType: string,
  ) => {
    const fromExpr = `CAST( (CAST( (strftime('%s','now') * 1000) AS INTEGER) - ${_periodDays * 24 * 60 * 60 * 1000}) * 1000000 AS INTEGER)`;
    const fromPostgres = `(EXTRACT(EPOCH FROM NOW()) * 1000 - ${_periodDays * 24 * 60 * 60 * 1000}) * 1000000`;

    if (dbType === "postgres") {
      return `
      WITH target_groups AS (${groupFilterCTE})
      SELECT t.${q("serviceName")}, t.${q("name")},
             (FLOOR(t.${q("startTime")}::decimal / ${_bucketNs}) * ${_bucketNs})::bigint AS bucket,
             MAX(t.${q("endTime")} - t.${q("startTime")}) / 1000000000 AS value
      FROM traces t
        JOIN target_groups g
          ON g.svc = t.${q("serviceName")}
          AND g.nm = t.${q("name")}
      WHERE t.${q("parentSpanId")} IS NULL
        AND t.${q("startTime")} >= ${fromPostgres}
      GROUP BY t.${q("serviceName")}, t.${q("name")}, bucket
      ORDER BY t.${q("serviceName")}, t.${q("name")}, bucket`;
    }

    return `
    WITH target_groups AS (${groupFilterCTE})
    SELECT t.serviceName, t.name,
           (CAST(t.startTime / ${_bucketNs} AS INTEGER) * ${_bucketNs}) AS bucket,
           MAX(t.endTime - t.startTime) / 1000000000 AS value
    FROM traces t
      JOIN target_groups g
        ON g.svc = t.serviceName
        AND g.nm = t.name
    WHERE t.parentSpanId IS NULL
      AND t.startTime >= ${fromExpr}
    GROUP BY t.serviceName, t.name, bucket
    ORDER BY t.serviceName, t.name, bucket`;
  },
};
