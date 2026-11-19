import { describe, expect, it } from "vitest";
import {
  HOME_OVERVIEW_CELLS_STORAGE_KEY,
  HOME_OVERVIEW_WINDOW_SECONDS,
  HomeOverviewAsOfLabel,
  HomeOverviewBuildModel,
  HomeOverviewCanAccessRecommendation,
  HomeOverviewCellFailure,
  HomeOverviewCellIsLoading,
  HomeOverviewCellSuccess,
  HomeOverviewCellValueText,
  HomeOverviewCellsInitial,
  HomeOverviewCellsLoad,
  HomeOverviewCellsSave,
  HomeOverviewErrorMessage,
  HomeOverviewTraceTotals,
  HomeOverviewWindowNs,
} from "../services/HomeOverview";

describe("home overview cells", () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      values,
    };
  }

  it("starts every cell in the loading state without a value", () => {
    const cells = HomeOverviewCellsInitial();
    for (const cell of Object.values(cells)) {
      expect(cell.status).toBe("loading");
      expect(cell.value).toBeNull();
      expect(HomeOverviewCellIsLoading(cell)).toBe(true);
      expect(HomeOverviewCellValueText(cell)).toBe("unavailable");
    }
  });

  it("renders a fresh success as a value with its detail", () => {
    const cell = HomeOverviewCellSuccess(
      HomeOverviewCellsInitial().logs,
      42,
      3,
      1_760_000_000_000
    );
    expect(cell).toEqual({
      status: "ok",
      value: 42,
      detail: 3,
      fetchedAt: 1_760_000_000_000,
      error: null,
    });
    expect(HomeOverviewCellIsLoading(cell)).toBe(false);
    expect(HomeOverviewCellValueText(cell)).toBe("42");
  });

  it("marks a failed first load as unavailable and keeps the error", () => {
    const cell = HomeOverviewCellFailure(
      HomeOverviewCellsInitial().traces,
      "backend unavailable"
    );
    expect(cell.status).toBe("error");
    expect(cell.value).toBeNull();
    expect(cell.error).toBe("backend unavailable");
    expect(HomeOverviewCellIsLoading(cell)).toBe(false);
    expect(HomeOverviewCellValueText(cell)).toBe("unavailable");
  });

  it("keeps the last-known value and timestamp when a refresh fails", () => {
    const loaded = HomeOverviewCellSuccess(
      HomeOverviewCellsInitial().traces,
      12,
      0,
      1_760_000_000_000
    );
    const failed = HomeOverviewCellFailure(loaded, "timeout");
    expect(failed.status).toBe("error");
    expect(failed.value).toBe(12);
    expect(failed.fetchedAt).toBe(1_760_000_000_000);
    expect(failed.error).toBe("timeout");
    expect(HomeOverviewCellValueText(failed)).toBe("12");
    expect(HomeOverviewAsOfLabel(failed.fetchedAt!)).toBe(
      HomeOverviewAsOfLabel(1_760_000_000_000)
    );
  });

  it("formats the fetched-at label as local hours and minutes", () => {
    const fetchedAt = new Date(2026, 10, 19, 9, 5).getTime();
    expect(HomeOverviewAsOfLabel(fetchedAt)).toBe("as of 09:05");
    expect(HomeOverviewAsOfLabel(Number.NaN)).toBe("");
  });

  it("normalizes errors to a readable message", () => {
    expect(HomeOverviewErrorMessage(new Error("boom"))).toBe("boom");
    expect(HomeOverviewErrorMessage("text")).toBe("Request failed");
    expect(HomeOverviewErrorMessage({})).toBe("Request failed");
  });

  it("round-trips the last-known values through storage", () => {
    const storage = memoryStorage();
    const cells = HomeOverviewCellsInitial();
    cells.logs = HomeOverviewCellSuccess(cells.logs, 15, 2, 1_000);
    cells.services = HomeOverviewCellSuccess(cells.services, 4, null, 2_000);
    HomeOverviewCellsSave(storage, cells);

    const loaded = HomeOverviewCellsLoad(storage);
    expect(loaded.logs).toMatchObject({ status: "ok", value: 15, detail: 2, fetchedAt: 1_000 });
    expect(loaded.services).toMatchObject({ status: "ok", value: 4, detail: null, fetchedAt: 2_000 });
    expect(loaded.traces.status).toBe("loading");
    expect(loaded.metrics.status).toBe("loading");
  });

  it("ignores corrupt or partial stored payloads", () => {
    expect(HomeOverviewCellsLoad(memoryStorage({
      [HOME_OVERVIEW_CELLS_STORAGE_KEY]: "not json",
    })).logs.status).toBe("loading");

    const loaded = HomeOverviewCellsLoad(memoryStorage({
      [HOME_OVERVIEW_CELLS_STORAGE_KEY]: JSON.stringify({
        logs: { value: 5 },
        traces: { value: "nope", fetchedAt: 10 },
        metrics: { value: 7, fetchedAt: 20 },
      }),
    }));
    expect(loaded.logs.status).toBe("loading");
    expect(loaded.traces.status).toBe("loading");
    expect(loaded.metrics).toMatchObject({ status: "ok", value: 7, fetchedAt: 20 });
  });

  it("never throws when the storage is unavailable", () => {
    const failing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(() => HomeOverviewCellsLoad(failing)).not.toThrow();
    const cells = HomeOverviewCellsInitial();
    cells.logs = HomeOverviewCellSuccess(cells.logs, 1, null, 10);
    expect(() => HomeOverviewCellsSave(failing, cells)).not.toThrow();
  });

  it("sums summary groups and reports unavailable groups as null", () => {
    expect(HomeOverviewTraceTotals(null)).toEqual({
      tracesTotal: null,
      traceErrors: null,
    });
    expect(HomeOverviewTraceTotals([])).toEqual({
      tracesTotal: 0,
      traceErrors: 0,
    });
    expect(
      HomeOverviewTraceTotals([
        { traceCount: 4, nbErrors: 1 },
        { traceCount: 6, nbErrors: 0 },
      ])
    ).toEqual({ tracesTotal: 10, traceErrors: 1 });
  });
});

describe("HomeOverviewCanAccessRecommendation", () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])("traces=%p logs=%p -> %p", (hasTraces, hasLogs, expected) => {
    expect(HomeOverviewCanAccessRecommendation(hasTraces, hasLogs)).toBe(
      expected
    );
  });
});

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
