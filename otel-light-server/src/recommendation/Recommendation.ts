import { Span } from "@opentelemetry/sdk-trace-base";
import axios from "axios";
import * as fs from "fs-extra";
import * as path from "path";
import * as schedule from "node-schedule";
import { Config } from "../Config";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";

const logger = OTelLogger().createModuleLogger("Recommendation");

let recommendationFilePath: string;
let config: Config;

// ── Public Interface ──────────────────────────────────────────────────────────

export async function RecommendationInit(
  context: Span,
  configIn: Config,
): Promise<void> {
  const span = OTelTracer().startSpan("RecommendationInit", context);
  config = configIn;
  recommendationFilePath = path.join(
    configIn.DATA_DIR,
    "recommendation.json",
  );
  logger.info(
    `Recommendation storage initialized at: ${recommendationFilePath}`,
  );

  if (configIn.LLM_API_KEY) {
    logger.info(
      `Scheduling LLM recommendation: ${configIn.LLM_RECOMMENDATION_SCHEDULE_CRON}`,
    );
    schedule.scheduleJob(
      configIn.LLM_RECOMMENDATION_SCHEDULE_CRON,
      () => {
        RecommendationGenerate().catch((err) =>
          logger.error(
            `Failed to generate scheduled recommendation: ${err.message}`,
          ),
        );
      },
    );
    // Generate on startup if no cached recommendation exists
    if (!(await fs.pathExists(recommendationFilePath))) {
      logger.info("No cached recommendation found, triggering initial generation");
      RecommendationGenerate().catch((err) =>
        logger.error(
          `Failed to generate initial recommendation: ${err.message}`,
        ),
      );
    }
  } else {
    logger.info("LLM not configured; recommendation feature disabled");
  }
  span.end();
}

export async function RecommendationGetCached(): Promise<{
  generatedAt: string;
  periodHours: number;
  stats: Record<string, unknown>;
  analysis: string;
  recommendations: string;
} | null> {
  try {
    if (!(await fs.pathExists(recommendationFilePath))) {
      return null;
    }
    return await fs.readJson(recommendationFilePath);
  } catch (error) {
    logger.error(
      `Failed to read cached recommendation: ${error.message}`,
    );
    return null;
  }
}

// ── Generate ──────────────────────────────────────────────────────────────────

export async function RecommendationGenerate(): Promise<void> {
  const span = OTelTracer().startSpan("RecommendationGenerate");
  try {
    const periodHours = Math.max(
      Number(config.LLM_RECOMMENDATION_PERIOD_HOURS) || 24,
      1,
    );
    const periodEnd = Date.now() * 1_000_000; // nanoseconds
    const periodStart = periodEnd - periodHours * 3_600_000 * 1_000_000;

    logger.info(
      `Collecting statistics for the last ${periodHours}h for LLM recommendation`,
      span,
    );

    // ── Collect statistics ────────────────────────────────────────────────

    const stats = await CollectStats(span, periodStart, periodEnd);

    // ── Call LLM ──────────────────────────────────────────────────────────

    const prompt = BuildPrompt(stats, periodHours);
    let analysis = "";
    let recommendations = "";

    try {
      const response = await axios.post(
        config.LLM_API_URL,
        {
          model: config.LLM_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are an observability and site-reliability expert. " +
                "Analyze the provided telemetry statistics and produce a concise report.\n\n" +
                "Output your answer in two clear sections:\n" +
                "## Analysis\n" +
                "A concise analysis (3-6 paragraphs) covering:\n" +
                "- Overall health of the system\n" +
                "- Notable patterns, anomalies, or trends\n" +
                "- Services or endpoints that stand out (positive or negative)\n" +
                "- Error rates and their potential causes\n\n" +
                "## Recommendations\n" +
                "Actionable recommendations (3-6 bullet points) prioritized by impact. " +
                "Each bullet should be specific and actionable, not generic.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.LLM_API_KEY}`,
          },
        },
      );
      const fullContent =
        response.data?.choices?.[0]?.message?.content || "";

      // Split into Analysis and Recommendations sections
      const analysisMatch = fullContent.match(
        /## Analysis\s*([\s\S]*?)(?=## Recommendations|$)/i,
      );
      const recommendationsMatch = fullContent.match(
        /## Recommendations\s*([\s\S]*)/i,
      );
      analysis = (analysisMatch?.[1] || fullContent).trim();
      recommendations = (
        recommendationsMatch?.[1] || ""
      ).trim();
    } catch (error) {
      logger.error(
        `LLM API call failed: ${error.message}`,
        error,
        span,
      );
      analysis = `LLM recommendation generation failed: ${error.message}`;
      recommendations = "";
    }

    // ── Persist result ────────────────────────────────────────────────────

    const result = {
      generatedAt: new Date().toISOString(),
      periodHours,
      stats,
      analysis,
      recommendations,
    };
    await fs.ensureDir(path.dirname(recommendationFilePath));
    await fs.writeJson(recommendationFilePath, result);
    logger.info("LLM recommendation generated and cached successfully", span);
  } catch (err) {
    logger.error(`Failed to generate recommendation: ${err.message}`, err, span);
  }
  span.end();
}

// ── Statistics Collection ─────────────────────────────────────────────────────

interface LogsStats {
  total: number;
  errors: number;
  perService: Array<{ serviceName: string; total: number; errors: number; errorRate: number }>;
  perSeverity: Array<{ severity: string; count: number }>;
}

interface TraceTypeStats {
  name: string;
  totalDurationMs: number;
  count: number;
  avgDurationMs: number;
  errorCount: number;
  perService: Array<{
    serviceName: string;
    count: number;
    totalDurationMs: number;
    avgDurationMs: number;
    errorCount: number;
  }>;
}

interface TracesStats {
  total: number;
  perService: Array<{ serviceName: string; count: number }>;
  errorCount: number;
  topByName: TraceTypeStats[];
}

interface MetricsStats {
  total: number;
  perService: Array<{ serviceName: string; count: number }>;
}

interface RecommendationStats {
  periodStart: number;
  periodEnd: number;
  services: string[];
  logs: LogsStats;
  traces: TracesStats;
  metrics: MetricsStats;
}

async function CollectStats(
  context: Span,
  periodStart: number,
  periodEnd: number,
): Promise<RecommendationStats> {
  const span = OTelTracer().startSpan("CollectStats", context);

  // ── Logs statistics ────────────────────────────────────────────────────

  const logsTotalRow = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.LOGS_TOTAL[DbUtilsGetType()],
    [periodStart, periodEnd],
  );
  const logsTotal = Number(logsTotalRow[0]?.count || 0);

  const logsErrorsRow = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.LOGS_ERRORS[DbUtilsGetType()],
    [periodStart, periodEnd],
  );
  const logsErrors = Number(logsErrorsRow[0]?.count || 0);

  const logsPerServiceRaw = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.LOGS_PER_SERVICE[DbUtilsGetType()],
    [periodStart, periodEnd],
  );
  const logsPerService: LogsStats["perService"] = [];
  const logsErrorPerServiceRaw = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.LOGS_ERRORS_PER_SERVICE[DbUtilsGetType()],
    [periodStart, periodEnd],
  );
  const errorMap: Record<string, number> = {};
  for (const row of logsErrorPerServiceRaw) {
    errorMap[row.serviceName] = Number(row.count);
  }
  for (const row of logsPerServiceRaw) {
    const total = Number(row.count);
    const errors = errorMap[row.serviceName] || 0;
    logsPerService.push({
      serviceName: row.serviceName,
      total,
      errors,
      errorRate: total > 0 ? errors / total : 0,
    });
  }

  const logsPerSeverityRaw = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.LOGS_PER_SEVERITY[DbUtilsGetType()],
    [periodStart, periodEnd],
  );
  const logsPerSeverity: LogsStats["perSeverity"] = [];
  for (const row of logsPerSeverityRaw) {
    logsPerSeverity.push({
      severity: row.severity,
      count: Number(row.count),
    });
  }

  const logsStats: LogsStats = {
    total: logsTotal,
    errors: logsErrors,
    perService: logsPerService,
    perSeverity: logsPerSeverity,
  };

  // ── Traces statistics ──────────────────────────────────────────────────

  const tracesTotalRow = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.TRACES_TOTAL[DbUtilsGetType()],
    [periodStart, periodEnd],
  );
  const tracesTotal = Number(tracesTotalRow[0]?.count || 0);

  const tracesErrorRow = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.TRACES_ERRORS[DbUtilsGetType()],
    [periodStart, periodEnd],
  );
  const tracesErrors = Number(tracesErrorRow[0]?.count || 0);

  const tracesPerServiceRaw = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.TRACES_PER_SERVICE[DbUtilsGetType()],
    [periodStart, periodEnd],
  );
  const tracesPerService: TracesStats["perService"] = [];
  for (const row of tracesPerServiceRaw) {
    tracesPerService.push({
      serviceName: row.serviceName,
      count: Number(row.count),
    });
  }

  // Top 5 trace names by cumulative duration
  const topTraceNamesRow = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.TRACES_TOP_BY_DURATION[DbUtilsGetType()],
    [periodStart, periodEnd, 5],
  );
  const topByName: TraceTypeStats[] = [];
  for (const topRow of topTraceNamesRow) {
    const name = topRow.name;
    const traceNameCount = Number(topRow.count);
    const traceNameTotalDuration = Number(topRow.totalDuration);

    // Breakdown per service for this trace name
    const breakdownRaw = await DbUtilsNoTelemetryQuerySQL(
      SQL_QUERIES.TRACES_BREAKDOWN_BY_NAME[DbUtilsGetType()],
      [periodStart, periodEnd, name],
    );

    const perService: TraceTypeStats["perService"] = [];
    for (const br of breakdownRaw) {
      const brCount = Number(br.count);
      const brTotalDuration = Number(br.totalDuration);
      perService.push({
        serviceName: br.serviceName,
        count: brCount,
        totalDurationMs: Math.round(brTotalDuration / 1_000_000),
        avgDurationMs:
          brCount > 0
            ? Math.round(brTotalDuration / brCount / 1_000_000)
            : 0,
        errorCount: Number(br.errorCount || 0),
      });
    }

    topByName.push({
      name,
      totalDurationMs: Math.round(traceNameTotalDuration / 1_000_000),
      count: traceNameCount,
      avgDurationMs:
        traceNameCount > 0
          ? Math.round(traceNameTotalDuration / traceNameCount / 1_000_000)
          : 0,
      errorCount: Number(topRow.errorCount || 0),
      perService,
    });
  }

  const tracesStats: TracesStats = {
    total: tracesTotal,
    errorCount: tracesErrors,
    perService: tracesPerService,
    topByName,
  };

  // ── Metrics statistics ─────────────────────────────────────────────────

  const metricsTotalRow = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.METRICS_TOTAL[DbUtilsGetType()],
    [periodStart, periodEnd],
  );
  const metricsTotal = Number(metricsTotalRow[0]?.count || 0);

  const metricsPerServiceRaw = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.METRICS_PER_SERVICE[DbUtilsGetType()],
    [periodStart, periodEnd],
  );
  const metricsPerService: MetricsStats["perService"] = [];
  for (const row of metricsPerServiceRaw) {
    metricsPerService.push({
      serviceName: row.serviceName,
      count: Number(row.count),
    });
  }

  const metricsStats: MetricsStats = {
    total: metricsTotal,
    perService: metricsPerService,
  };

  // ── Services ────────────────────────────────────────────────────────────

  const serviceSet = new Set<string>();
  for (const s of logsPerService) serviceSet.add(s.serviceName);
  for (const s of tracesPerService) serviceSet.add(s.serviceName);
  for (const s of metricsPerService) serviceSet.add(s.serviceName);

  span.end();

  return {
    periodStart,
    periodEnd,
    services: Array.from(serviceSet).sort(),
    logs: logsStats,
    traces: tracesStats,
    metrics: metricsStats,
  };
}

// ── Prompt Builder ────────────────────────────────────────────────────────────

function BuildPrompt(
  stats: RecommendationStats,
  periodHours: number,
): string {
  const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

  const lines: string[] = [];
  lines.push(`Telemetry statistics for the last ${periodHours} hours.\n`);

  lines.push("--- Services ---");
  lines.push(stats.services.join(", "));
  lines.push("");

  lines.push("--- Logs ---");
  lines.push(`Total logs: ${stats.logs.total}`);
  lines.push(`Error logs: ${stats.logs.errors} (${fmtPct(stats.logs.errors / Math.max(stats.logs.total, 1))})`);
  lines.push("");
  lines.push("Logs per service:");
  for (const s of stats.logs.perService) {
    lines.push(
      `  - ${s.serviceName}: ${s.total} logs, ${s.errors} errors (${fmtPct(s.errorRate)})`,
    );
  }
  lines.push("");
  lines.push("Logs per severity:");
  for (const s of stats.logs.perSeverity) {
    lines.push(`  - ${s.severity}: ${s.count}`);
  }
  lines.push("");

  lines.push("--- Traces ---");
  lines.push(`Total traces: ${stats.traces.total}`);
  lines.push(`Traces with errors: ${stats.traces.errorCount}`);
  lines.push("");
  lines.push("Traces per service:");
  for (const s of stats.traces.perService) {
    lines.push(`  - ${s.serviceName}: ${s.count}`);
  }
  lines.push("");
  lines.push("Top 5 trace types by cumulative duration:");
  for (const t of stats.traces.topByName) {
    lines.push(
      `  - ${t.name}: ${t.count} traces, ${t.totalDurationMs}ms total, ${t.avgDurationMs}ms avg, ${t.errorCount} errors`,
    );
    lines.push("    Breakdown per service:");
    for (const br of t.perService) {
      lines.push(
        `      - ${br.serviceName}: ${br.count} traces, ${br.totalDurationMs}ms total, ${br.avgDurationMs}ms avg, ${br.errorCount} errors`,
      );
    }
  }
  lines.push("");

  lines.push("--- Metrics ---");
  lines.push(`Total metric data points: ${stats.metrics.total}`);
  lines.push("Metrics per service:");
  for (const s of stats.metrics.perService) {
    lines.push(`  - ${s.serviceName}: ${s.count}`);
  }
  lines.push("");

  lines.push(
    "Based on the above data, provide your Analysis and Recommendations.",
  );

  return lines.join("\n");
}

// ── SQL Queries ───────────────────────────────────────────────────────────────

const SQL_QUERIES = {
  // Logs
  LOGS_TOTAL: {
    postgres:
      'SELECT COUNT(*) AS count FROM logs WHERE "time" >= $1 AND "time" < $2',
    sqlite:
      "SELECT COUNT(*) AS count FROM logs WHERE time >= ? AND time < ?",
  },
  LOGS_ERRORS: {
    postgres:
      'SELECT COUNT(*) AS count FROM logs WHERE "time" >= $1 AND "time" < $2 AND LOWER("severity") = \'error\'',
    sqlite:
      "SELECT COUNT(*) AS count FROM logs WHERE time >= ? AND time < ? AND LOWER(severity) = 'error'",
  },
  LOGS_PER_SERVICE: {
    postgres:
      'SELECT "serviceName", COUNT(*) AS count FROM logs WHERE "time" >= $1 AND "time" < $2 GROUP BY "serviceName" ORDER BY count DESC',
    sqlite:
      "SELECT serviceName, COUNT(*) AS count FROM logs WHERE time >= ? AND time < ? GROUP BY serviceName ORDER BY count DESC",
  },
  LOGS_ERRORS_PER_SERVICE: {
    postgres:
      'SELECT "serviceName", COUNT(*) AS count FROM logs WHERE "time" >= $1 AND "time" < $2 AND LOWER("severity") = \'error\' GROUP BY "serviceName" ORDER BY count DESC',
    sqlite:
      "SELECT serviceName, COUNT(*) AS count FROM logs WHERE time >= ? AND time < ? AND LOWER(severity) = 'error' GROUP BY serviceName ORDER BY count DESC",
  },
  LOGS_PER_SEVERITY: {
    postgres:
      'SELECT "severity", COUNT(*) AS count FROM logs WHERE "time" >= $1 AND "time" < $2 GROUP BY "severity" ORDER BY count DESC',
    sqlite:
      "SELECT severity, COUNT(*) AS count FROM logs WHERE time >= ? AND time < ? GROUP BY severity ORDER BY count DESC",
  },
  // Traces
  TRACES_TOTAL: {
    postgres:
      'SELECT COUNT(DISTINCT "traceId") AS count FROM traces WHERE "startTime" >= $1 AND "startTime" < $2',
    sqlite:
      "SELECT COUNT(DISTINCT traceId) AS count FROM traces WHERE startTime >= ? AND startTime < ?",
  },
  TRACES_ERRORS: {
    postgres:
      'SELECT COUNT(DISTINCT "traceId") AS count FROM traces WHERE "startTime" >= $1 AND "startTime" < $2 AND "statusCode" = 2',
    sqlite:
      "SELECT COUNT(DISTINCT traceId) AS count FROM traces WHERE startTime >= ? AND startTime < ? AND statusCode = 2",
  },
  TRACES_PER_SERVICE: {
    postgres:
      'SELECT "serviceName", COUNT(DISTINCT "traceId") AS count FROM traces WHERE "startTime" >= $1 AND "startTime" < $2 GROUP BY "serviceName" ORDER BY count DESC',
    sqlite:
      "SELECT serviceName, COUNT(DISTINCT traceId) AS count FROM traces WHERE startTime >= ? AND startTime < ? GROUP BY serviceName ORDER BY count DESC",
  },
  TRACES_TOP_BY_DURATION: {
    postgres: `
      SELECT "name",
             COUNT(DISTINCT "traceId") AS count,
             SUM("endTime" - "startTime") AS "totalDuration",
             COUNT(CASE WHEN "statusCode" = 2 THEN 1 END) AS "errorCount"
      FROM traces
      WHERE "startTime" >= $1 AND "startTime" < $2 AND "parentSpanId" IS NULL
      GROUP BY "name"
      ORDER BY "totalDuration" DESC
      LIMIT $3`,
    sqlite: `
      SELECT name,
             COUNT(DISTINCT traceId) AS count,
             SUM(endTime - startTime) AS totalDuration,
             COUNT(CASE WHEN statusCode = 2 THEN 1 END) AS errorCount
      FROM traces
      WHERE startTime >= ? AND startTime < ? AND parentSpanId IS NULL
      GROUP BY name
      ORDER BY totalDuration DESC
      LIMIT ?`,
  },
  TRACES_BREAKDOWN_BY_NAME: {
    postgres: `
      SELECT "serviceName",
             COUNT(DISTINCT "traceId") AS count,
             SUM("endTime" - "startTime") AS "totalDuration",
             COUNT(CASE WHEN "statusCode" = 2 THEN 1 END) AS "errorCount"
      FROM traces
      WHERE "startTime" >= $1 AND "startTime" < $2 AND "name" = $3
      GROUP BY "serviceName"
      ORDER BY "totalDuration" DESC`,
    sqlite: `
      SELECT serviceName,
             COUNT(DISTINCT traceId) AS count,
             SUM(endTime - startTime) AS totalDuration,
             COUNT(CASE WHEN statusCode = 2 THEN 1 END) AS errorCount
      FROM traces
      WHERE startTime >= ? AND startTime < ? AND name = ?
      GROUP BY serviceName
      ORDER BY totalDuration DESC`,
  },
  // Metrics
  METRICS_TOTAL: {
    postgres:
      'SELECT COUNT(*) AS count FROM metrics WHERE "time" >= $1 AND "time" < $2',
    sqlite:
      "SELECT COUNT(*) AS count FROM metrics WHERE time >= ? AND time < ?",
  },
  METRICS_PER_SERVICE: {
    postgres:
      'SELECT "serviceName", COUNT(*) AS count FROM metrics WHERE "time" >= $1 AND "time" < $2 GROUP BY "serviceName" ORDER BY count DESC',
    sqlite:
      "SELECT serviceName, COUNT(*) AS count FROM metrics WHERE time >= ? AND time < ? GROUP BY serviceName ORDER BY count DESC",
  },
};
