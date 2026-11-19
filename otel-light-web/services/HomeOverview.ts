export const HOME_OVERVIEW_WINDOW_SECONDS = 24 * 60 * 60;

export const HOME_OVERVIEW_CELLS_STORAGE_KEY =
  "otel-light.homeOverview.v1.cells";

export type HomeOverviewCellKey = "logs" | "traces" | "metrics" | "services";

export type HomeOverviewCellStatus = "loading" | "ok" | "error";

// One KPI cell: `value` (and its secondary `detail`, e.g. errors) plus the
// time it was fetched. A failed refresh keeps the last-known value so the
// strip never falls back to a meaningless dash.
export interface HomeOverviewCell {
  status: HomeOverviewCellStatus;
  value: number | null;
  detail: number | null;
  fetchedAt: number | null;
  error: string | null;
}

export type HomeOverviewCells = Record<HomeOverviewCellKey, HomeOverviewCell>;

export const HOME_OVERVIEW_CELL_KEYS: HomeOverviewCellKey[] = [
  "logs",
  "traces",
  "metrics",
  "services",
];

function emptyCell(): HomeOverviewCell {
  return {
    status: "loading",
    value: null,
    detail: null,
    fetchedAt: null,
    error: null,
  };
}

export function HomeOverviewCellsInitial(): HomeOverviewCells {
  return {
    logs: emptyCell(),
    traces: emptyCell(),
    metrics: emptyCell(),
    services: emptyCell(),
  };
}

export function HomeOverviewCellSuccess(
  cell: HomeOverviewCell,
  value: number,
  detail: number | null,
  fetchedAt: number,
): HomeOverviewCell {
  return {
    status: "ok",
    value,
    detail,
    fetchedAt,
    error: null,
  };
}

export function HomeOverviewCellFailure(
  cell: HomeOverviewCell,
  error: string,
): HomeOverviewCell {
  return {
    ...cell,
    status: "error",
    error,
  };
}

export function HomeOverviewCellIsLoading(cell: HomeOverviewCell): boolean {
  return cell.status === "loading" && cell.value === null;
}

export function HomeOverviewCellValueText(cell: HomeOverviewCell): string {
  return cell.value === null ? "unavailable" : String(cell.value);
}

export function HomeOverviewErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown })?.message;
  return typeof message === "string" && message ? message : "Request failed";
}

export function HomeOverviewAsOfLabel(fetchedAtMs: number): string {
  if (!Number.isFinite(fetchedAtMs)) return "";
  const date = new Date(fetchedAtMs);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `as of ${hours}:${minutes}`;
}

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Persists the last-known values so a reload shows them immediately while
// the refresh runs. Corrupt or partial payloads fall back to empty cells.
export function HomeOverviewCellsLoad(
  storage: Pick<Storage, "getItem">,
): HomeOverviewCells {
  const cells = HomeOverviewCellsInitial();
  let parsed: any;
  try {
    parsed = JSON.parse(storage.getItem(HOME_OVERVIEW_CELLS_STORAGE_KEY) ?? "null");
  } catch {
    return cells;
  }
  if (!parsed || typeof parsed !== "object") return cells;
  for (const key of HOME_OVERVIEW_CELL_KEYS) {
    const stored = parsed[key];
    if (!stored || typeof stored !== "object") continue;
    if (!isValidNumber(stored.value) || !isValidNumber(stored.fetchedAt)) {
      continue;
    }
    cells[key] = {
      status: "ok",
      value: stored.value,
      detail: isValidNumber(stored.detail) ? stored.detail : null,
      fetchedAt: stored.fetchedAt,
      error: null,
    };
  }
  return cells;
}

export function HomeOverviewCellsSave(
  storage: Pick<Storage, "setItem">,
  cells: HomeOverviewCells,
): void {
  const payload: Record<string, unknown> = {};
  for (const key of HOME_OVERVIEW_CELL_KEYS) {
    const cell = cells[key];
    if (cell.value === null || cell.fetchedAt === null) continue;
    payload[key] = {
      value: cell.value,
      detail: cell.detail,
      fetchedAt: cell.fetchedAt,
    };
  }
  try {
    storage.setItem(HOME_OVERVIEW_CELLS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be full or disabled: the strip still works in memory.
  }
}

// Home trace KPI: sum the summary groups (root spans only, so every group's
// traceCount is one trace and nbErrors is its root-span error outcome).
export function HomeOverviewTraceTotals(
  groups: { traceCount?: number; nbErrors?: number }[] | null,
): { tracesTotal: number | null; traceErrors: number | null } {
  if (groups === null) {
    return { tracesTotal: null, traceErrors: null };
  }
  let tracesTotal = 0;
  let traceErrors = 0;
  for (const group of groups) {
    tracesTotal += Number(group.traceCount) || 0;
    traceErrors += Number(group.nbErrors) || 0;
  }
  return { tracesTotal, traceErrors };
}

// The recommendation payload (and its LLM text) is derived from both traces
// and logs, so the server requires both scopes.
export function HomeOverviewCanAccessRecommendation(
  hasTracesScope: boolean,
  hasLogsScope: boolean,
): boolean {
  return !!(hasTracesScope && hasLogsScope);
}

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
