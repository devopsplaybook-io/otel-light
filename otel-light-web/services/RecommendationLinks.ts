// Builds shareable drilldowns from the cached LLM recommendation: each top
// trace entry (by errors, then by count) points back to the traces list
// filtered by service, exact name and the recommendation window.

import { TraceGroupToTracesQuery, TraceLinksTimeWindowQuery } from "./TraceLinks";

export interface RecommendationTraceLink {
  key: string;
  serviceName: string | null;
  name: string;
  count: number;
  errorCount: number;
  label: string;
  meta: string;
}

export function RecommendationBuildTraceLinks(
  recommendation: any,
  max = 8,
): RecommendationTraceLink[] {
  const traces = recommendation?.stats?.traces;
  if (!traces) return [];

  const seen = new Set<string>();
  const links: RecommendationTraceLink[] = [];
  const add = (entry: any) => {
    if (!entry || !entry.name) return;
    const serviceName = entry.serviceName ? String(entry.serviceName) : null;
    const name = String(entry.name);
    const key = `${serviceName ?? ""}::${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const count = Number(entry.count) || 0;
    const errorCount = Number(entry.errorCount) || 0;
    links.push({
      key,
      serviceName,
      name,
      count,
      errorCount,
      label: serviceName ? `${serviceName}: ${name}` : name,
      meta:
        errorCount > 0
          ? `${count} traces · ${errorCount} errors`
          : `${count} traces`,
    });
  };

  // Errors first: they are the actionable entries.
  for (const entry of traces.topByErrors || []) {
    if (links.length >= max) break;
    add(entry);
  }
  for (const entry of traces.topByCount || []) {
    if (links.length >= max) break;
    add(entry);
  }
  return links;
}

export function RecommendationTraceQuery(
  link: RecommendationTraceLink,
  recommendation: any,
  nowMs: number,
): Record<string, string> {
  const stats = recommendation?.stats || {};
  const periodEndMs = Number(stats.periodEnd) / 1_000_000;
  const periodStartMs = Number(stats.periodStart) / 1_000_000;
  const generatedAtMs = Date.parse(recommendation?.generatedAt || "");
  const endMs = Number.isFinite(periodEndMs)
    ? periodEndMs
    : Number.isFinite(generatedAtMs)
      ? generatedAtMs
      : nowMs;
  const startMs = Number.isFinite(periodStartMs)
    ? periodStartMs
    : endMs - (Number(stats.periodHours) || 24) * 60 * 60 * 1000;
  return {
    ...TraceGroupToTracesQuery(
      { serviceName: link.serviceName, name: link.name },
      {},
    ),
    ...TraceLinksTimeWindowQuery(startMs, endMs, nowMs),
  };
}
