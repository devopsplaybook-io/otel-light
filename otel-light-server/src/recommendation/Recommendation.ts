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
  recommendationFilePath = path.join(configIn.DATA_DIR, "recommendation.json");
  logger.info(
    `Recommendation storage initialized at: ${recommendationFilePath}`,
  );

  if (configIn.LLM_API_KEY) {
    logger.info(
      `Scheduling LLM recommendation: ${configIn.LLM_RECOMMENDATION_SCHEDULE_CRON}`,
    );
    schedule.scheduleJob(configIn.LLM_RECOMMENDATION_SCHEDULE_CRON, () => {
      RecommendationGenerate().catch((err) =>
        logger.error(
          `Failed to generate scheduled recommendation: ${err.message}`,
        ),
      );
    });
    // Generate on startup if no cached recommendation exists
    const cached = await RecommendationGetCached();
    if (!cached) {
      logger.info(
        "No valid cached recommendation found, triggering initial generation",
      );
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
    logger.error(`Failed to read cached recommendation: ${error.message}`);
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
    // Use BigInt to avoid precision loss for large periodHours
    const periodEndNs = BigInt(Date.now()) * 1_000_000n;
    const periodStartNs =
      periodEndNs - BigInt(periodHours) * BigInt(3_600_000) * 1_000_000n;
    const periodEnd = Number(periodEndNs);
    const periodStart = Number(periodStartNs);

    logger.info(
      `Collecting statistics for the last ${periodHours}h for LLM recommendation`,
      span,
    );

    // ── Collect statistics ────────────────────────────────────────────────

    const stats = await CollectStats(span, periodStart, periodEnd, periodHours);

    // ── Call LLM ──────────────────────────────────────────────────────────

    const prompt = BuildPrompt(stats, periodHours);
    let analysis = "";
    let recommendations = "";

    try {
      const llmResponse = await callLLMWithRetry(prompt);
      const fullContent = llmResponse || "";

      // Validate response has meaningful content
      if (!fullContent || fullContent.trim().length < 20) {
        logger.warn("LLM returned empty or very short response");
        analysis =
          "LLM returned an empty response. Please check API configuration.";
        recommendations = "";
      } else {
        // Split into Analysis and Recommendations sections (start-of-line anchored)
        const analysisMatch = fullContent.match(
          /^## Analysis\s*\n([\s\S]*?)(?=\n^## Recommendations|\n?$)/im,
        );
        const recommendationsMatch = fullContent.match(
          /^## Recommendations\s*\n([\s\S]*)/im,
        );
        analysis = (analysisMatch?.[1] || fullContent).trim();
        recommendations = (recommendationsMatch?.[1] || "").trim();

        // Fallback: if both sections failed to parse, include the full response as analysis
        if (!analysis && !recommendations) {
          analysis = fullContent.trim();
        }
      }
    } catch (error) {
      logger.error(`LLM API call failed: ${error.message}`, error, span);
      analysis = `LLM recommendation generation failed: ${error.message}`;
      recommendations = "";
    }

    // ── Persist result ────────────────────────────────────────────────────

    // Strip raw nanosecond timestamps from the stats exposed to clients;
    // keep them internally for future delta comparisons.
    const clientStats = {
      periodHours: stats.periodHours,
      services: stats.services,
      logs: stats.logs,
      traces: stats.traces,
      previousPeriod: stats.previousPeriod,
    };

    const result = {
      generatedAt: new Date().toISOString(),
      periodHours,
      stats: clientStats,
      analysis,
      recommendations,
    };
    await fs.ensureDir(path.dirname(recommendationFilePath));
    await fs.writeJson(recommendationFilePath, result);
    logger.info("LLM recommendation generated and cached successfully", span);
  } catch (err) {
    logger.error(
      `Failed to generate recommendation: ${err.message}`,
      err,
      span,
    );
  }
  span.end();
}

// ── LLM API call with retry ───────────────────────────────────────────────────

async function callLLMWithRetry(
  prompt: string,
  maxRetries = 3,
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.post(
        config.LLM_API_URL,
        {
          model: config.LLM_MODEL,
          temperature: 0.3,
          max_tokens: 2000,
          messages: [
            {
              role: "system",
              content:
                "You are an observability and site-reliability expert. " +
                "Analyze the provided OpenTelemetry telemetry statistics and produce a concise report.\n\n" +
                "Context:\n" +
                "- All durations are in milliseconds (ms).\n" +
                "- Trace status codes: 0 = UNSET, 1 = OK, 2 = ERROR.\n" +
                "- Logs with severity='error' indicate failures.\n" +
                "- Trace names typically represent the entry-point operation (e.g., HTTP method + route).\n" +
                "- Traces are ranked in 4 independent dimensions: by count (most frequent, usually user-facing), by cumulative duration (heaviest total time), by average duration (slowest, min 3 occurrences), and by error count (most problematic). A trace can appear in multiple lists.\n" +
                "- 'previousPeriod' data (if present) lets you compare against the prior time window.\n\n" +
                "Output your answer in two clear sections:\n" +
                "## Analysis\n" +
                "A concise analysis (3-6 paragraphs) covering:\n" +
                "- Overall health of the system and any notable changes from the previous period\n" +
                "- Patterns, anomalies, or trends in latency, error rates, or throughput\n" +
                "- Services or endpoints that stand out (positive or negative), referencing percentiles where relevant\n" +
                "- Error patterns: common error messages, HTTP status code distribution, and potential root causes\n" +
                "\n" +
                'IMPORTANT: Always explicitly reference the service name (e.g., "serviceName") when discussing any ' +
                "trace or log pattern or endpoint. Do not mention traces without stating which " +
                "service they belong to.\n\n" +
                "## Recommendations\n" +
                "Actionable recommendations (3-6 bullet points) prioritized by impact. " +
                "Each bullet must be specific, data-backed, and directly reference the statistics provided. " +
                "Do NOT give generic advice like 'monitor your system' or 'set up alerts'—be concrete.",
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
          timeout: 60000,
        },
      );
      return response.data?.choices?.[0]?.message?.content || "";
    } catch (error) {
      lastError = error as Error;
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      // Retry on server errors (5xx) or rate limits (429), not on client errors (4xx)
      if (status && status < 500 && status !== 429) {
        throw error;
      }
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        logger.warn(
          `LLM API attempt ${attempt + 1} failed (status=${status}), retrying in ${delay}ms: ${lastError.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError || new Error("LLM API call failed after retries");
}

// ── Statistics Collection ─────────────────────────────────────────────────────

interface LogsStats {
  total: number;
  errors: number;
  perService: Array<{
    serviceName: string;
    total: number;
    errors: number;
    errorRate: number;
  }>;
  perSeverity: Array<{ severity: string; count: number }>;
  topErrorMessages: Array<{ message: string; count: number }>;
}

interface TraceTypeStats {
  name: string;
  totalDurationMs: number;
  count: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  errorCount: number;
}

interface TracesStats {
  total: number;
  requestsPerMinute: number;
  perService: Array<{ serviceName: string; count: number; errorCount: number }>;
  errorCount: number;
  topByCount: TraceTypeStats[];
  topByDuration: TraceTypeStats[];
  topByAvgDuration: TraceTypeStats[];
  topByErrors: TraceTypeStats[];
  httpStatusBreakdown: Array<{
    serviceName: string;
    statusRange: string;
    count: number;
  }>;
}

interface RecommendationStats {
  periodStart: number;
  periodEnd: number;
  periodHours: number;
  services: string[];
  logs: LogsStats;
  traces: TracesStats;
  previousPeriod?: {
    logsTotal: number;
    logsErrors: number;
    tracesTotal: number;
    tracesErrors: number;
  };
}

async function CollectStats(
  context: Span,
  periodStart: number,
  periodEnd: number,
  periodHours: number,
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

  // Top error messages (limited to 5 with shorter text to reduce token usage)
  const topErrorMessagesRaw = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.LOGS_TOP_ERROR_MESSAGES[DbUtilsGetType()],
    [periodStart, periodEnd, 5],
  );
  const topErrorMessages: LogsStats["topErrorMessages"] = [];
  for (const row of topErrorMessagesRaw) {
    topErrorMessages.push({
      message: String(row.logText || "").substring(0, 120),
      count: Number(row.count),
    });
  }

  const logsStats: LogsStats = {
    total: logsTotal,
    errors: logsErrors,
    perService: logsPerService,
    perSeverity: logsPerSeverity,
    topErrorMessages,
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

  // Per-service with error counts
  const tracesPerServiceRaw = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.TRACES_PER_SERVICE[DbUtilsGetType()],
    [periodStart, periodEnd],
  );
  const tracesErrorPerServiceRaw = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.TRACES_ERRORS_PER_SERVICE[DbUtilsGetType()],
    [periodStart, periodEnd],
  );
  const traceErrorMap: Record<string, number> = {};
  for (const row of tracesErrorPerServiceRaw) {
    traceErrorMap[row.serviceName] = Number(row.count);
  }
  const tracesPerService: TracesStats["perService"] = [];
  for (const row of tracesPerServiceRaw) {
    tracesPerService.push({
      serviceName: row.serviceName,
      count: Number(row.count),
      errorCount: traceErrorMap[row.serviceName] || 0,
    });
  }

  // Throughput
  const requestsPerMinute =
    periodHours > 0
      ? Math.round((tracesTotal / (periodHours * 60)) * 10) / 10
      : 0;

  // Top trace names — fetch all root spans once, aggregate in memory for 4 ranking dimensions
  // Dynamic limits based on actual number of services (computed later)
  // We'll compute limits after we know how many services exist

  // Single efficient query: all root spans with their name, serviceName, duration, and status
  const rootSpansRaw = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.TRACES_ROOT_SPANS_AGGREGATED[DbUtilsGetType()],
    [periodStart, periodEnd],
  );

  // In-memory aggregation: group by trace name
  const traceAgg: Record<
    string,
    {
      durations: number[];
      serviceName: string;
      errorCount: number;
    }
  > = {};
  for (const row of rootSpansRaw) {
    const name = row.name;
    const durationMs = Number(row.duration) / 1_000_000; // ns → ms
    const isError = Number(row.statusCode) === 2;
    if (!traceAgg[name]) {
      traceAgg[name] = {
        durations: [],
        serviceName: row.serviceName || "unknown",
        errorCount: 0,
      };
    }
    traceAgg[name].durations.push(durationMs);
    if (isError) traceAgg[name].errorCount++;
  }

  // Sort durations and compute percentiles per trace name
  const buildTraceTypeStats = (
    name: string,
    agg: (typeof traceAgg)[string],
  ): TraceTypeStats => {
    const d = [...agg.durations].sort((a, b) => a - b);
    const p = (pct: number): number => {
      if (d.length === 0) return 0;
      const idx = Math.ceil((pct / 100) * d.length) - 1;
      return Math.round(d[Math.max(0, Math.min(idx, d.length - 1))]);
    };
    const sum = d.reduce((s, v) => s + v, 0);
    return {
      name,
      count: d.length,
      totalDurationMs: Math.round(sum),
      avgDurationMs: d.length > 0 ? Math.round(sum / d.length) : 0,
      p50DurationMs: p(50),
      p95DurationMs: p(95),
      p99DurationMs: p(99),
      errorCount: agg.errorCount,
    };
  };

  const allTraceStats: TraceTypeStats[] = Object.entries(traceAgg).map(
    ([name, agg]) => buildTraceTypeStats(name, agg),
  );

  // Dynamic limits based on actual number of services
  const numServices = Math.max(tracesPerService.length, 1);
  const topTraceLimitByCount = Math.min(3 * numServices, 15);
  const topTraceLimitByDuration = Math.min(2 * numServices, 10);
  const topTraceLimitByAvg = Math.min(2 * numServices, 10);
  const topTraceLimitByErrors = Math.min(2 * numServices, 10);

  // Four ranking dimensions
  const topByCount = [...allTraceStats]
    .sort((a, b) => b.count - a.count)
    .slice(0, topTraceLimitByCount);

  const topByDuration = [...allTraceStats]
    .sort((a, b) => b.totalDurationMs - a.totalDurationMs)
    .slice(0, topTraceLimitByDuration);

  const topByAvgDuration = [...allTraceStats]
    .filter((t) => t.count >= 3) // exclude one-off anomalies
    .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
    .slice(0, topTraceLimitByAvg);

  const topByErrors = [...allTraceStats]
    .filter((t) => t.errorCount > 0)
    .sort((a, b) => b.errorCount - a.errorCount)
    .slice(0, topTraceLimitByErrors);

  // HTTP status code breakdown
  const httpStatusRaw = await DbUtilsNoTelemetryQuerySQL(
    SQL_QUERIES.TRACES_HTTP_STATUS[DbUtilsGetType()],
    [periodStart, periodEnd],
  );
  const httpStatusBreakdown: TracesStats["httpStatusBreakdown"] = [];
  const statusMap: Record<string, Record<string, number>> = {};
  for (const row of httpStatusRaw) {
    const svc = row.serviceName || "unknown";
    const attr = String(row.attributes || "");
    const statusMatch = attr.match(
      /"key"\s*:\s*"http\.status_code"[^}]*"(?:int|string)Value"\s*:\s*(?:"?(\d+)"?)/,
    );
    if (!statusMatch) continue;
    const code = parseInt(statusMatch[1], 10);
    const range = `${Math.floor(code / 100)}xx`;
    if (!statusMap[svc]) statusMap[svc] = {};
    statusMap[svc][range] = (statusMap[svc][range] || 0) + 1;
  }
  for (const [svc, ranges] of Object.entries(statusMap)) {
    for (const [range, count] of Object.entries(ranges)) {
      httpStatusBreakdown.push({ serviceName: svc, statusRange: range, count });
    }
  }
  httpStatusBreakdown.sort((a, b) => b.count - a.count);

  const tracesStats: TracesStats = {
    total: tracesTotal,
    requestsPerMinute,
    errorCount: tracesErrors,
    perService: tracesPerService,
    topByCount,
    topByDuration,
    topByAvgDuration,
    topByErrors,
    httpStatusBreakdown,
  };

  // ── Previous period comparison ─────────────────────────────────────────

  let previousPeriod: RecommendationStats["previousPeriod"] = undefined;
  try {
    if (await fs.pathExists(recommendationFilePath)) {
      const cached = (await fs.readJson(recommendationFilePath)) as {
        stats?: {
          logs?: { total?: number; errors?: number };
          traces?: { total?: number; errorCount?: number };
        };
      };
      if (cached?.stats?.logs) {
        previousPeriod = {
          logsTotal: cached.stats.logs.total || 0,
          logsErrors: cached.stats.logs.errors || 0,
          tracesTotal: cached.stats.traces?.total || 0,
          tracesErrors: cached.stats.traces?.errorCount || 0,
        };
      }
    }
  } catch {
    // Ignore — previous period comparison is best-effort
  }

  // ── Services ────────────────────────────────────────────────────────────

  const serviceSet = new Set<string>();
  for (const s of logsPerService) serviceSet.add(s.serviceName);
  for (const s of tracesPerService) serviceSet.add(s.serviceName);

  span.end();

  return {
    periodStart,
    periodEnd,
    periodHours,
    services: Array.from(serviceSet).sort(),
    logs: logsStats,
    traces: tracesStats,
    previousPeriod,
  };
}

// ── Prompt Builder ────────────────────────────────────────────────────────────

function BuildPrompt(stats: RecommendationStats, periodHours: number): string {
  const fmtPct = (v: number): string => {
    const pct = v * 100;
    if (v === 0) return "0%";
    if (pct < 0.01) return `${pct.toFixed(4)}%`;
    if (pct < 1) return `${pct.toFixed(2)}%`;
    return `${pct.toFixed(1)}%`;
  };

  const fmtDelta = (current: number, previous: number | undefined): string => {
    if (previous === undefined) return "";
    const delta = current - previous;
    const pctChange =
      previous > 0 ? (delta / previous) * 100 : current > 0 ? Infinity : 0;
    const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
    const pctStr = isFinite(pctChange)
      ? `${Math.abs(pctChange).toFixed(0)}%`
      : "new";
    return ` (${arrow}${pctStr} vs previous period)`;
  };

  const lines: string[] = [];
  lines.push(`Telemetry statistics for the last ${periodHours} hours.\n`);

  lines.push("--- Services ---");
  lines.push(stats.services.join(", "));
  lines.push("");

  // ── Logs ──

  lines.push("--- Logs ---");
  lines.push(
    `Total logs: ${stats.logs.total}${fmtDelta(stats.logs.total, stats.previousPeriod?.logsTotal)}`,
  );
  lines.push(
    `Error logs: ${stats.logs.errors} (${fmtPct(stats.logs.errors / Math.max(stats.logs.total, 1))})${fmtDelta(stats.logs.errors, stats.previousPeriod?.logsErrors)}`,
  );
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

  if (stats.logs.topErrorMessages.length > 0) {
    lines.push("Top error log messages (most frequent):");
    for (const e of stats.logs.topErrorMessages) {
      lines.push(`  - [${e.count}x] ${e.message}`);
    }
    lines.push("");
  }

  // ── Traces ──

  lines.push("--- Traces ---");
  lines.push(
    `Total traces: ${stats.traces.total}${fmtDelta(stats.traces.total, stats.previousPeriod?.tracesTotal)}`,
  );
  lines.push(
    `Traces with errors: ${stats.traces.errorCount}${fmtDelta(stats.traces.errorCount, stats.previousPeriod?.tracesErrors)}`,
  );
  lines.push(`Throughput: ${stats.traces.requestsPerMinute} traces/minute`);
  lines.push("");
  lines.push("Traces per service:");
  for (const s of stats.traces.perService) {
    lines.push(
      `  - ${s.serviceName}: ${s.count} traces, ${s.errorCount} errors`,
    );
  }
  lines.push("");

  if (stats.traces.httpStatusBreakdown.length > 0) {
    lines.push("HTTP status code distribution (root spans):");
    for (const h of stats.traces.httpStatusBreakdown) {
      lines.push(`  - ${h.serviceName}: ${h.statusRange} → ${h.count}`);
    }
    lines.push("");
  }

  // Four ranking dimensions — ensures both interactive (high-count) and background (high-duration) traces are visible
  const fmtTraceLine = (t: TraceTypeStats): string =>
    `${t.name}: ${t.count} traces, ${t.totalDurationMs}ms total, ${t.avgDurationMs}ms avg, p50=${t.p50DurationMs}ms, p95=${t.p95DurationMs}ms, p99=${t.p99DurationMs}ms, ${t.errorCount} errors`;

  if (stats.traces.topByCount.length > 0) {
    lines.push(
      `Top ${stats.traces.topByCount.length} trace types by request count (most frequent — typically user-facing):`,
    );
    for (const t of stats.traces.topByCount) {
      lines.push(`  - ${fmtTraceLine(t)}`);
    }
    lines.push("");
  }

  if (stats.traces.topByDuration.length > 0) {
    lines.push(
      `Top ${stats.traces.topByDuration.length} trace types by cumulative duration (heaviest total time):`,
    );
    for (const t of stats.traces.topByDuration) {
      lines.push(`  - ${fmtTraceLine(t)}`);
    }
    lines.push("");
  }

  if (stats.traces.topByAvgDuration.length > 0) {
    lines.push(
      `Top ${stats.traces.topByAvgDuration.length} trace types by average duration (slowest — min 3 occurrences):`,
    );
    for (const t of stats.traces.topByAvgDuration) {
      lines.push(`  - ${fmtTraceLine(t)}`);
    }
    lines.push("");
  }

  if (stats.traces.topByErrors.length > 0) {
    lines.push(
      `Top ${stats.traces.topByErrors.length} trace types by error count (most problematic):`,
    );
    for (const t of stats.traces.topByErrors) {
      lines.push(`  - ${fmtTraceLine(t)}`);
    }
    lines.push("");
  }

  // ── Previous period comparison ──

  if (stats.previousPeriod) {
    lines.push("--- Comparison with previous period ---");
    lines.push(
      `Logs: ${stats.previousPeriod.logsTotal} → ${stats.logs.total} total, ${stats.previousPeriod.logsErrors} → ${stats.logs.errors} errors`,
    );
    lines.push(
      `Traces: ${stats.previousPeriod.tracesTotal} → ${stats.traces.total} total, ${stats.previousPeriod.tracesErrors} → ${stats.traces.errorCount} errors`,
    );
    lines.push("");
  }

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
    sqlite: "SELECT COUNT(*) AS count FROM logs WHERE time >= ? AND time < ?",
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
  LOGS_TOP_ERROR_MESSAGES: {
    postgres:
      'SELECT "logText", COUNT(*) AS count FROM logs WHERE "time" >= $1 AND "time" < $2 AND LOWER("severity") = \'error\' GROUP BY "logText" ORDER BY count DESC LIMIT $3',
    sqlite:
      "SELECT logText, COUNT(*) AS count FROM logs WHERE time >= ? AND time < ? AND LOWER(severity) = 'error' GROUP BY logText ORDER BY count DESC LIMIT ?",
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
  TRACES_ERRORS_PER_SERVICE: {
    postgres:
      'SELECT "serviceName", COUNT(DISTINCT "traceId") AS count FROM traces WHERE "startTime" >= $1 AND "startTime" < $2 AND "statusCode" = 2 GROUP BY "serviceName" ORDER BY count DESC',
    sqlite:
      "SELECT serviceName, COUNT(DISTINCT traceId) AS count FROM traces WHERE startTime >= ? AND startTime < ? AND statusCode = 2 GROUP BY serviceName ORDER BY count DESC",
  },
  TRACES_ROOT_DURATIONS: {
    postgres:
      'SELECT ("endTime" - "startTime") AS duration FROM traces WHERE "startTime" >= $1 AND "startTime" < $2 AND "parentSpanId" IS NULL',
    sqlite:
      "SELECT (endTime - startTime) AS duration FROM traces WHERE startTime >= ? AND startTime < ? AND parentSpanId IS NULL",
  },
  TRACES_DURATIONS_BY_NAME: {
    postgres:
      'SELECT ("endTime" - "startTime") AS duration FROM traces WHERE "startTime" >= $1 AND "startTime" < $2 AND "parentSpanId" IS NULL AND "name" = $3',
    sqlite:
      "SELECT (endTime - startTime) AS duration FROM traces WHERE startTime >= ? AND startTime < ? AND parentSpanId IS NULL AND name = ?",
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
  TRACES_HTTP_STATUS: {
    postgres:
      'SELECT "serviceName", "attributes" FROM traces WHERE "startTime" >= $1 AND "startTime" < $2 AND "attributes" LIKE \'%http.status_code%\' AND "parentSpanId" IS NULL LIMIT 2000',
    sqlite:
      "SELECT serviceName, attributes FROM traces WHERE startTime >= ? AND startTime < ? AND attributes LIKE '%http.status_code%' AND parentSpanId IS NULL LIMIT 2000",
  },
  TRACES_ROOT_SPANS_AGGREGATED: {
    postgres:
      'SELECT "name", "serviceName", ("endTime" - "startTime") AS duration, "statusCode" FROM traces WHERE "startTime" >= $1 AND "startTime" < $2 AND "parentSpanId" IS NULL LIMIT 50000',
    sqlite:
      "SELECT name, serviceName, (endTime - startTime) AS duration, statusCode FROM traces WHERE startTime >= ? AND startTime < ? AND parentSpanId IS NULL LIMIT 50000",
  },
};
