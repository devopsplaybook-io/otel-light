// Search 2.0 query-state helpers.
//
// One state object backs the URL round-trip (seconds-ago windows, so a
// bookmarked URL keeps meaning), the request sent to the analytics API
// (absolute nanosecond timestamps plus every structured filter) and the
// payload stored in a saved view (the API query string).
//
// Attribute filters use the repeatable `attr=key:operator[:value]` form shared
// with the server: operators are `=`, `!=`, `contains` and `exists`.

export type SearchSignalType = "logs" | "traces" | "metrics";
export type SearchAttributeOperator = "=" | "!=" | "contains" | "exists";

export interface SearchAttributeFilter {
  key: string;
  operator: SearchAttributeOperator;
  value: string;
}

export interface SearchQueryState {
  keywords: string;
  from: number;
  to: number;
  errorsOnly: boolean;
  status: string;
  severity: string;
  serviceName: string;
  serviceVersion: string;
  durationMin: string;
  durationMax: string;
  attributes: SearchAttributeFilter[];
}

export type SearchRouteQuery = Record<string, string | string[]>;

const ATTRIBUTE_OPERATORS: SearchAttributeOperator[] = [
  "=",
  "!=",
  "contains",
  "exists",
];

export function SearchQueryEmptyState(): SearchQueryState {
  return {
    keywords: "",
    from: 0,
    to: 0,
    errorsOnly: false,
    status: "",
    severity: "",
    serviceName: "",
    serviceVersion: "",
    durationMin: "",
    durationMax: "",
    attributes: [],
  };
}

export function SearchQueryAttributeEncode(filter: SearchAttributeFilter): string {
  const encoded = `${filter.key}:${filter.operator}`;
  if (filter.operator === "exists") {
    return encoded;
  }
  return `${encoded}:${filter.value ?? ""}`;
}

export function SearchQueryAttributeDecode(
  value: unknown,
): SearchAttributeFilter | null {
  if (typeof value !== "string") {
    return null;
  }
  const firstSeparator = value.indexOf(":");
  if (firstSeparator <= 0) {
    return null;
  }
  const key = value.slice(0, firstSeparator).trim();
  const remainder = value.slice(firstSeparator + 1);
  const secondSeparator = remainder.indexOf(":");
  const operator = (
    secondSeparator === -1 ? remainder : remainder.slice(0, secondSeparator)
  )
    .trim()
    .toLowerCase() as SearchAttributeOperator;
  const attributeValue =
    secondSeparator === -1 ? "" : remainder.slice(secondSeparator + 1);
  if (!key || !ATTRIBUTE_OPERATORS.includes(operator)) {
    return null;
  }
  if (operator === "exists") {
    return { key, operator, value: "" };
  }
  if (!attributeValue) {
    return null;
  }
  return { key, operator, value: attributeValue };
}

function firstValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? String(value[0] ?? "") : "";
  }
  return value === undefined || value === null ? "" : String(value);
}

function numericString(value: unknown): number {
  const parsed = parseInt(firstValue(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function SearchQueryFromRouteQuery(
  query: Record<string, unknown> | null | undefined,
  type: SearchSignalType,
): SearchQueryState {
  const state = SearchQueryEmptyState();
  if (!query) {
    return state;
  }
  state.keywords = firstValue(query.keywords);
  state.from = numericString(query.from);
  state.to = numericString(query.to);
  state.serviceName = firstValue(query.serviceName);
  if (type === "metrics") {
    return state;
  }
  state.serviceVersion = firstValue(query.serviceVersion);
  if (type === "logs") {
    state.severity = firstValue(query.severity);
    return state;
  }
  state.errorsOnly = firstValue(query.errorsOnly) === "true";
  state.status = firstValue(query.status);
  state.durationMin = firstValue(query.durationMin);
  state.durationMax = firstValue(query.durationMax);
  const rawAttributes = query.attr;
  const entries = Array.isArray(rawAttributes)
    ? rawAttributes
    : rawAttributes === undefined || rawAttributes === null
      ? []
      : [rawAttributes];
  state.attributes = entries
    .map((entry) => SearchQueryAttributeDecode(entry))
    .filter((entry): entry is SearchAttributeFilter => entry !== null);
  return state;
}

export function SearchQueryToRouteQuery(
  state: SearchQueryState,
  type: SearchSignalType,
): SearchRouteQuery {
  const query: SearchRouteQuery = {};
  if (state.keywords) query.keywords = state.keywords;
  if (state.from) query.from = String(state.from);
  if (state.to) query.to = String(state.to);
  if (state.serviceName) query.serviceName = state.serviceName;
  if (type === "metrics") {
    return query;
  }
  if (state.serviceVersion) query.serviceVersion = state.serviceVersion;
  if (type === "logs") {
    if (state.severity) query.severity = state.severity;
    return query;
  }
  if (state.errorsOnly) query.errorsOnly = "true";
  if (state.status) query.status = state.status;
  if (state.durationMin) query.durationMin = state.durationMin;
  if (state.durationMax) query.durationMax = state.durationMax;
  const attributes = state.attributes
    .filter((attribute) => attribute.key)
    .map((attribute) => SearchQueryAttributeEncode(attribute));
  if (attributes.length > 0) {
    query.attr = attributes;
  }
  return query;
}

function toNanoseconds(secondsAgo: number): number {
  if (!secondsAgo) return 0;
  return Date.now() * 1e6 - secondsAgo * 1e9;
}

function nanosecondsToSecondsAgo(value: string | null): number {
  if (!value) return 0;
  const nanoseconds = Number(value);
  if (!Number.isFinite(nanoseconds) || nanoseconds <= 0) return 0;
  return Math.max(0, Math.round((Date.now() * 1e6 - nanoseconds) / 1e9));
}

// Request parameters for the analytics API: absolute nanosecond bounds and
// every structured filter as a separate (possibly repeated) parameter.
export function SearchQueryToParams(
  state: SearchQueryState,
  type: SearchSignalType,
): URLSearchParams {
  const params = new URLSearchParams();
  if (state.keywords) {
    params.set("keywords", state.keywords);
  }
  const fromNs = toNanoseconds(state.from);
  const toNs = toNanoseconds(state.to);
  if (fromNs > 0) params.set("from", String(fromNs));
  if (toNs > 0) params.set("to", String(toNs));
  if (state.serviceName) params.set("serviceName", state.serviceName);
  if (type === "metrics") {
    return params;
  }
  if (state.serviceVersion) params.set("serviceVersion", state.serviceVersion);
  if (type === "logs") {
    if (state.severity) params.set("severity", state.severity);
    return params;
  }
  if (state.errorsOnly) params.set("errorsOnly", "true");
  if (state.status) params.set("status", state.status);
  if (state.durationMin) params.set("durationMin", state.durationMin);
  if (state.durationMax) params.set("durationMax", state.durationMax);
  for (const attribute of state.attributes) {
    if (!attribute.key) continue;
    params.append("attr", SearchQueryAttributeEncode(attribute));
  }
  return params;
}

// Parses the query string kept inside a saved view (the API form) back into
// route state, so applying a view restores the visible filter controls.
export function SearchQueryStateFromParams(
  queryString: string,
  type: SearchSignalType,
): SearchQueryState {
  const params = new URLSearchParams(queryString || "");
  const rawAttributes = params.getAll("attr");
  const state = SearchQueryEmptyState();
  state.keywords = params.get("keywords") || "";
  state.serviceName = params.get("serviceName") || "";
  // Saved views store absolute nanosecond bounds; the route keeps a
  // seconds-ago window so the restored view stays meaningful over time.
  state.from = nanosecondsToSecondsAgo(params.get("from"));
  state.to = nanosecondsToSecondsAgo(params.get("to"));
  if (type === "metrics") {
    return state;
  }
  state.serviceVersion = params.get("serviceVersion") || "";
  if (type === "logs") {
    state.severity = params.get("severity") || "";
    return state;
  }
  state.errorsOnly = params.get("errorsOnly") === "true";
  state.status = params.get("status") || "";
  state.durationMin = params.get("durationMin") || "";
  state.durationMax = params.get("durationMax") || "";
  state.attributes = rawAttributes
    .map((entry) => SearchQueryAttributeDecode(entry))
    .filter((entry): entry is SearchAttributeFilter => entry !== null);
  return state;
}
