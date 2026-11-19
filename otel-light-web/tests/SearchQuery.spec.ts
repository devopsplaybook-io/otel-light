import { describe, expect, it } from "vitest";
import type {
  SearchQueryState} from "../services/SearchQuery";
import {
  SearchQueryAttributeDecode,
  SearchQueryAttributeEncode,
  SearchQueryEmptyState,
  SearchQueryFromRouteQuery,
  SearchQueryStateFromParams,
  SearchQueryToParams,
  SearchQueryToRouteQuery
} from "../services/SearchQuery";

const TRACE_STATE: SearchQueryState = {
  keywords: '"connection refused" timeout',
  from: 1800,
  to: 0,
  errorsOnly: true,
  status: "error",
  severity: "",
  serviceName: "checkout",
  serviceVersion: "2.0",
  durationMin: "50",
  durationMax: "2500",
  attributes: [
    { key: "http.method", operator: "=", value: "GET" },
    { key: "tenant", operator: "!=", value: "acme" },
    { key: "http.url", operator: "contains", value: "/api/v1" },
    { key: "k8s.pod", operator: "exists", value: "" },
  ],
};

describe("attribute encoding", () => {
  it("round-trips every operator", () => {
    for (const attribute of TRACE_STATE.attributes) {
      expect(SearchQueryAttributeDecode(SearchQueryAttributeEncode(attribute)))
        .toEqual(attribute);
    }
  });

  it("keeps colons inside the value", () => {
    expect(
      SearchQueryAttributeDecode("endpoint:=:https://host:8443"),
    ).toEqual({ key: "endpoint", operator: "=", value: "https://host:8443" });
  });

  it("rejects malformed filters", () => {
    expect(SearchQueryAttributeDecode("broken")).toBeNull();
    expect(SearchQueryAttributeDecode("key:like:x")).toBeNull();
    expect(SearchQueryAttributeDecode("key:=")).toBeNull();
    expect(SearchQueryAttributeDecode(42)).toBeNull();
  });
});

describe("URL round-trip", () => {
  it("restores the full trace filter state from the route query", () => {
    const routeQuery = SearchQueryToRouteQuery(TRACE_STATE, "traces");
    expect(routeQuery.attr).toEqual([
      "http.method:=:GET",
      "tenant:!=:acme",
      "http.url:contains:/api/v1",
      "k8s.pod:exists",
    ]);
    expect(routeQuery.errorsOnly).toBe("true");
    expect(SearchQueryFromRouteQuery(routeQuery, "traces")).toEqual(
      TRACE_STATE,
    );
  });

  it("accepts a single attr query value (no repeated params)", () => {
    const state = SearchQueryFromRouteQuery(
      { attr: "http.method:=:GET" },
      "traces",
    );
    expect(state.attributes).toEqual([
      { key: "http.method", operator: "=", value: "GET" },
    ]);
  });

  it("restores logs filters without trace-only fields", () => {
    const state = SearchQueryToRouteQuery(
      { ...TRACE_STATE, severity: "WARN" },
      "logs",
    );
    expect(state.status).toBeUndefined();
    expect(state.durationMin).toBeUndefined();
    expect(state.attr).toBeUndefined();
    const restored = SearchQueryFromRouteQuery(state, "logs");
    expect(restored.severity).toBe("WARN");
    expect(restored.attributes).toEqual([]);
  });

  it("keeps metrics to the shared fields", () => {
    const routeQuery = SearchQueryToRouteQuery(TRACE_STATE, "metrics");
    expect(Object.keys(routeQuery).sort()).toEqual([
      "from",
      "keywords",
      "serviceName",
    ]);
  });
});

describe("API request parameters", () => {
  it("sends absolute nanosecond bounds and repeated attr params", () => {
    const params = SearchQueryToParams(TRACE_STATE, "traces");
    const from = Number(params.get("from"));
    expect(from).toBeGreaterThan(0);
    expect(params.get("to")).toBeNull();
    expect(params.getAll("attr")).toEqual([
      "http.method:=:GET",
      "tenant:!=:acme",
      "http.url:contains:/api/v1",
      "k8s.pod:exists",
    ]);
    expect(params.get("errorsOnly")).toBe("true");
    expect(params.get("status")).toBe("error");
    expect(params.get("durationMin")).toBe("50");
    expect(params.get("durationMax")).toBe("2500");
  });

  it("omits empty optional parameters", () => {
    const params = SearchQueryToParams(SearchQueryEmptyState(), "traces");
    expect(params.toString()).toBe("");
  });

  it("skips attribute rows without a key", () => {
    const state = {
      ...SearchQueryEmptyState(),
      attributes: [{ key: "", operator: "=" as const, value: "x" }],
    };
    expect(SearchQueryToParams(state, "traces").getAll("attr")).toEqual([]);
  });
});

describe("saved view query restoration", () => {
  it("restores filters and converts the stored window to seconds-ago", () => {
    const nowNs = Date.now() * 1e6;
    const stored = new URLSearchParams({
      from: String(nowNs - 3600 * 1e9),
      keywords: "checkout",
      status: "ok",
      serviceName: "checkout",
    });
    stored.append("attr", "http.method:=:GET");
    const state = SearchQueryStateFromParams(stored.toString(), "traces");
    expect(state.keywords).toBe("checkout");
    expect(state.status).toBe("ok");
    expect(state.serviceName).toBe("checkout");
    expect(state.attributes).toEqual([
      { key: "http.method", operator: "=", value: "GET" },
    ]);
    expect(state.from).toBeGreaterThanOrEqual(3599);
    expect(state.from).toBeLessThanOrEqual(3601);
  });

  it("ignores malformed saved attr entries", () => {
    const state = SearchQueryStateFromParams("attr=broken", "logs");
    expect(state.attributes).toEqual([]);
  });
});
