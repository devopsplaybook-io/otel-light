import { describe, expect, it } from "vitest";
import {
  HOME_OVERVIEW_WINDOW_SECONDS,
  HomeOverviewBuildModel,
  HomeOverviewWindowNs,
} from "../services/HomeOverview";

describe("HomeOverviewWindowNs", () => {
  it("returns a 24h window ending at now, in nanoseconds", () => {
    const nowMs = 1760000000000;
    const window = HomeOverviewWindowNs(nowMs);
    expect(window.to).toBe(nowMs * 1_000_000);
    expect(window.from).toBe(
      nowMs * 1_000_000 - HOME_OVERVIEW_WINDOW_SECONDS * 1_000_000_000
    );
  });

  it("spans exactly 24 hours", () => {
    const window = HomeOverviewWindowNs(1000);
    expect(window.to - window.from).toBe(24 * 60 * 60 * 1_000_000_000);
  });
});

describe("HomeOverviewBuildModel", () => {
  it("sums log errors from ERROR and FATAL severities", () => {
    const model = HomeOverviewBuildModel({
      logsStats: {
        totalCount: 15,
        severityCounts: { INFO: 10, WARN: 0, ERROR: 3, FATAL: 2 },
      },
      tracesGroups: null,
      metricNamesCount: null,
      servicesCount: null,
      recommendationGeneratedAt: null,
      longestReportGeneratedAt: null,
      mostCalledReportGeneratedAt: null,
    });
    expect(model.logsTotal).toBe(15);
    expect(model.logErrors).toBe(5);
  });

  it("reports zero logs when the stats fetch succeeded empty", () => {
    const model = HomeOverviewBuildModel({
      logsStats: { totalCount: 0, severityCounts: {} },
      tracesGroups: null,
      metricNamesCount: null,
      servicesCount: null,
      recommendationGeneratedAt: null,
      longestReportGeneratedAt: null,
      mostCalledReportGeneratedAt: null,
    });
    expect(model.logsTotal).toBe(0);
    expect(model.logErrors).toBe(0);
  });

  it("sums trace counts and errors over decompressed groups", () => {
    const model = HomeOverviewBuildModel({
      logsStats: null,
      tracesGroups: [
        { traceCount: 4, nbErrors: 1 },
        { traceCount: 6, nbErrors: 0 },
      ],
      metricNamesCount: null,
      servicesCount: null,
      recommendationGeneratedAt: null,
      longestReportGeneratedAt: null,
      mostCalledReportGeneratedAt: null,
    });
    expect(model.tracesTotal).toBe(10);
    expect(model.traceErrors).toBe(1);
  });

  it("keeps null for unavailable sources and passes through available ones", () => {
    const model = HomeOverviewBuildModel({
      logsStats: null,
      tracesGroups: null,
      metricNamesCount: 7,
      servicesCount: 3,
      recommendationGeneratedAt: "2026-10-18T00:00:00.000Z",
      longestReportGeneratedAt: null,
      mostCalledReportGeneratedAt: "2026-10-17T12:00:00.000Z",
    });
    expect(model.logsTotal).toBeNull();
    expect(model.logErrors).toBeNull();
    expect(model.tracesTotal).toBeNull();
    expect(model.traceErrors).toBeNull();
    expect(model.metricSeries).toBe(7);
    expect(model.servicesCount).toBe(3);
  });

  it("builds the scheduled-jobs health list with generatedAt passthrough", () => {
    const model = HomeOverviewBuildModel({
      logsStats: null,
      tracesGroups: null,
      metricNamesCount: null,
      servicesCount: null,
      recommendationGeneratedAt: "2026-10-18T00:00:00.000Z",
      longestReportGeneratedAt: null,
      mostCalledReportGeneratedAt: "2026-10-17T12:00:00.000Z",
    });
    expect(model.jobs).toEqual([
      {
        label: "LLM recommendation",
        generatedAt: "2026-10-18T00:00:00.000Z",
      },
      { label: "Longest traces report", generatedAt: null },
      {
        label: "Most called traces report",
        generatedAt: "2026-10-17T12:00:00.000Z",
      },
    ]);
  });
});
