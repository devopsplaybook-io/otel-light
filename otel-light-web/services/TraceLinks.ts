// Maps an aggregated-stats trace group to the URL query of the Traces page,
// preserving the current filters (time window, errorsOnly, keywords) so the
// "open in Traces" navigation lands on the same search scope, narrowed to the
// group's service, version and exact trace name.

import { TimeWindowOptions } from "./PreferencesService";

export function TraceGroupToTracesQuery(
  group: any,
  currentQuery: any
): Record<string, string> {
  const query: Record<string, string> = { ...(currentQuery || {}) };
  if (group?.serviceName) {
    query.serviceName = group.serviceName;
  }
  if (group?.serviceVersion) {
    query.serviceVersion = group.serviceVersion;
  }
  if (group?.name) {
    query.name = group.name;
  }
  return query;
}

// The traces filters express `from`/`to` as seconds ago, so a report or a
// recommendation window is snapped to the smallest option that covers it (a
// shareable superset). `to: "0"` means "now".
export function TraceLinksTimeWindowQuery(
  fromMs: number,
  toMs: number,
  nowMs: number
): Record<string, string> {
  const boundedFromMs = Math.min(Number(fromMs), Number(toMs));
  const elapsedSeconds = Number.isFinite(boundedFromMs)
    ? Math.max(0, Math.ceil((nowMs - boundedFromMs) / 1000))
    : Infinity;
  const options = TimeWindowOptions.filter((option) => option.value > 0);
  const match = options.find((option) => option.value >= elapsedSeconds);
  const value = match
    ? match.value
    : options[options.length - 1]?.value ?? 0;
  return { from: String(value), to: "0" };
}

// A static report covers [generatedAt - periodDays, generatedAt]; the link
// keeps that window as a superset ending now.
export function TraceReportToTracesQuery(
  group: any,
  generatedAtMs: number,
  periodDays: number,
  nowMs: number
): Record<string, string> {
  const periodMs = (Number(periodDays) || 0) * 24 * 60 * 60 * 1000;
  return {
    ...TraceGroupToTracesQuery(group, {}),
    ...TraceLinksTimeWindowQuery(generatedAtMs - periodMs, generatedAtMs, nowMs),
  };
}

// Trace ids are opaque: encode them wherever they are interpolated into a URL
// so ids containing '&', '#', '/' or '%' cannot break the request.
export function TraceApiSummaryUrl(baseUrl: string, traceId: string): string {
  return `${baseUrl}/analytics/traces?traceId=${encodeURIComponent(traceId)}`;
}

export function TraceApiSpansUrl(baseUrl: string, traceId: string): string {
  return `${baseUrl}/analytics/traces/${encodeURIComponent(traceId)}/spans`;
}

export function TraceApiLogsUrl(baseUrl: string, traceId: string): string {
  return `${baseUrl}/analytics/traces/${encodeURIComponent(traceId)}/logs`;
}

// Client-side route of the trace detail page.
export function TracePagePath(traceId: string): string {
  return "/traces/" + encodeURIComponent(traceId);
}

// Expands an aggregated-stats group in the Traces list: keep the active
// filters and narrow to the group's service, version and exact trace name.
export function TraceGroupToAnalyticsParams(
  group: any,
  currentQueryString?: string
): URLSearchParams {
  const params = new URLSearchParams(currentQueryString || "");
  params.set("serviceName", group?.serviceName ?? "");
  params.set("serviceVersion", group?.serviceVersion ?? "");
  if (group?.name) {
    params.set("name", group.name);
  }
  return params;
}
