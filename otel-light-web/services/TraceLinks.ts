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
