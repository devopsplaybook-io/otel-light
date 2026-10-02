import Fastify from "fastify";

// ---------------------------------------------------------------------------
// Mocks – must be defined before imports so jest.mock is hoisted
// ---------------------------------------------------------------------------
jest.mock("../../utils-std-ts/DbUtilsNoTelemetry", () => ({
  DbUtilsNoTelemetryBatchInsert: jest.fn(),
}));

// The logger instance lives inside the factory so every createModuleLogger()
// call (including the route module's import-time call) returns the same object.
jest.mock("../../OTelContext", () => {
  const moduleLogger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  };
  return {
    OTelLogger: () => ({ createModuleLogger: () => moduleLogger }),
    __moduleLogger: moduleLogger,
  };
});

jest.mock("../SignalUtils", () => ({
  SignalUtilsCheckAuthHeader: jest.fn(),
  SignalUtilsGetServiceName: jest.fn(),
  SignalUtilsGetServiceVersion: jest.fn(),
}));

jest.mock("../../SignalRollups", () => ({
  SignalRollupsRecordSignalInsert: jest.fn(),
  SignalRollupsRecordMetricNamesInsert: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import { DbUtilsNoTelemetryBatchInsert } from "../../utils-std-ts/DbUtilsNoTelemetry";
import {
  SignalUtilsCheckAuthHeader,
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";
import {
  SignalRollupsRecordMetricNamesInsert,
  SignalRollupsRecordSignalInsert,
} from "../../SignalRollups";
import { MetricsRoutes } from "./MetricsRoutes";

const mockModuleLogger = jest.requireMock<{
  __moduleLogger: { error: jest.Mock; info: jest.Mock; warn: jest.Mock };
}>("../../OTelContext").__moduleLogger;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockMetric = (overrides = {}) => ({
  name: "http.requests",
  ...overrides,
});

const buildBody = (metrics = [mockMetric()]) => ({
  resourceMetrics: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "my-svc" } },
          { key: "service.version", value: { stringValue: "1.0.0" } },
        ],
      },
      scopeMetrics: [{ scope: {}, metrics }],
    },
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("MetricsRoutes POST /v1/metrics", () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    fastify = Fastify();
    await fastify.register(new MetricsRoutes().getRoutes, {
      prefix: "/v1/metrics",
    });
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (SignalUtilsCheckAuthHeader as jest.Mock).mockReturnValue(true);
    (SignalUtilsGetServiceName as jest.Mock).mockReturnValue("my-svc");
    (SignalUtilsGetServiceVersion as jest.Mock).mockReturnValue("1.0.0");
    (DbUtilsNoTelemetryBatchInsert as jest.Mock).mockResolvedValue(1);
    (SignalRollupsRecordSignalInsert as jest.Mock).mockResolvedValue(
      undefined,
    );
    (SignalRollupsRecordMetricNamesInsert as jest.Mock).mockResolvedValue(
      undefined,
    );
  });

  // --- Auth ---
  it("returns 401 when auth header check fails", async () => {
    (SignalUtilsCheckAuthHeader as jest.Mock).mockReturnValue(false);

    const res = await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(401);
    expect(DbUtilsNoTelemetryBatchInsert).not.toHaveBeenCalled();
    expect(SignalRollupsRecordSignalInsert).not.toHaveBeenCalled();
    expect(SignalRollupsRecordMetricNamesInsert).not.toHaveBeenCalled();
  });

  // --- Success ---
  it("returns 201 on successful ingestion", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(201);
    expect(DbUtilsNoTelemetryBatchInsert).toHaveBeenCalledTimes(1);
  });

  it("passes correct tableCols and numCols to batch insert", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload: buildBody(),
    });

    const [tableCols, numCols] = (DbUtilsNoTelemetryBatchInsert as jest.Mock)
      .mock.calls[0];
    expect(tableCols).toContain("INTO metrics");
    expect(numCols).toBe(8);
  });

  it("records rollup signal and metric-name entries", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload: buildBody([
        mockMetric({
          gauge: { dataPoints: [{ timeUnixNano: 1700000000000000 }] },
        }),
      ]),
    });

    expect(SignalRollupsRecordSignalInsert).toHaveBeenCalledTimes(1);
    const [signalType, entries] = (SignalRollupsRecordSignalInsert as jest.Mock)
      .mock.calls[0];
    expect(signalType).toBe("metrics");
    expect(entries).toEqual([
      { serviceName: "my-svc", serviceVersion: "1.0.0", time: 1700000000000000 },
    ]);

    expect(SignalRollupsRecordMetricNamesInsert).toHaveBeenCalledTimes(1);
    const nameEntries = (SignalRollupsRecordMetricNamesInsert as jest.Mock).mock
      .calls[0][0];
    expect(nameEntries).toEqual([
      {
        serviceName: "my-svc",
        name: "http.requests",
        type: "gauge",
        time: 1700000000000000,
      },
    ]);
  });

  it("still returns 201 when rollup recording fails", async () => {
    (SignalRollupsRecordSignalInsert as jest.Mock).mockRejectedValue(
      new Error("rollup unavailable"),
    );

    const res = await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(201);
    expect(mockModuleLogger.error).toHaveBeenCalledWith(
      "Failed to update metric rollups",
      expect.any(Error),
    );
  });

  // --- Error handling ---
  it("returns 500 when DB insert throws", async () => {
    (DbUtilsNoTelemetryBatchInsert as jest.Mock).mockRejectedValue(
      new Error("deadlock detected"),
    );

    const res = await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(500);
  });

  // --- Schema validation ---
  it.each([
    ["missing resourceMetrics", {}],
    ["resourceMetrics not an array", { resourceMetrics: "nope" }],
    ["missing scopeMetrics", { resourceMetrics: [{}] }],
    [
      "metrics not an array",
      { resourceMetrics: [{ scopeMetrics: [{ metrics: "x" }] }] },
    ],
  ])("returns 400 for malformed payload (%s)", async (_label, payload) => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload,
    });

    expect(res.statusCode).toBe(400);
    expect(DbUtilsNoTelemetryBatchInsert).not.toHaveBeenCalled();
  });

  // --- Empty payload ---
  it("handles empty resourceMetrics gracefully", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload: { resourceMetrics: [] },
    });

    expect(res.statusCode).toBe(201);
    expect(DbUtilsNoTelemetryBatchInsert).not.toHaveBeenCalled();
  });

  // --- Metric types ---
  it.each([
    ["gauge", { gauge: { dataPoints: [{}] } }],
    ["sum", { sum: { dataPoints: [{}] } }],
    ["histogram", { histogram: { dataPoints: [{}] } }],
    ["exponentialHistogram", { exponentialHistogram: { dataPoints: [{}] } }],
    ["summary", { summary: { dataPoints: [{}] } }],
    ["unknown", {}],
  ])("detects metric type '%s'", async (expectedType, typeField) => {
    await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload: buildBody([mockMetric(typeField)]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    // type is at index 3
    expect(rows[0][3]).toBe(expectedType);
  });

  // --- Metric time (M3) ---
  it("uses the data point timeUnixNano when present", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload: buildBody([
        mockMetric({
          gauge: { dataPoints: [{ timeUnixNano: 1700000000000000 }] },
        }),
      ]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    // time is at index 4
    expect(rows[0][4]).toBe(1700000000000000);
  });

  it("prefers the first data point with a usable timeUnixNano", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload: buildBody([
        mockMetric({
          sum: {
            dataPoints: [{}, { timeUnixNano: 1700000000000001 }],
          },
        }),
      ]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    expect(rows[0][4]).toBe(1700000000000001);
  });

  it("keeps a raw string timeUnixNano to preserve full precision", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload: buildBody([
        mockMetric({
          histogram: { dataPoints: [{ timeUnixNano: "1758297000000000001" }] },
        }),
      ]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    expect(rows[0][4]).toBe("1758297000000000001");
  });

  it("falls back to ingestion time when data point times are missing or invalid", async () => {
    const before = Date.now() * 1_000_000;

    await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload: buildBody([
        mockMetric({
          gauge: { dataPoints: [{ timeUnixNano: 0 }, { timeUnixNano: "x" }] },
        }),
      ]),
    });

    const after = Date.now() * 1_000_000;
    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    const rowTime = rows[0][4] as number;
    expect(rowTime).toBeGreaterThanOrEqual(before);
    expect(rowTime).toBeLessThanOrEqual(after);
  });

  it("falls back to ingestion time when no data points are present", async () => {
    const before = Date.now() * 1_000_000;

    await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload: buildBody(),
    });

    const after = Date.now() * 1_000_000;
    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    const rowTime = rows[0][4] as number;
    expect(rowTime).toBeGreaterThanOrEqual(before);
    expect(rowTime).toBeLessThanOrEqual(after);
  });
});
