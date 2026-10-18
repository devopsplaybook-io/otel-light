export const HOME_OVERVIEW_WINDOW_SECONDS = 24 * 60 * 60;

export interface HomeOverviewJobHealth {
  label: string;
  generatedAt: string | null;
}

export interface HomeOverviewModel {
  logsTotal: number | null;
  logErrors: number | null;
  tracesTotal: number | null;
  traceErrors: number | null;
  metricSeries: number | null;
  servicesCount: number | null;
  jobs: HomeOverviewJobHealth[];
}

export interface HomeOverviewLogsStats {
  totalCount?: number;
  severityCounts?: Record<string, number>;
}

// OTel timestamps are nanoseconds; analytics APIs take `from`/`to` in ns.
// Values exceed Number.MAX_SAFE_INTEGER: fine, the server stores ns
// timestamps as doubles too (same computation as SearchOptions).
export function HomeOverviewWindowNs(nowMs: number): {
  from: number;
  to: number;
} {
  return {
    from: nowMs * 1_000_000 - HOME_OVERVIEW_WINDOW_SECONDS * 1_000_000_000,
    to: nowMs * 1_000_000,
  };
}

// `null` inputs mean "no data available" (fetch failed or out of scope) and
// render as "—"; a successful fetch with zero results is a real 0.
export function HomeOverviewBuildModel(input: {
  logsStats: HomeOverviewLogsStats | null;
  tracesGroups: { traceCount?: number; nbErrors?: number }[] | null;
  metricNamesCount: number | null;
  servicesCount: number | null;
  recommendationGeneratedAt: string | null;
  longestReportGeneratedAt: string | null;
  mostCalledReportGeneratedAt: string | null;
}): HomeOverviewModel {
  const severityCounts = input.logsStats?.severityCounts || {};
  const logsTotal =
    input.logsStats === null ? null : (input.logsStats.totalCount ?? 0);
  const logErrors =
    input.logsStats === null
      ? null
      : (severityCounts.ERROR || 0) + (severityCounts.FATAL || 0);

  let tracesTotal: number | null = null;
  let traceErrors: number | null = null;
  if (input.tracesGroups !== null) {
    tracesTotal = 0;
    traceErrors = 0;
    for (const group of input.tracesGroups) {
      tracesTotal += group.traceCount || 0;
      traceErrors += group.nbErrors || 0;
    }
  }

  return {
    logsTotal,
    logErrors,
    tracesTotal,
    traceErrors,
    metricSeries: input.metricNamesCount,
    servicesCount: input.servicesCount,
    jobs: [
      {
        label: "LLM recommendation",
        generatedAt: input.recommendationGeneratedAt,
      },
      {
        label: "Longest traces report",
        generatedAt: input.longestReportGeneratedAt,
      },
      {
        label: "Most called traces report",
        generatedAt: input.mostCalledReportGeneratedAt,
      },
    ],
  };
}
