import { AnalyticsStatsCacheBuildKey } from "./AnalyticsStatsCache";

describe("AnalyticsStatsCacheBuildKey", () => {
  it("keeps the historical stats key for the default arguments", () => {
    expect(
      AnalyticsStatsCacheBuildKey(10, 20, "svc", "1.0", true, "kw", true),
    ).toBe(JSON.stringify([10, 20, "svc", "1.0", "1", "kw", "1"]));
  });

  it("includes the exact name filter", () => {
    const withoutName = AnalyticsStatsCacheBuildKey(
      10,
      20,
      "svc",
      "1.0",
      true,
    );
    const withName = AnalyticsStatsCacheBuildKey(
      10,
      20,
      "svc",
      "1.0",
      true,
      undefined,
      false,
      "GET /a",
    );
    expect(withName).not.toBe(withoutName);
    expect(withName).toContain("name:GET /a");
  });

  it("namespaces the summary mode and cannot collide with a stats name", () => {
    const summary = AnalyticsStatsCacheBuildKey(
      10,
      20,
      "svc",
      "1.0",
      false,
      undefined,
      false,
      undefined,
      "summary",
    );
    const statsNamedSummary = AnalyticsStatsCacheBuildKey(
      10,
      20,
      "svc",
      "1.0",
      false,
      undefined,
      false,
      "summary",
    );
    expect(summary).not.toBe(statsNamedSummary);
    expect(summary).toContain("mode:summary");
    expect(statsNamedSummary).not.toContain("mode:summary");
  });

  it("keeps stats and summary keys distinct for identical filters", () => {
    const stats = AnalyticsStatsCacheBuildKey(10, 20, "svc", "1.0", true);
    const summary = AnalyticsStatsCacheBuildKey(
      10,
      20,
      "svc",
      "1.0",
      true,
      undefined,
      false,
      undefined,
      "summary",
    );
    expect(stats).not.toBe(summary);
  });
});
