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
import { SignalRollupsRecordSignalInsert } from "../../SignalRollups";
import { TracesRoutes } from "./TracesRoutes";

const mockModuleLogger = jest.requireMock<{
  __moduleLogger: { error: jest.Mock; info: jest.Mock; warn: jest.Mock };
}>("../../OTelContext").__moduleLogger;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockSpan = (overrides = {}) => ({
  traceId: "trace-1",
  spanId: "span-1",
  parentSpanId: null,
  name: "GET /api",
  startTimeUnixNano: 1000000000,
  endTimeUnixNano: 2000000000,
  status: { code: 0 },
  attributes: [],
  ...overrides,
});

const buildBody = (spans = [mockSpan()]) => ({
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "my-svc" } },
          { key: "service.version", value: { stringValue: "1.0.0" } },
        ],
      },
      scopeSpans: [{ scope: {}, spans }],
    },
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("TracesRoutes POST /v1/traces", () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    fastify = Fastify();
    await fastify.register(new TracesRoutes().getRoutes, {
      prefix: "/v1/traces",
    });
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock returns for SignalUtils
    (SignalUtilsCheckAuthHeader as jest.Mock).mockReturnValue(true);
    (SignalUtilsGetServiceName as jest.Mock).mockReturnValue("my-svc");
    (SignalUtilsGetServiceVersion as jest.Mock).mockReturnValue("1.0.0");
    // Default: DB insert succeeds
    (DbUtilsNoTelemetryBatchInsert as jest.Mock).mockResolvedValue(1);
    (SignalRollupsRecordSignalInsert as jest.Mock).mockResolvedValue(
      undefined,
    );
  });

  // --- Auth ---
  it("returns 401 when auth header check fails", async () => {
    (SignalUtilsCheckAuthHeader as jest.Mock).mockReturnValue(false);

    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(401);
    expect(DbUtilsNoTelemetryBatchInsert).not.toHaveBeenCalled();
    expect(SignalRollupsRecordSignalInsert).not.toHaveBeenCalled();
  });

  // --- Success ---
  it("returns 201 on successful ingestion", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(201);
    expect(DbUtilsNoTelemetryBatchInsert).toHaveBeenCalledTimes(1);
  });

  it("passes correct tableCols and numCols to batch insert", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody(),
    });

    const [tableCols, numCols] = (DbUtilsNoTelemetryBatchInsert as jest.Mock)
      .mock.calls[0];
    expect(tableCols).toContain("INTO traces");
    expect(numCols).toBe(12);
  });

  it("includes all span rows in the batch parameters", async () => {
    const spans = [mockSpan({ traceId: "t1" }), mockSpan({ traceId: "t2" })];
    await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody(spans),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe("t1");
    expect(rows[1][0]).toBe("t2");
  });

  it("records rollup entries with the span start time", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody([mockSpan({ startTimeUnixNano: 1700000000000000 })]),
    });

    expect(SignalRollupsRecordSignalInsert).toHaveBeenCalledTimes(1);
    const [signalType, entries] = (SignalRollupsRecordSignalInsert as jest.Mock)
      .mock.calls[0];
    expect(signalType).toBe("traces");
    expect(entries).toEqual([
      { serviceName: "my-svc", serviceVersion: "1.0.0", time: 1700000000000000 },
    ]);
  });

  it("still returns 201 when rollup recording fails", async () => {
    (SignalRollupsRecordSignalInsert as jest.Mock).mockRejectedValue(
      new Error("rollup unavailable"),
    );

    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(201);
    expect(mockModuleLogger.error).toHaveBeenCalledWith(
      "Failed to update trace rollups",
      expect.any(Error),
    );
  });

  // --- Error handling ---
  it("returns 500 when DB insert throws", async () => {
    (DbUtilsNoTelemetryBatchInsert as jest.Mock).mockRejectedValue(
      new Error("connection lost"),
    );

    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(500);
  });

  // --- Schema validation ---
  it.each([
    ["missing resourceSpans", {}],
    ["resourceSpans not an array", { resourceSpans: "nope" }],
    ["missing scopeSpans", { resourceSpans: [{}] }],
    ["spans not an array", { resourceSpans: [{ scopeSpans: [{ spans: "x" }] }] }],
  ])("returns 400 for malformed payload (%s)", async (_label, payload) => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload,
    });

    expect(res.statusCode).toBe(400);
    expect(DbUtilsNoTelemetryBatchInsert).not.toHaveBeenCalled();
  });

  // --- Empty payload ---
  it("handles empty resourceSpans gracefully", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: { resourceSpans: [] },
    });

    expect(res.statusCode).toBe(201);
    expect(DbUtilsNoTelemetryBatchInsert).not.toHaveBeenCalled();
  });

  // --- Service name/version override from span attributes ---
  it("uses service name/version from span attributes when present", async () => {
    const span = mockSpan({
      attributes: [
        { key: "service.name", value: { stringValue: "span-svc" } },
        { key: "service.version", value: { stringValue: "2.0.0" } },
      ],
    });

    await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody([span]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    // serviceName is at index 4, serviceVersion at index 5
    expect(rows[0][4]).toBe("span-svc");
    expect(rows[0][5]).toBe("2.0.0");
  });

  // --- Per-span service name/version override (L3) ---
  it("does not leak a span-level service name override into later spans", async () => {
    const spans = [
      mockSpan({
        traceId: "t1",
        attributes: [
          { key: "service.name", value: { stringValue: "span-svc" } },
          { key: "service.version", value: { stringValue: "2.0.0" } },
        ],
      }),
      mockSpan({ traceId: "t2", attributes: [] }),
    ];

    await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody(spans),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    expect(rows[0][4]).toBe("span-svc");
    expect(rows[0][5]).toBe("2.0.0");
    expect(rows[1][4]).toBe("my-svc");
    expect(rows[1][5]).toBe("1.0.0");
  });
});
