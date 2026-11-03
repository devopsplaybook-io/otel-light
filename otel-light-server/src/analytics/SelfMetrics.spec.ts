jest.mock("../OTelContext", () => {
  const span = {
    end: jest.fn(),
    addEvent: jest.fn(),
    setStatus: jest.fn(),
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

jest.mock("../SignalRollups", () => ({
  SignalRollupsGetAllCounts: jest.fn().mockResolvedValue([]),
}));

import { SignalRollupsGetAllCounts } from "../SignalRollups";
import { SelfMetricsGetRefreshIntervalMs, SelfMetricsInit } from "./SelfMetrics";

const fakeSpan = { end: jest.fn() } as never;

describe("SelfMetricsGetRefreshIntervalMs (M5)", () => {
  it.each([
    [10, 600_000],
    [30, 1_800_000],
    [1, 60_000],
    // 0 is falsy: fall back to the 10 minute default.
    [0, 600_000],
    // Negative values are clamped to the one minute floor.
    [-1, 60_000],
    [Number.NaN, 600_000],
    [undefined, 600_000],
  ])("maps %p minutes to %p ms", (minutes, expectedMs) => {
    expect(SelfMetricsGetRefreshIntervalMs(minutes)).toBe(expectedMs);
  });
});

describe("SelfMetricsInit timer", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("schedules a clamped refresh interval and unrefs the timer", async () => {
    const unref = jest.fn();
    const setIntervalSpy = jest
      .spyOn(global, "setInterval")
      .mockImplementation(
        (() => ({ unref })) as unknown as typeof setInterval,
      );

    await SelfMetricsInit(fakeSpan, {
      METRICS_SELF_REFRESH_MINUTES: 1,
    } as never);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(SignalRollupsGetAllCounts).toHaveBeenCalled();
  });

  it("never schedules a sub-minute loop when the interval is invalid", async () => {
    const setIntervalSpy = jest
      .spyOn(global, "setInterval")
      .mockImplementation(
        (() => ({ unref: jest.fn() })) as unknown as typeof setInterval,
      );

    await SelfMetricsInit(fakeSpan, {
      METRICS_SELF_REFRESH_MINUTES: 0,
    } as never);

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 600_000);
  });
});
