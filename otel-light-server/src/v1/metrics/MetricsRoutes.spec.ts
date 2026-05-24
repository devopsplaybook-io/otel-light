import Fastify from "fastify";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock("../../utils-std-ts/DbUtilsNoTelemetry", () => ({
  DbUtilsNoTelemetryBatchInsert: jest.fn(),
}));

jest.mock("../../OTelContext", () => ({
  OTelLogger: () => ({
    createModuleLogger: () => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    }),
  }),
}));

jest.mock("../SignalUtils", () => ({
  SignalUtilsCheckAuthHeader: jest.fn(),
  SignalUtilsGetServiceName: jest.fn(),
  SignalUtilsGetServiceVersion: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import { DbUtilsNoTelemetryBatchInsert } from "../../utils-std-ts/DbUtilsNoTelemetry";
import { SignalUtilsCheckAuthHeader } from "../SignalUtils";
import { MetricsRoutes } from "./MetricsRoutes";

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
    (DbUtilsNoTelemetryBatchInsert as jest.Mock).mockResolvedValue(1);
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

  it("uses current time as timeUnixNano in the row", async () => {
    const before = Date.now() * 1_000_000;

    await fastify.inject({
      method: "POST",
      url: "/v1/metrics",
      payload: buildBody(),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    // time is at index 4
    const rowTime = rows[0][4] as number;
    const after = Date.now() * 1_000_000;
    expect(rowTime).toBeGreaterThanOrEqual(before);
    expect(rowTime).toBeLessThanOrEqual(after);
  });
});
