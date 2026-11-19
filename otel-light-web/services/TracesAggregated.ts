// Client-side sorting for the Aggregated traces view. Groups come from
// GET /api/analytics/traces/summary; all sort keys are numeric except the
// deterministic service/version/name tie-break.

export type TracesAggregatedSortKey =
  | "traceCount"
  | "nbErrors"
  | "avgDuration"
  | "p90"
  | "p95";

export type TracesAggregatedSortDir = "asc" | "desc";

export const TRACES_AGGREGATED_DEFAULT_SORT: {
  key: TracesAggregatedSortKey;
  dir: TracesAggregatedSortDir;
} = { key: "traceCount", dir: "desc" };

function isMissing(value: unknown): boolean {
  return value === null || value === undefined || !Number.isFinite(Number(value));
}

function compareIdentity(a: any, b: any): number {
  const left = [
    String(a?.serviceName ?? ""),
    String(a?.serviceVersion ?? ""),
    String(a?.name ?? ""),
  ].join("||");
  const right = [
    String(b?.serviceName ?? ""),
    String(b?.serviceVersion ?? ""),
    String(b?.name ?? ""),
  ].join("||");
  return left.localeCompare(right);
}

export function TracesAggregatedSort(
  groups: any[],
  key: TracesAggregatedSortKey,
  dir: TracesAggregatedSortDir,
): any[] {
  const sorted = [...(groups || [])];
  sorted.sort((a, b) => {
    const aMissing = isMissing(a?.[key]);
    const bMissing = isMissing(b?.[key]);
    // Nulls always sort last, whatever the direction.
    if (aMissing && bMissing) return compareIdentity(a, b);
    if (aMissing) return 1;
    if (bMissing) return -1;
    const diff = Number(a[key]) - Number(b[key]);
    if (diff !== 0) return dir === "asc" ? diff : -diff;
    return compareIdentity(a, b);
  });
  return sorted;
}
