// Structured search filters shared by the logs/traces lists, stats and
// export endpoints.
//
// Query-parameter contract (documented in the README):
//   keywords      multi-term AND search; double-quoted phrases keep spaces
//   attr          repeatable `key:operator[:value]`; operators `=`, `!=`,
//                 `contains` (case-insensitive) and `exists`
//   serviceName   exact service name
//   serviceVersion exact service version
//   severity      logs only: TRACE/DEBUG/INFO/WARN/ERROR/FATAL
//   status        traces only: root span status (unset/ok/error or 0/1/2)
//   durationMin   traces only: minimum full-trace duration in milliseconds
//   durationMax   traces only: maximum full-trace duration in milliseconds
//
// Attribute predicates read the stored OTLP KeyValue arrays
// (`[{"key":"k","value":{"stringValue":"v"}}]`) with `json_each` on SQLite and
// `jsonb_array_elements` on PostgreSQL. All values stay bound parameters; the
// expressions below are static SQL text.
import { SpanStatusCode } from "@opentelemetry/api";
import { AnalyticsUtilsEscapeLike } from "./AnalyticsUtils";
import { SignalNormalizationSeverity } from "../SignalNormalization";

export const ATTRIBUTE_FILTER_MAX_COUNT = 20;
export const ATTRIBUTE_KEY_MAX_LENGTH = 256;
export const ATTRIBUTE_VALUE_MAX_LENGTH = 4_096;
export const DURATION_MS_MAX = 7 * 24 * 60 * 60 * 1000;

export type AttributeOperator = "=" | "!=" | "contains" | "exists";

export interface AttributeFilter {
  key: string;
  operator: AttributeOperator;
  value?: string;
}

export interface AnalyticsRequestFilters {
  keywords: string[];
  attributes: AttributeFilter[];
  serviceName: string;
  serviceVersion: string;
  severity: string;
  status?: SpanStatusCode;
  durationMinNs?: number;
  durationMaxNs?: number;
}

export interface AnalyticsSqlContext {
  dbType: string;
  params: unknown[];
  varAt: (index: number) => string;
}

const ATTRIBUTE_OPERATORS: AttributeOperator[] = [
  "=",
  "!=",
  "contains",
  "exists",
];

export function AnalyticsFiltersEmpty(): AnalyticsRequestFilters {
  return {
    keywords: [],
    attributes: [],
    serviceName: "",
    serviceVersion: "",
    severity: "",
  };
}

// Split on whitespace while keeping double-quoted phrases (including their
// inner spaces) as one term. An unmatched quote runs to the end of the input.
export function AnalyticsFiltersParseKeywords(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  const raw = Array.isArray(value)
    ? value.map((entry) => String(entry ?? "")).join(" ")
    : String(value);
  const terms: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of raw) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current.trim()) {
        terms.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    terms.push(current.trim());
  }
  return terms;
}

export function AnalyticsFiltersParseAttributes(
  value: unknown,
): { filters: AttributeFilter[]; error?: string } {
  if (value === undefined || value === null) {
    return { filters: [] };
  }
  const entries = Array.isArray(value) ? value : [value];
  if (entries.length > ATTRIBUTE_FILTER_MAX_COUNT) {
    return {
      filters: [],
      error: `At most ${ATTRIBUTE_FILTER_MAX_COUNT} attribute filters are allowed`,
    };
  }
  const filters: AttributeFilter[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      return { filters: [], error: "Invalid attribute filter" };
    }
    const firstSeparator = entry.indexOf(":");
    if (firstSeparator <= 0) {
      return {
        filters: [],
        error: "Attribute filters must use key:operator[:value]",
      };
    }
    const key = entry.slice(0, firstSeparator).trim();
    const remainder = entry.slice(firstSeparator + 1);
    const secondSeparator = remainder.indexOf(":");
    const operator = (
      secondSeparator === -1 ? remainder : remainder.slice(0, secondSeparator)
    )
      .trim()
      .toLowerCase() as AttributeOperator;
    const rawValue =
      secondSeparator === -1 ? "" : remainder.slice(secondSeparator + 1);

    if (!key || key.length > ATTRIBUTE_KEY_MAX_LENGTH) {
      return {
        filters: [],
        error: `Attribute key must be 1-${ATTRIBUTE_KEY_MAX_LENGTH} characters`,
      };
    }
    if (!ATTRIBUTE_OPERATORS.includes(operator)) {
      return {
        filters: [],
        error: `Attribute operator must be one of: ${ATTRIBUTE_OPERATORS.join(", ")}`,
      };
    }
    if (operator === "exists") {
      if (rawValue !== "") {
        return {
          filters: [],
          error: "The exists operator does not take a value",
        };
      }
      filters.push({ key, operator });
      continue;
    }
    if (!rawValue) {
      return {
        filters: [],
        error: `The ${operator} operator requires a value`,
      };
    }
    if (rawValue.length > ATTRIBUTE_VALUE_MAX_LENGTH) {
      return {
        filters: [],
        error: `Attribute value must be at most ${ATTRIBUTE_VALUE_MAX_LENGTH} characters`,
      };
    }
    filters.push({ key, operator, value: rawValue });
  }
  return { filters };
}

export function AnalyticsFiltersParseDurationMs(
  value: unknown,
): { ns?: number; error?: string } {
  if (value === undefined || value === null || String(value).trim() === "") {
    return {};
  }
  const numeric = Number(value);
  if (
    !Number.isFinite(numeric) ||
    numeric < 0 ||
    numeric > DURATION_MS_MAX
  ) {
    return { error: `Duration must be between 0 and ${DURATION_MS_MAX} ms` };
  }
  return { ns: Math.round(numeric * 1_000_000) };
}

export function AnalyticsFiltersParseStatus(
  value: unknown,
): { status?: SpanStatusCode; error?: string } {
  if (value === undefined || value === null || String(value).trim() === "") {
    return {};
  }
  const normalized = String(value).trim().toLowerCase();
  const statuses: Record<string, SpanStatusCode> = {
    unset: SpanStatusCode.UNSET,
    "0": SpanStatusCode.UNSET,
    ok: SpanStatusCode.OK,
    "1": SpanStatusCode.OK,
    error: SpanStatusCode.ERROR,
    "2": SpanStatusCode.ERROR,
  };
  if (!(normalized in statuses)) {
    return { error: "Status must be one of: unset, ok, error" };
  }
  return { status: statuses[normalized] };
}

export function AnalyticsFiltersParse(
  query: Record<string, unknown>,
  options?: { traces?: boolean },
): { filters: AnalyticsRequestFilters; error?: string } {
  const filters = AnalyticsFiltersEmpty();
  filters.keywords = AnalyticsFiltersParseKeywords(query.keywords);
  const attributes = AnalyticsFiltersParseAttributes(query.attr);
  if (attributes.error) {
    return { filters, error: attributes.error };
  }
  filters.attributes = attributes.filters;
  filters.serviceName = String(query.serviceName ?? "").trim();
  filters.serviceVersion = String(query.serviceVersion ?? "").trim();
  filters.severity = SignalNormalizationSeverity(query.severity);

  if (options?.traces) {
    const status = AnalyticsFiltersParseStatus(query.status);
    if (status.error) {
      return { filters, error: status.error };
    }
    filters.status = status.status;
    const durationMin = AnalyticsFiltersParseDurationMs(query.durationMin);
    if (durationMin.error) {
      return { filters, error: durationMin.error };
    }
    const durationMax = AnalyticsFiltersParseDurationMs(query.durationMax);
    if (durationMax.error) {
      return { filters, error: durationMax.error };
    }
    filters.durationMinNs = durationMin.ns;
    filters.durationMaxNs = durationMax.ns;
    if (
      filters.durationMinNs !== undefined &&
      filters.durationMaxNs !== undefined &&
      filters.durationMinNs > filters.durationMaxNs
    ) {
      return {
        filters,
        error: "durationMin must not be greater than durationMax",
      };
    }
  }
  return { filters };
}

// Stable representation for the stats cache key: two requests that differ by
// any filter dimension must not share a cached payload.
export function AnalyticsFiltersFingerprint(
  filters: AnalyticsRequestFilters,
): string {
  return JSON.stringify([
    filters.keywords,
    filters.attributes.map((filter) => [
      filter.key,
      filter.operator,
      filter.value ?? "",
    ]),
    filters.serviceName,
    filters.serviceVersion,
    filters.severity,
    filters.status ?? "",
    filters.durationMinNs ?? "",
    filters.durationMaxNs ?? "",
  ]);
}

export function AnalyticsFiltersKeywordsSql(
  ctx: AnalyticsSqlContext,
  column: string,
  terms: string[],
): string {
  let sql = "";
  for (const term of terms) {
    sql += ` AND ${column} LIKE ${ctx.varAt(ctx.params.length + 1)} ESCAPE '\\'`;
    ctx.params.push(
      `%${AnalyticsUtilsEscapeLike(term.toLowerCase())}%`,
    );
  }
  return sql;
}

// SQL expression rendering the scalar value of one OTLP KeyValue element.
// `element` is the element alias in the dialect-specific subquery below.
function attributeValueSql(dbType: string, element: string): string {
  if (dbType === "postgres") {
    return (
      `COALESCE(${element} #>> '{value,stringValue}', ` +
      `${element} #>> '{value,intValue}', ` +
      `${element} #>> '{value,doubleValue}', ` +
      `${element} #>> '{value,boolValue}')`
    );
  }
  return (
    `COALESCE(json_extract(${element}, '$.value.stringValue'), ` +
    `CAST(json_extract(${element}, '$.value.intValue') AS TEXT), ` +
    `CAST(json_extract(${element}, '$.value.doubleValue') AS TEXT), ` +
    `CASE CAST(json_extract(${element}, '$.value.boolValue') AS INTEGER) ` +
    `WHEN 1 THEN 'true' WHEN 0 THEN 'false' ELSE NULL END)`
  );
}

function attributeExistsSubquery(
  ctx: AnalyticsSqlContext,
  attrColumn: string,
  keyVar: string,
  valueCondition: string,
): string {
  if (ctx.dbType === "postgres") {
    return (
      `EXISTS (SELECT 1 FROM jsonb_array_elements(${attrColumn}::jsonb) AS je(elem) ` +
      `WHERE je.elem->>'key' = ${keyVar}${valueCondition})`
    );
  }
  return (
    `EXISTS (SELECT 1 FROM json_each(${attrColumn}) AS je ` +
    `WHERE json_extract(je.value, '$.key') = ${keyVar}${valueCondition})`
  );
}

export function AnalyticsFiltersAttributesSql(
  ctx: AnalyticsSqlContext,
  attrColumn: string,
  filters: AttributeFilter[],
): string {
  const valueSql =
    ctx.dbType === "postgres"
      ? attributeValueSql(ctx.dbType, "je.elem")
      : attributeValueSql(ctx.dbType, "je.value");
  let sql = "";
  for (const filter of filters) {
    const keyVar = ctx.varAt(ctx.params.length + 1);
    ctx.params.push(filter.key);
    if (filter.operator === "exists") {
      sql += ` AND ${attributeExistsSubquery(ctx, attrColumn, keyVar, "")}`;
      continue;
    }
    if (filter.operator === "contains") {
      const likeVar = ctx.varAt(ctx.params.length + 1);
      ctx.params.push(
        `%${AnalyticsUtilsEscapeLike((filter.value ?? "").toLowerCase())}%`,
      );
      const condition =
        ctx.dbType === "postgres"
          ? ` AND ${valueSql} ILIKE ${likeVar} ESCAPE '\\'`
          : ` AND LOWER(${valueSql}) LIKE LOWER(${likeVar}) ESCAPE '\\'`;
      sql += ` AND ${attributeExistsSubquery(ctx, attrColumn, keyVar, condition)}`;
      continue;
    }
    const valueVar = ctx.varAt(ctx.params.length + 1);
    ctx.params.push(filter.value ?? "");
    const condition = ` AND ${valueSql} = ${valueVar}`;
    if (filter.operator === "!=") {
      sql += ` AND NOT (${attributeExistsSubquery(ctx, attrColumn, keyVar, condition)})`;
      continue;
    }
    sql += ` AND ${attributeExistsSubquery(ctx, attrColumn, keyVar, condition)}`;
  }
  return sql;
}

// Full-trace duration (MAX(endTime) − MIN(startTime)) for the trace whose root
// row is being filtered. `traceIdRef` is the correlated root column, quoted for
// the target dialect.
export function AnalyticsFiltersDurationSql(
  ctx: AnalyticsSqlContext,
  traceIdRef: string,
  minNs: number | undefined,
  maxNs: number | undefined,
): string {
  let sql = "";
  const q = (ident: string) => (ctx.dbType === "postgres" ? `"${ident}"` : ident);
  const durationSql =
    `(SELECT MAX(d.${q("endTime")}) - MIN(d.${q("startTime")}) FROM traces d ` +
    `WHERE d.${q("traceId")} = ${traceIdRef})`;
  if (minNs !== undefined) {
    sql += ` AND ${durationSql} >= ${ctx.varAt(ctx.params.length + 1)}`;
    ctx.params.push(minNs);
  }
  if (maxNs !== undefined) {
    sql += ` AND ${durationSql} <= ${ctx.varAt(ctx.params.length + 1)}`;
    ctx.params.push(maxNs);
  }
  return sql;
}
