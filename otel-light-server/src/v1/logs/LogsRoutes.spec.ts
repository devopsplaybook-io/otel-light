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
import { LogsRoutes } from "./LogsRoutes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockLogRecord = (overrides = {}) => ({
  timeUnixNano: 1000000000,
  severityText: "INFO",
  body: { stringValue: "request completed" },
  attributes: [],
  ...overrides,
});

const buildBody = (logRecords = [mockLogRecord()]) => ({
  resourceLogs: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "my-svc" } },
          { key: "service.version", value: { stringValue: "1.0.0" } },
        ],
      },
      scopeLogs: [{ scope: {}, logRecords }],
    },
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("LogsRoutes POST /v1/logs", () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    fastify = Fastify();
    await fastify.register(new LogsRoutes().getRoutes, {
      prefix: "/v1/logs",
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
      url: "/v1/logs",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(401);
    expect(DbUtilsNoTelemetryBatchInsert).not.toHaveBeenCalled();
  });

  // --- Success ---
  it("returns 201 on successful ingestion", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(201);
    expect(DbUtilsNoTelemetryBatchInsert).toHaveBeenCalledTimes(1);
  });

  it("passes correct tableCols and numCols to batch insert", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody(),
    });

    const [tableCols, numCols] = (DbUtilsNoTelemetryBatchInsert as jest.Mock)
      .mock.calls[0];
    expect(tableCols).toContain("INTO logs");
    expect(numCols).toBe(9);
  });

  // --- Error handling ---
  it("returns 500 when DB insert throws", async () => {
    (DbUtilsNoTelemetryBatchInsert as jest.Mock).mockRejectedValue(
      new Error("connection refused"),
    );

    const res = await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(500);
  });

  // --- Empty payload ---
  it("handles empty resourceLogs gracefully", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: { resourceLogs: [] },
    });

    expect(res.statusCode).toBe(201);
    expect(DbUtilsNoTelemetryBatchInsert).not.toHaveBeenCalled();
  });

  // --- Log body types ---
  it("extracts stringValue log body correctly", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody([mockLogRecord({ body: { stringValue: "hello" } })]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    // logText is at index 6
    expect(rows[0][6]).toBe("hello");
  });

  it("handles kvlistValue log body", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody([
        mockLogRecord({
          body: {
            kvlistValue: {
              values: [{ key: "event", value: { stringValue: "click" } }],
            },
          },
        }),
      ]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    expect(rows[0][6]).toContain("Key Values:");
    expect(rows[0][6]).toContain("click");
  });

  it("handles unknown log body", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody([mockLogRecord({ body: { intValue: "42" } })]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    expect(rows[0][6]).toContain("Log Object:");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown Log Body"),
    );

    consoleSpy.mockRestore();
  });

  // --- traceId/spanId extraction ---
  it("extracts traceId and spanId from log attributes", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody([
        mockLogRecord({
          attributes: [
            { key: "trace.id", value: { stringValue: "abc123" } },
            { key: "span.id", value: { stringValue: "def456" } },
          ],
        }),
      ]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    // traceId is at index 2, spanId at index 3
    expect(rows[0][2]).toBe("abc123");
    expect(rows[0][3]).toBe("def456");
  });

  it("sets traceId and spanId to null when not present in attributes", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody([mockLogRecord({ attributes: [] })]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    expect(rows[0][2]).toBeNull();
    expect(rows[0][3]).toBeNull();
  });
});
