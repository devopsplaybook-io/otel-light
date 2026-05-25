import Fastify from "fastify";

// ---------------------------------------------------------------------------
// Mocks – must be defined before imports so jest.mock is hoisted
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
import {
  SignalUtilsCheckAuthHeader,
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";
import { TracesRoutes } from "./TracesRoutes";

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
});
