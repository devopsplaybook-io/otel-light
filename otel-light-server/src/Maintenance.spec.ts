jest.mock("./OTelContext", () => {
  const span = {
    end: jest.fn(),
    setStatus: jest.fn(),
    addEvent: jest.fn(),
  };
  const moduleLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    OTelLogger: () => ({ createModuleLogger: () => moduleLogger }),
    OTelTracer: () => ({ startSpan: () => span }),
    OTelMeter: () => ({ createObservableGauge: jest.fn() }),
  };
});

jest.mock("./utils-std-ts/DbUtils", () => ({
  DbUtilsExecSQL: jest.fn(),
  DbUtilsQuerySQL: jest.fn(),
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

import { MaintenanceRollupReconcileDue } from "./Maintenance";

describe("MaintenanceRollupReconcileDue (M4)", () => {
  const now = Date.parse("2026-11-03T00:00:00.000Z");

  it("is due when no previous run is recorded", () => {
    expect(MaintenanceRollupReconcileDue(null, now)).toBe(true);
  });

  it("is due when the stored timestamp is invalid", () => {
    expect(MaintenanceRollupReconcileDue("not-a-date", now)).toBe(true);
  });

  it("is not due before the 24 h interval", () => {
    const lastRun = new Date(now - 23 * 3_600_000).toISOString();
    expect(MaintenanceRollupReconcileDue(lastRun, now)).toBe(false);
  });

  it("is due at/after the 24 h interval", () => {
    const lastRun = new Date(now - 25 * 3_600_000).toISOString();
    expect(MaintenanceRollupReconcileDue(lastRun, now)).toBe(true);
  });

  it("is not due for a future timestamp (clock skew)", () => {
    const lastRun = new Date(now + 3_600_000).toISOString();
    expect(MaintenanceRollupReconcileDue(lastRun, now)).toBe(false);
  });

  it("honours a custom interval", () => {
    const lastRun = new Date(now - 2 * 3_600_000).toISOString();
    expect(MaintenanceRollupReconcileDue(lastRun, now, 1)).toBe(true);
    expect(MaintenanceRollupReconcileDue(lastRun, now, 3)).toBe(false);
  });
});
