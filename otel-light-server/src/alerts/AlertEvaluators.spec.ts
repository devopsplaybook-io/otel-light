jest.mock("../OTelContext", () => {
  const span = {
    end: jest.fn(),
    setStatus: jest.fn(),
    addEvent: jest.fn(),
    setAttribute: jest.fn(),
    setAttributes: jest.fn(),
  };
  const moduleLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const tracer = { startSpan: () => span };
  const logger = {
    createModuleLogger: () => moduleLogger,
    initOTel: jest.fn(),
  };
  return {
    OTelTracer: () => tracer,
    OTelLogger: () => logger,
    OTelMeter: () => undefined,
    OTelSetTracer: jest.fn(),
    OTelSetMeter: jest.fn(),
    OTelRequestSpan: () => span,
  };
});

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsQuerySQL: jest.fn(),
  DbUtilsExecSQL: jest.fn(),
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

import { OTelTracer } from "../OTelContext";
import { DbUtilsQuerySQL } from "../utils-std-ts/DbUtils";
import {
  AlertComparisonMatches,
  AlertMetricAggregate,
  AlertMetricValuesFromRaw,
  AlertRuleEvaluate,
} from "./AlertEvaluators";
import { AlertRuleNormalize } from "./AlertRules";

const span = () => OTelTracer().startSpan("test");
const queryMock = DbUtilsQuerySQL as jest.Mock;

const nowMs = 1_800_000_000_000;
const nowNs = nowMs * 1_000_000;

const logRule = (overrides: Record<string, unknown> = {}) =>
  AlertRuleNormalize({
    id: "r1",
    serviceName: "svc-a",
    threshold: 2,
    periodHours: 1,
    enabled: true,
    ...overrides,
  });

const metricRow = (values: { value: number; offsetMs: number }[], type = "gauge") => {
  const dataPoints = values.map((entry) => ({
    asDouble: entry.value,
    timeUnixNano: String(nowNs - entry.offsetMs * 1_000_000),
  }));
  return {
    time: String(nowNs - values[0].offsetMs * 1_000_000),
    type,
    rawMetric: JSON.stringify({ name: "m", [type]: { dataPoints } }),
  };
};

describe("AlertRuleEvaluate log-count", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("counts ERROR and FATAL by default and breaches when above the threshold", async () => {
    queryMock.mockResolvedValue([{ count: 3 }]);

    const result = await AlertRuleEvaluate(span(), logRule(), nowMs);

    expect(result).toMatchObject({
      value: 3,
      threshold: 2,
      breached: true,
      signalType: "logs",
      signalPath: "/logs",
    });
    const [sql, params] = queryMock.mock.calls[0].slice(1);
    expect(sql).toContain("severity IN (?, ?)");
    expect(sql).toContain("serviceName = ?");
    expect(params.length).toBe(5);
    expect(params.slice(2)).toEqual(["ERROR", "FATAL", "svc-a"]);
  });

  it("does not breach when the count equals the threshold", async () => {
    queryMock.mockResolvedValue([{ count: 2 }]);
    const result = await AlertRuleEvaluate(span(), logRule(), nowMs);
    expect(result.breached).toBe(false);
  });

  it("honours a custom severity subset and omits the service filter when global", async () => {
    queryMock.mockResolvedValue([{ count: 1 }]);

    await AlertRuleEvaluate(
      span(),
      logRule({ serviceName: "", severities: ["FATAL"] }),
      nowMs,
    );

    const [sql, params] = queryMock.mock.calls[0].slice(1);
    expect(sql).not.toContain("serviceName");
    expect(params.slice(2)).toEqual(["FATAL"]);
  });
});

describe("AlertRuleEvaluate metric-threshold", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const metricRule = (overrides: Record<string, unknown> = {}) =>
    AlertRuleNormalize({
      id: "m1",
      serviceName: "svc-a",
      type: "metric-threshold",
      metricName: "cpu.usage",
      threshold: 10,
      periodHours: 1,
      enabled: true,
      ...overrides,
    });

  it("uses the most recent data point for last", async () => {
    // Rows come newest first (SQL ORDER BY time DESC).
    queryMock.mockResolvedValue([
      metricRow([{ value: 25, offsetMs: 60_000 }]),
      metricRow([{ value: 15, offsetMs: 120_000 }]),
    ]);

    const result = await AlertRuleEvaluate(span(), metricRule(), nowMs);

    expect(result).toMatchObject({ value: 25, threshold: 10, breached: true });
    const [sql, params] = queryMock.mock.calls[0].slice(1);
    expect(sql).toContain("FROM metrics");
    expect(sql).toContain("name = ?");
    expect(params.slice(2)).toEqual(["cpu.usage", "svc-a"]);
  });

  it("computes avg, max and min aggregations", async () => {
    queryMock.mockResolvedValue([
      metricRow([{ value: 30, offsetMs: 30_000 }]),
      metricRow([{ value: 6, offsetMs: 60_000 }]),
      metricRow([{ value: 9, offsetMs: 90_000 }]),
    ]);

    const avg = await AlertRuleEvaluate(
      span(),
      metricRule({ aggregation: "avg", threshold: 15 }),
      nowMs,
    );
    expect(avg.value).toBe(15);
    expect(avg.breached).toBe(false);

    const max = await AlertRuleEvaluate(
      span(),
      metricRule({ aggregation: "max", threshold: 30 }),
      nowMs,
    );
    expect(max.value).toBe(30);
    expect(max.breached).toBe(false);

    const min = await AlertRuleEvaluate(
      span(),
      metricRule({ aggregation: "min", comparison: ">=", threshold: 9 }),
      nowMs,
    );
    expect(min.value).toBe(6);
    expect(min.breached).toBe(false);
  });

  it("never breaches without numeric data", async () => {
    queryMock.mockResolvedValue([]);
    const result = await AlertRuleEvaluate(span(), metricRule(), nowMs);
    expect(result.value).toBeNull();
    expect(result.breached).toBe(false);
    expect(result.message).toContain("No numeric data");
  });

  it("ignores summary metrics and data points outside the window", async () => {
    queryMock.mockResolvedValue([
      {
        time: String(nowNs),
        type: "summary",
        rawMetric: JSON.stringify({
          summary: { dataPoints: [{ sum: 50, count: 2 }] },
        }),
      },
      metricRow([{ value: 99, offsetMs: 2 * 3_600_000 }]),
    ]);
    const result = await AlertRuleEvaluate(span(), metricRule(), nowMs);
    expect(result.value).toBeNull();
  });

  it("reads histogram sums", async () => {
    queryMock.mockResolvedValue([
      {
        time: String(nowNs - 60_000_000_000),
        type: "histogram",
        rawMetric: JSON.stringify({
          histogram: {
            dataPoints: [{ sum: 42, timeUnixNano: String(nowNs - 60_000_000_000) }],
          },
        }),
      },
    ]);
    const result = await AlertRuleEvaluate(span(), metricRule(), nowMs);
    expect(result.value).toBe(42);
  });

  it("supports asInt gauge values and every comparison", () => {
    expect(
      AlertMetricValuesFromRaw(
        {
          gauge: {
            dataPoints: [{ asInt: 7, timeUnixNano: String(nowNs) }],
          },
        },
        nowNs,
      ),
    ).toEqual([{ time: nowNs, value: 7 }]);

    const values = [3, 1, 2];
    expect(AlertMetricAggregate(values, "last")).toBe(2);
    expect(AlertMetricAggregate(values, "avg")).toBe(2);
    expect(AlertMetricAggregate(values, "max")).toBe(3);
    expect(AlertMetricAggregate(values, "min")).toBe(1);
    expect(AlertMetricAggregate([], "last")).toBeNull();
    expect(AlertComparisonMatches(5, ">", 5)).toBe(false);
    expect(AlertComparisonMatches(5, ">=", 5)).toBe(true);
    expect(AlertComparisonMatches(4, "<", 5)).toBe(true);
    expect(AlertComparisonMatches(5, "<=", 5)).toBe(true);
  });
});

describe("AlertRuleEvaluate trace-errors", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const traceRule = (overrides: Record<string, unknown> = {}) =>
    AlertRuleNormalize({
      id: "t1",
      serviceName: "svc-a",
      type: "trace-errors",
      threshold: 30,
      periodHours: 1,
      enabled: true,
      ...overrides,
    });

  it("computes the error rate percentage", async () => {
    queryMock.mockResolvedValue([{ total: 10, errors: 4 }]);
    const result = await AlertRuleEvaluate(span(), traceRule(), nowMs);
    expect(result).toMatchObject({ value: 40, threshold: 30, breached: true });
    const [sql] = queryMock.mock.calls[0].slice(1);
    expect(sql).toContain("COUNT(DISTINCT traceId)");
  });

  it("computes the error count mode", async () => {
    queryMock.mockResolvedValue([{ total: 10, errors: 4 }]);
    const result = await AlertRuleEvaluate(
      span(),
      traceRule({ mode: "error-count", threshold: 3 }),
      nowMs,
    );
    expect(result.value).toBe(4);
    expect(result.breached).toBe(true);
  });

  it("reports zero with no traces", async () => {
    queryMock.mockResolvedValue([{ total: 0, errors: 0 }]);
    const result = await AlertRuleEvaluate(span(), traceRule(), nowMs);
    expect(result.value).toBe(0);
    expect(result.breached).toBe(false);
  });
});

describe("AlertRuleEvaluate heartbeat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const heartbeatRule = (overrides: Record<string, unknown> = {}) =>
    AlertRuleNormalize({
      id: "h1",
      serviceName: "svc-a",
      type: "heartbeat",
      signalType: "metrics",
      periodHours: 1,
      enabled: true,
      ...overrides,
    });

  it("breaches when no signal was received", async () => {
    queryMock.mockResolvedValue([{ count: 0 }]);
    const result = await AlertRuleEvaluate(span(), heartbeatRule(), nowMs);
    expect(result).toMatchObject({ value: 0, breached: true });
    expect(result.message).toContain("No metrics received");
  });

  it("does not breach when signals were received", async () => {
    queryMock.mockResolvedValue([{ count: 5 }]);
    const result = await AlertRuleEvaluate(span(), heartbeatRule(), nowMs);
    expect(result).toMatchObject({ value: 5, breached: false });
  });

  it("filters by metric name and uses the traces startTime column", async () => {
    queryMock.mockResolvedValue([{ count: 1 }]);

    await AlertRuleEvaluate(
      span(),
      heartbeatRule({ signalType: "metrics", metricName: "probe" }),
      nowMs,
    );
    let [sql, params] = queryMock.mock.calls[0].slice(1);
    expect(sql).toContain("FROM metrics");
    expect(sql).toContain("name = ?");
    expect(params.slice(2)).toEqual(["svc-a", "probe"]);

    await AlertRuleEvaluate(
      span(),
      heartbeatRule({ signalType: "traces", metricName: "" }),
      nowMs,
    );
    [sql] = queryMock.mock.calls[1].slice(1);
    expect(sql).toContain("FROM traces");
    expect(sql).toContain("startTime");
  });
});
