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
  SignalUtilsGetIngestionBodyLimit: jest.fn(),
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
  SignalUtilsGetIngestionBodyLimit,
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";
import { SignalRollupsRecordSignalInsert } from "../../SignalRollups";
import { LogsRoutes } from "./LogsRoutes";

const mockModuleLogger = jest.requireMock<{
  __moduleLogger: { error: jest.Mock; info: jest.Mock; warn: jest.Mock };
}>("../../OTelContext").__moduleLogger;

const BODY_LIMIT = 1_048_576;

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
    // Captured at route registration time.
    (SignalUtilsGetIngestionBodyLimit as jest.Mock).mockReturnValue(BODY_LIMIT);
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
    (SignalUtilsGetIngestionBodyLimit as jest.Mock).mockReturnValue(BODY_LIMIT);
    (SignalUtilsCheckAuthHeader as jest.Mock).mockReturnValue(true);
    (SignalUtilsGetServiceName as jest.Mock).mockReturnValue("my-svc");
    (SignalUtilsGetServiceVersion as jest.Mock).mockReturnValue("1.0.0");
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
      url: "/v1/logs",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(401);
    expect(DbUtilsNoTelemetryBatchInsert).not.toHaveBeenCalled();
    expect(SignalRollupsRecordSignalInsert).not.toHaveBeenCalled();
  });

  // --- Success ---
  it("returns 200 on successful ingestion", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
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
    expect(tableCols).toContain("recordId");
    expect(numCols).toBe(10);
  });

  it("records rollup entries with the log record time", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody([mockLogRecord({ timeUnixNano: 1700000000000000 })]),
    });

    expect(SignalRollupsRecordSignalInsert).toHaveBeenCalledTimes(1);
    const [signalType, entries] = (SignalRollupsRecordSignalInsert as jest.Mock)
      .mock.calls[0];
    expect(signalType).toBe("logs");
    expect(entries).toEqual([
      { serviceName: "my-svc", serviceVersion: "1.0.0", time: 1700000000000000 },
    ]);
  });

  it("still returns 200 when rollup recording fails", async () => {
    (SignalRollupsRecordSignalInsert as jest.Mock).mockRejectedValue(
      new Error("rollup unavailable"),
    );

    const res = await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(mockModuleLogger.error).toHaveBeenCalledWith(
      "Failed to update log rollups",
      expect.any(Error),
    );
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

  // --- Schema validation ---
  it.each([
    ["resourceLogs not an array", { resourceLogs: "nope" }],
    ["scopeLogs not an array", { resourceLogs: [{ scopeLogs: "x" }] }],
    [
      "logRecords not an array",
      { resourceLogs: [{ scopeLogs: [{ logRecords: "x" }] }] },
    ],
  ])("returns 400 for malformed payload (%s)", async (_label, payload) => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload,
    });

    expect(res.statusCode).toBe(400);
    expect(DbUtilsNoTelemetryBatchInsert).not.toHaveBeenCalled();
  });

  // --- Minimal payloads ---
  it("handles empty resourceLogs gracefully", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: { resourceLogs: [] },
    });

    expect(res.statusCode).toBe(200);
    expect(DbUtilsNoTelemetryBatchInsert).not.toHaveBeenCalled();
  });

  it("accepts an empty OTLP payload", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(DbUtilsNoTelemetryBatchInsert).not.toHaveBeenCalled();
  });

  it("accepts a minimal payload without resource or attributes", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: "1700000000000000000",
                    body: { stringValue: "hello" },
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    expect(rows[0][0]).toBe("my-svc");
    expect(rows[0][7]).toBe("[]"); // attributes column
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
    await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody([mockLogRecord({ body: { intValue: "42" } })]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    expect(rows[0][6]).toContain("Log Object:");
    expect(mockModuleLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("Unknown Log Body"),
    );
  });

  // --- traceId/spanId extraction ---
  it("extracts top-level traceId and spanId", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody([
        mockLogRecord({ traceId: "top-trace", spanId: "top-span" }),
      ]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    // traceId is at index 2, spanId at index 3
    expect(rows[0][2]).toBe("top-trace");
    expect(rows[0][3]).toBe("top-span");
  });

  it("falls back to trace.id/span.id attributes", async () => {
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
    expect(rows[0][2]).toBe("abc123");
    expect(rows[0][3]).toBe("def456");
  });

  it("prefers the top-level IDs over the attributes", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody([
        mockLogRecord({
          traceId: "top-trace",
          spanId: "top-span",
          attributes: [
            { key: "trace.id", value: { stringValue: "attr-trace" } },
            { key: "span.id", value: { stringValue: "attr-span" } },
          ],
        }),
      ]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    expect(rows[0][2]).toBe("top-trace");
    expect(rows[0][3]).toBe("top-span");
  });

  it("sets traceId and spanId to null when not present", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody([mockLogRecord({ attributes: [] })]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    expect(rows[0][2]).toBeNull();
    expect(rows[0][3]).toBeNull();
  });

  // --- Content type / body limit ---
  it("returns 415 with protocol guidance for a protobuf payload", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      headers: { "content-type": "application/x-protobuf" },
      payload: Buffer.from([0x0a, 0x00]),
    });

    expect(res.statusCode).toBe(415);
    expect(res.json().message).toContain(
      "OTEL_EXPORTER_OTLP_PROTOCOL=http/json",
    );
    expect(DbUtilsNoTelemetryBatchInsert).not.toHaveBeenCalled();
  });

  it("returns 413 when the payload exceeds the configured body limit", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody([
        mockLogRecord({ body: { stringValue: "x".repeat(BODY_LIMIT + 1_000) } }),
      ]),
    });

    expect(res.statusCode).toBe(413);
    expect(DbUtilsNoTelemetryBatchInsert).not.toHaveBeenCalled();
  });

  it("accepts a large batch under the body limit in one insert call", async () => {
    const logRecords = Array.from({ length: 1_000 }, (_, index) =>
      mockLogRecord({ body: { stringValue: `record-${index}` } }),
    );

    const res = await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody(logRecords),
    });

    expect(res.statusCode).toBe(200);
    expect(DbUtilsNoTelemetryBatchInsert).toHaveBeenCalledTimes(1);
    expect(
      (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2],
    ).toHaveLength(1_000);
  });

  // --- Per-record service name/version override (L3) ---
  it("does not leak a record-level service name override into later records", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/logs",
      payload: buildBody([
        mockLogRecord({
          attributes: [
            { key: "service.name", value: { stringValue: "override-svc" } },
            { key: "service.version", value: { stringValue: "9.9.9" } },
          ],
        }),
        mockLogRecord({ attributes: [] }),
      ]),
    });

    const rows = (DbUtilsNoTelemetryBatchInsert as jest.Mock).mock.calls[0][2];
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe("override-svc");
    expect(rows[0][1]).toBe("9.9.9");
    expect(rows[1][0]).toBe("my-svc");
    expect(rows[1][1]).toBe("1.0.0");
  });
});
