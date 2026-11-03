// Maps an aggregated-stats trace group to the URL query of the Traces page,
// preserving the current filters (time window, errorsOnly, keywords) so the
// "open in Traces" navigation lands on the same search scope, narrowed to the
// group's service and trace name.

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
    query.keywords = group.name;
  }
  return query;
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
