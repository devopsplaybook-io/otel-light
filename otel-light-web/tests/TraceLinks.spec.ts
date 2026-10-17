import { describe, expect, it } from "vitest";
import { TraceGroupToTracesQuery } from "../services/TraceLinks";

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
