import { SpanStatusCode } from "@opentelemetry/api";
import {
  AnalyticsFiltersAttributesSql,
  AnalyticsFiltersDurationSql,
  AnalyticsFiltersFingerprint,
  AnalyticsFiltersKeywordsSql,
  AnalyticsFiltersParse,
  AnalyticsFiltersParseAttributes,
  AnalyticsFiltersParseKeywords,
  AnalyticsFiltersParseStatus,
  ATTRIBUTE_FILTER_MAX_COUNT,
  DURATION_MS_MAX,
} from "./AnalyticsFilters";
import { AnalyticsUtilsGetSQLVariable } from "./AnalyticsUtils";

function newContext(dbType: string) {
  const params: unknown[] = [];
  return {
    dbType,
    params,
    varAt: (index: number) => AnalyticsUtilsGetSQLVariable(dbType, index),
  };
}

describe("AnalyticsFiltersParseKeywords", () => {
  it("splits whitespace-separated terms", () => {
    expect(AnalyticsFiltersParseKeywords("  alpha   beta\tgamma ")).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("keeps quoted phrases with spaces as one term", () => {
    expect(
      AnalyticsFiltersParseKeywords('alpha "connection refused" beta'),
    ).toEqual(["alpha", "connection refused", "beta"]);
  });

  it("lets an unmatched quote run to the end", () => {
    expect(AnalyticsFiltersParseKeywords('alpha "connection ref')).toEqual([
      "alpha",
      "connection ref",
    ]);
  });

  it("joins repeated parameters and ignores empty input", () => {
    expect(AnalyticsFiltersParseKeywords(["a", "b c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(AnalyticsFiltersParseKeywords(undefined)).toEqual([]);
    expect(AnalyticsFiltersParseKeywords("   ")).toEqual([]);
  });
});

describe("AnalyticsFiltersParseAttributes", () => {
  it("parses every operator and keeps values as-is", () => {
    const result = AnalyticsFiltersParseAttributes([
      "http.method:=:GET",
      "tenant:!=:acme",
      "http.url:contains:/api/v1",
      "k8s.pod:exists",
    ]);
    expect(result.error).toBeUndefined();
    expect(result.filters).toEqual([
      { key: "http.method", operator: "=", value: "GET" },
      { key: "tenant", operator: "!=", value: "acme" },
      { key: "http.url", operator: "contains", value: "/api/v1" },
      { key: "k8s.pod", operator: "exists" },
    ]);
  });

  it("keeps colons inside the value", () => {
    const result = AnalyticsFiltersParseAttributes("endpoint:=:https://x:8443");
    expect(result.filters).toEqual([
      { key: "endpoint", operator: "=", value: "https://x:8443" },
    ]);
  });

  it("rejects malformed filters and bad operators", () => {
    expect(AnalyticsFiltersParseAttributes("noop").error).toBeDefined();
    expect(AnalyticsFiltersParseAttributes(":exists").error).toBeDefined();
    expect(AnalyticsFiltersParseAttributes("key:like:x").error).toMatch(
      /operator/,
    );
    expect(AnalyticsFiltersParseAttributes("key:=:").error).toMatch(/value/);
    expect(AnalyticsFiltersParseAttributes("key:exists:x").error).toMatch(
      /exists/,
    );
  });

  it("bounds the number and length of filters", () => {
    const tooMany = Array.from(
      { length: ATTRIBUTE_FILTER_MAX_COUNT + 1 },
      (_, index) => `k${index}:exists`,
    );
    expect(AnalyticsFiltersParseAttributes(tooMany).error).toMatch(/At most/);
    expect(
      AnalyticsFiltersParseAttributes(`k:${"="}:${"x".repeat(5000)}`).error,
    ).toMatch(/at most/);
  });
});

describe("AnalyticsFiltersParse (whole query)", () => {
  it("reads common filters and ignores unknown parameters", () => {
    const result = AnalyticsFiltersParse({
      keywords: "timeout",
      serviceName: " checkout ",
      serviceVersion: "2.0",
      severity: "warning",
      unknown: "x",
    });
    expect(result.error).toBeUndefined();
    expect(result.filters.serviceName).toBe("checkout");
    expect(result.filters.serviceVersion).toBe("2.0");
    expect(result.filters.severity).toBe("WARN");
    expect(result.filters.keywords).toEqual(["timeout"]);
  });

  it("parses trace-only status and duration in milliseconds", () => {
    const result = AnalyticsFiltersParse(
      { status: "error", durationMin: "10", durationMax: "250.5" },
      { traces: true },
    );
    expect(result.filters.status).toBe(SpanStatusCode.ERROR);
    expect(result.filters.durationMinNs).toBe(10_000_000);
    expect(result.filters.durationMaxNs).toBe(250_500_000);
  });

  it("rejects inverted or out-of-range durations", () => {
    expect(
      AnalyticsFiltersParse(
        { durationMin: "20", durationMax: "10" },
        { traces: true },
      ).error,
    ).toMatch(/durationMin/);
    expect(
      AnalyticsFiltersParse(
        { durationMax: String(DURATION_MS_MAX + 1) },
        { traces: true },
      ).error,
    ).toMatch(/Duration/);
    expect(
      AnalyticsFiltersParse({ durationMin: "abc" }, { traces: true }).error,
    ).toMatch(/Duration/);
  });

  it("accepts numeric and word status values only", () => {
    expect(AnalyticsFiltersParseStatus("2").status).toBe(
      SpanStatusCode.ERROR,
    );
    expect(AnalyticsFiltersParseStatus("ok").status).toBe(SpanStatusCode.OK);
    expect(AnalyticsFiltersParseStatus("bogus").error).toBeDefined();
    expect(AnalyticsFiltersParseStatus("").status).toBeUndefined();
  });

  it("changes the fingerprint for every filter dimension", () => {
    const base = AnalyticsFiltersParse({ keywords: "a" }).filters;
    const other = AnalyticsFiltersParse({ keywords: "b" }).filters;
    expect(AnalyticsFiltersFingerprint(base)).not.toBe(
      AnalyticsFiltersFingerprint(other),
    );
    expect(AnalyticsFiltersFingerprint(base)).toBe(
      AnalyticsFiltersFingerprint(AnalyticsFiltersParse({ keywords: "a" }).filters),
    );
  });
});

describe("AnalyticsFiltersKeywordsSql", () => {
  it("appends one escaped AND LIKE per term (sqlite)", () => {
    const ctx = newContext("sqlite");
    const sql = AnalyticsFiltersKeywordsSql(ctx, "keywords", [
      "100%",
      "a_b",
    ]);
    expect(sql).toBe(
      " AND keywords LIKE ? ESCAPE '\\' AND keywords LIKE ? ESCAPE '\\'",
    );
    expect(ctx.params).toEqual(["%100\\%%", "%a\\_b%"]);
  });

  it("numbers the placeholders (postgres)", () => {
    const ctx = newContext("postgres");
    ctx.params.push("already");
    const sql = AnalyticsFiltersKeywordsSql(ctx, '"keywords"', ["timeout"]);
    expect(sql).toBe(' AND "keywords" LIKE $2 ESCAPE \'\\\'');
    expect(ctx.params).toEqual(["already", "%timeout%"]);
  });

  it("returns nothing for an empty term list", () => {
    const ctx = newContext("sqlite");
    expect(AnalyticsFiltersKeywordsSql(ctx, "keywords", [])).toBe("");
  });
});

describe("AnalyticsFiltersAttributesSql", () => {
  it("builds json_each EXISTS predicates with bound values (sqlite)", () => {
    const ctx = newContext("sqlite");
    const sql = AnalyticsFiltersAttributesSql(ctx, "attributes", [
      { key: "http.method", operator: "=", value: "GET" },
      { key: "tenant", operator: "!=", value: "acme" },
      { key: "url", operator: "contains", value: "/API" },
      { key: "pod", operator: "exists" },
    ]);

    expect(sql).toContain(
      "EXISTS (SELECT 1 FROM json_each(attributes) AS je WHERE json_extract(je.value, '$.key') = ? AND COALESCE(json_extract(je.value, '$.value.stringValue')",
    );
    expect(sql).toContain("AND NOT (EXISTS (");
    expect(sql).toContain("LOWER(");
    expect(sql.match(/json_extract\(je\.value, '\$\.key'\) = \?/g)).toHaveLength(
      4,
    );
    // key, value, key, value, key, pattern, key
    expect(ctx.params).toEqual([
      "http.method",
      "GET",
      "tenant",
      "acme",
      "url",
      "%/api%",
      "pod",
    ]);
  });

  it("builds jsonb_array_elements predicates with placeholders (postgres)", () => {
    const ctx = newContext("postgres");
    const sql = AnalyticsFiltersAttributesSql(ctx, 'traces."attributes"', [
      { key: "http.method", operator: "=", value: "GET" },
      { key: "url", operator: "contains", value: "/API" },
    ]);
    expect(sql).toContain(
      "EXISTS (SELECT 1 FROM jsonb_array_elements(traces.\"attributes\"::jsonb) AS je(elem) WHERE je.elem->>'key' = $1 AND COALESCE(je.elem #>> '{value,stringValue}'",
    );
    expect(sql).toContain("ILIKE $4 ESCAPE '\\'");
    expect(ctx.params).toEqual(["http.method", "GET", "url", "%/api%"]);
  });

  it("maps bool attributes in sqlite to the same text as JSONB", () => {
    const ctx = newContext("sqlite");
    const sql = AnalyticsFiltersAttributesSql(ctx, "attributes", [
      { key: "sampled", operator: "=", value: "true" },
    ]);
    expect(sql).toContain("WHEN 1 THEN 'true' WHEN 0 THEN 'false'");
  });

  it("returns nothing for an empty attribute list", () => {
    const ctx = newContext("sqlite");
    expect(AnalyticsFiltersAttributesSql(ctx, "attributes", [])).toBe("");
  });
});

describe("AnalyticsFiltersDurationSql", () => {
  it("filters on the full-trace duration with both bounds (sqlite)", () => {
    const ctx = newContext("sqlite");
    const sql = AnalyticsFiltersDurationSql(
      ctx,
      "traces.traceId",
      1_000_000,
      5_000_000,
    );
    expect(sql).toBe(
      " AND (SELECT MAX(d.endTime) - MIN(d.startTime) FROM traces d WHERE d.traceId = traces.traceId) >= ?" +
        " AND (SELECT MAX(d.endTime) - MIN(d.startTime) FROM traces d WHERE d.traceId = traces.traceId) <= ?",
    );
    expect(ctx.params).toEqual([1_000_000, 5_000_000]);
  });

  it("quotes the camelCase columns (postgres)", () => {
    const ctx = newContext("postgres");
    const sql = AnalyticsFiltersDurationSql(
      ctx,
      'traces."traceId"',
      undefined,
      5_000_000,
    );
    expect(sql).toContain(
      'SELECT MAX(d."endTime") - MIN(d."startTime") FROM traces d WHERE d."traceId" = traces."traceId"',
    );
    expect(sql).not.toContain(">=");
    expect(sql).toContain("<= $1");
  });

  it("adds no predicate without bounds", () => {
    const ctx = newContext("sqlite");
    expect(
      AnalyticsFiltersDurationSql(ctx, "traces.traceId", undefined, undefined),
    ).toBe("");
  });
});
