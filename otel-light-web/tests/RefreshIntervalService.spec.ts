import { afterEach, describe, expect, it } from "vitest";
import {
  MetricsRefreshIntervalOptions,
  RefreshIntervalOptions,
  RefreshIntervalService,
} from "../services/RefreshIntervalService";

afterEach(() => {
  localStorage.clear();
});

describe("RefreshIntervalService", () => {
  it("uses a fast default for traces/logs and a slow default for metrics", () => {
    expect(RefreshIntervalService.get()).toBe("10000");
    expect(RefreshIntervalService.getMetrics()).toBe("300000");
  });

  it("stores the two intervals under independent keys", () => {
    RefreshIntervalService.set("30000");
    expect(RefreshIntervalService.get()).toBe("30000");
    expect(RefreshIntervalService.getMetrics()).toBe("300000");

    RefreshIntervalService.setMetrics("900000");
    expect(RefreshIntervalService.get()).toBe("30000");
    expect(RefreshIntervalService.getMetrics()).toBe("900000");
  });

  it("offers the stored defaults among the selectable options", () => {
    expect(RefreshIntervalOptions.map((o) => o.value)).toContain(
      RefreshIntervalService.get(),
    );
    expect(MetricsRefreshIntervalOptions.map((o) => o.value)).toContain(
      RefreshIntervalService.getMetrics(),
    );
  });
});
