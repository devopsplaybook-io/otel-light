import { describe, expect, it } from "vitest";
import {
  TraceApiLogsUrl,
  TraceApiSpansUrl,
  TraceApiSummaryUrl,
  TraceGroupToAnalyticsParams,
  TraceGroupToTracesQuery,
} from "../services/TraceLinks";

describe("TraceGroupToTracesQuery", () => {
  it("preserves the current filters and narrows to the group service and name", () => {
    const query = TraceGroupToTracesQuery(
      { serviceName: "svc", serviceVersion: "1.0.0", name: "GET /api" },
      { keywords: "old", from: "3600", to: "0", errorsOnly: "true" }
    );
    expect(query).toEqual({
      keywords: "GET /api",
      from: "3600",
      to: "0",
      errorsOnly: "true",
      serviceName: "svc",
      serviceVersion: "1.0.0",
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
    expect(query).toEqual({ serviceName: "svc", keywords: "op" });
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
