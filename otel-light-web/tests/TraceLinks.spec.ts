import { describe, expect, it } from "vitest";
import {
  TraceApiLogsUrl,
  TraceApiSpansUrl,
  TraceApiSummaryUrl,
  TraceGroupToAnalyticsParams,
  TraceGroupToTracesQuery,
  TraceLinksTimeWindowQuery,
  TracePagePath,
  TraceReportToTracesQuery,
} from "../services/TraceLinks";

describe("TraceGroupToTracesQuery", () => {
  it("preserves the current filters and narrows to the group service and name", () => {
    const query = TraceGroupToTracesQuery(
      { serviceName: "svc", serviceVersion: "1.0.0", name: "GET /api" },
      { keywords: "old", from: "3600", to: "0", errorsOnly: "true" }
    );
    expect(query).toEqual({
      keywords: "old",
      from: "3600",
      to: "0",
      errorsOnly: "true",
      serviceName: "svc",
      serviceVersion: "1.0.0",
      name: "GET /api",
    });
  });

  it("omits empty serviceVersion and name", () => {
    const query = TraceGroupToTracesQuery(
      { serviceName: "svc", serviceVersion: "", name: "" },
      {}
    );
    expect(query).toEqual({ serviceName: "svc" });
  });

  it("handles a missing current query", () => {
    const query = TraceGroupToTracesQuery(
      { serviceName: "svc", name: "op" },
      null
    );
    expect(query).toEqual({ serviceName: "svc", name: "op" });
  });
});

describe("TraceLinksTimeWindowQuery", () => {
  const nowMs = 1_760_000_000_000;

  it("snaps a half-hour window to the 30 min option", () => {
    expect(
      TraceLinksTimeWindowQuery(nowMs - 30 * 60 * 1000, nowMs, nowMs)
    ).toEqual({ from: String(30 * 60), to: "0" });
  });

  it("snaps upward to the smallest option covering the window", () => {
    // 7 days is not an option: the 10 days one is the smallest superset.
    expect(
      TraceLinksTimeWindowQuery(
        nowMs - 7 * 24 * 60 * 60 * 1000,
        nowMs,
        nowMs
      )
    ).toEqual({ from: String(10 * 24 * 60 * 60), to: "0" });
  });

  it("falls back to the widest option for windows beyond the list", () => {
    const query = TraceLinksTimeWindowQuery(nowMs - 1000 * 24 * 3600 * 1000, nowMs, nowMs);
    expect(query).toEqual({ from: String(99999 * 24 * 60 * 60), to: "0" });
  });

  it("uses the earlier bound when from and to are inverted", () => {
    expect(
      TraceLinksTimeWindowQuery(nowMs, nowMs - 5 * 60 * 1000, nowMs)
    ).toEqual({ from: String(5 * 60), to: "0" });
  });

  it("falls back to the widest option for non-finite bounds", () => {
    expect(TraceLinksTimeWindowQuery(Number.NaN, nowMs, nowMs)).toEqual({
      from: String(99999 * 24 * 60 * 60),
      to: "0",
    });
  });
});

describe("TraceReportToTracesQuery", () => {
  const nowMs = 1_760_000_000_000;

  it("composes the group filters and the report window", () => {
    const query = TraceReportToTracesQuery(
      { serviceName: "svc", serviceVersion: "2.0.0", name: "GET /cart" },
      nowMs - 24 * 3600 * 1000,
      2,
      nowMs
    );
    // The report started 3 days ago: the 5 days option covers it.
    expect(query).toEqual({
      serviceName: "svc",
      serviceVersion: "2.0.0",
      name: "GET /cart",
      from: String(5 * 24 * 60 * 60),
      to: "0",
    });
  });
});

describe("trace API URL helpers", () => {
  const specialId = "a&b#c/d %";
  const encodedId = "a%26b%23c%2Fd%20%25";

  it("encodes the trace id in the summary query value", () => {
    expect(TraceApiSummaryUrl("/api", specialId)).toBe(
      `/api/analytics/traces?traceId=${encodedId}`
    );
  });

  it("encodes the trace id in the spans path segment", () => {
    expect(TraceApiSpansUrl("/api", specialId)).toBe(
      `/api/analytics/traces/${encodedId}/spans`
    );
  });

  it("encodes the trace id in the logs path segment", () => {
    expect(TraceApiLogsUrl("/api", specialId)).toBe(
      `/api/analytics/traces/${encodedId}/logs`
    );
  });

  it("leaves plain ids unchanged", () => {
    expect(TraceApiSummaryUrl("/api", "abc123")).toBe(
      "/api/analytics/traces?traceId=abc123"
    );
    expect(TraceApiSpansUrl("/api", "abc123")).toBe(
      "/api/analytics/traces/abc123/spans"
    );
    expect(TraceApiLogsUrl("/api", "abc123")).toBe(
      "/api/analytics/traces/abc123/logs"
    );
  });
});

describe("TraceGroupToAnalyticsParams", () => {
  it("preserves the active filters and adds the group name", () => {
    const params = TraceGroupToAnalyticsParams(
      { serviceName: "svc", serviceVersion: "1.0.0", name: "GET /api" },
      "keywords=old&errorsOnly=true&from=3600&to=0"
    );
    expect(params.get("keywords")).toBe("old");
    expect(params.get("errorsOnly")).toBe("true");
    expect(params.get("from")).toBe("3600");
    expect(params.get("to")).toBe("0");
    expect(params.get("serviceName")).toBe("svc");
    expect(params.get("serviceVersion")).toBe("1.0.0");
    expect(params.get("name")).toBe("GET /api");
  });

  it("sets an empty serviceVersion but omits an empty name", () => {
    const params = TraceGroupToAnalyticsParams(
      { serviceName: "svc", serviceVersion: "", name: "" },
      ""
    );
    expect(params.get("serviceVersion")).toBe("");
    expect(params.has("name")).toBe(false);
  });

  it("handles a missing current query string", () => {
    const params = TraceGroupToAnalyticsParams(
      { serviceName: "svc", name: "op" },
      undefined
    );
    expect(params.get("serviceName")).toBe("svc");
    expect(params.get("name")).toBe("op");
  });
});

describe("TracePagePath", () => {
  it("encodes special characters in the trace id", () => {
    expect(TracePagePath("a&b#c/d %")).toBe("/traces/a%26b%23c%2Fd%20%25");
  });

  it("leaves a plain id unchanged", () => {
    expect(TracePagePath("abc123")).toBe("/traces/abc123");
  });
});
