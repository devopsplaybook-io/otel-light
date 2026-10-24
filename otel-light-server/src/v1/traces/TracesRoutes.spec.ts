import Fastify from "fastify";

// ---------------------------------------------------------------------------
// Mocks – must be defined before imports so jest.mock is hoisted
// ---------------------------------------------------------------------------

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

jest.mock("../SignalIngestion", () => {
  const actual = jest.requireActual("../SignalIngestion");
  return {
    ...actual,
    SignalIngestionInsertTracesIgnoreDuplicates: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import {
  SignalUtilsCheckAuthHeader,
  SignalUtilsGetIngestionBodyLimit,
  SignalUtilsGetServiceName,
  SignalUtilsGetServiceVersion,
} from "../SignalUtils";
import { SignalRollupsRecordSignalInsert } from "../../SignalRollups";
import {
  SignalIngestionInsertTracesIgnoreDuplicates,
  SignalIngestionSpanKey,
} from "../SignalIngestion";
import { TracesRoutes } from "./TracesRoutes";

const mockModuleLogger = jest.requireMock<{
  __moduleLogger: { error: jest.Mock; info: jest.Mock; warn: jest.Mock };
}>("../../OTelContext").__moduleLogger;

const BODY_LIMIT = 1_048_576;

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
    // Captured at route registration time.
    (SignalUtilsGetIngestionBodyLimit as jest.Mock).mockReturnValue(BODY_LIMIT);
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
    // Default: every row is inserted (no duplicates).
    (SignalIngestionInsertTracesIgnoreDuplicates as jest.Mock).mockImplementation(
      async (_tableCols: string, _numCols: number, rows: unknown[][]) =>
        new Set(rows.map((row) => SignalIngestionSpanKey(row[0], row[1]))),
    );
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
    expect(SignalIngestionInsertTracesIgnoreDuplicates).not.toHaveBeenCalled();
    expect(SignalRollupsRecordSignalInsert).not.toHaveBeenCalled();
  });

  // --- Success ---
  it("returns 200 on successful ingestion", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
    expect(SignalIngestionInsertTracesIgnoreDuplicates).toHaveBeenCalledTimes(
      1,
    );
  });

  it("passes correct tableCols and numCols to the insert helper", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody(),
    });

    const [tableCols, numCols] = (
      SignalIngestionInsertTracesIgnoreDuplicates as jest.Mock
    ).mock.calls[0];
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

    const rows = (
      SignalIngestionInsertTracesIgnoreDuplicates as jest.Mock
    ).mock.calls[0][2];
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

  it("does not record rollups for spans ignored as duplicates on replay", async () => {
    (SignalIngestionInsertTracesIgnoreDuplicates as jest.Mock).mockResolvedValue(
      new Set<string>(),
    );

    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(SignalIngestionInsertTracesIgnoreDuplicates).toHaveBeenCalledTimes(
      1,
    );
    expect(SignalRollupsRecordSignalInsert).toHaveBeenCalledWith("traces", []);
  });

  it("counts an intra-batch duplicate only once in the rollups", async () => {
    await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody([mockSpan(), mockSpan()]),
    });

    const [, entries] = (SignalRollupsRecordSignalInsert as jest.Mock).mock
      .calls[0];
    expect(entries).toHaveLength(1);
  });

  it("still returns 200 when rollup recording fails", async () => {
    (SignalRollupsRecordSignalInsert as jest.Mock).mockRejectedValue(
      new Error("rollup unavailable"),
    );

    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(mockModuleLogger.error).toHaveBeenCalledWith(
      "Failed to update trace rollups",
      expect.any(Error),
    );
  });

  // --- Error handling ---
  it("returns 500 when the DB insert throws", async () => {
    (SignalIngestionInsertTracesIgnoreDuplicates as jest.Mock).mockRejectedValue(
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
    ["resourceSpans not an array", { resourceSpans: "nope" }],
    ["scopeSpans not an array", { resourceSpans: [{ scopeSpans: "x" }] }],
    ["spans not an array", { resourceSpans: [{ scopeSpans: [{ spans: "x" }] }] }],
  ])("returns 400 for malformed payload (%s)", async (_label, payload) => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload,
    });

    expect(res.statusCode).toBe(400);
    expect(SignalIngestionInsertTracesIgnoreDuplicates).not.toHaveBeenCalled();
  });

  // --- Minimal payloads ---
  it("handles empty resourceSpans gracefully", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: { resourceSpans: [] },
    });

    expect(res.statusCode).toBe(200);
    expect(SignalIngestionInsertTracesIgnoreDuplicates).not.toHaveBeenCalled();
  });

  it("accepts an empty OTLP payload", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(SignalIngestionInsertTracesIgnoreDuplicates).not.toHaveBeenCalled();
  });

  it("accepts a minimal payload without resource, attributes or status", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: "min-trace",
                    spanId: "min-span",
                    startTimeUnixNano: "1700000000000000000",
                    endTimeUnixNano: "1700000000000001000",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const rows = (
      SignalIngestionInsertTracesIgnoreDuplicates as jest.Mock
    ).mock.calls[0][2];
    expect(rows[0][0]).toBe("min-trace");
    expect(rows[0][2]).toBeNull(); // parentSpanId
    expect(rows[0][3]).toBe(""); // name
    expect(rows[0][8]).toBe(0); // statusCode
    expect(rows[0][9]).toBe("[]"); // attributes
  });

  // --- Partial success ---
  it("returns partialSuccess and stores only valid spans", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody([
        mockSpan({ traceId: "valid", spanId: "valid-1" }),
        mockSpan({ traceId: "invalid", spanId: "" }),
      ]),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      partialSuccess: {
        rejectedSpans: "1",
        errorMessage: expect.any(String),
      },
    });
    const rows = (
      SignalIngestionInsertTracesIgnoreDuplicates as jest.Mock
    ).mock.calls[0][2];
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("valid");
  });

  it("returns partialSuccess with no insert when every span is rejected", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody([
        mockSpan({ spanId: "" }),
        mockSpan({ startTimeUnixNano: 0 }),
      ]),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      partialSuccess: {
        rejectedSpans: "2",
        errorMessage: expect.any(String),
      },
    });
    expect(SignalIngestionInsertTracesIgnoreDuplicates).not.toHaveBeenCalled();
  });

  // --- Content type / body limit ---
  it("returns 415 with protocol guidance for a protobuf payload", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      headers: { "content-type": "application/x-protobuf" },
      payload: Buffer.from([0x0a, 0x00]),
    });

    expect(res.statusCode).toBe(415);
    expect(res.json().message).toContain(
      "OTEL_EXPORTER_OTLP_PROTOCOL=http/json",
    );
    expect(SignalIngestionInsertTracesIgnoreDuplicates).not.toHaveBeenCalled();
  });

  it("returns 413 when the payload exceeds the configured body limit", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody([mockSpan({ name: "x".repeat(BODY_LIMIT + 1_000) })]),
    });

    expect(res.statusCode).toBe(413);
    expect(SignalIngestionInsertTracesIgnoreDuplicates).not.toHaveBeenCalled();
  });

  it("accepts a large batch under the body limit in one insert call", async () => {
    const spans = Array.from({ length: 1_000 }, (_, index) =>
      mockSpan({ traceId: `big-trace-${index}`, spanId: `big-span-${index}` }),
    );

    const res = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
      payload: buildBody(spans),
    });

    expect(res.statusCode).toBe(200);
    expect(SignalIngestionInsertTracesIgnoreDuplicates).toHaveBeenCalledTimes(
      1,
    );
    expect(
      (SignalIngestionInsertTracesIgnoreDuplicates as jest.Mock).mock
        .calls[0][2],
    ).toHaveLength(1_000);
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

    const rows = (
      SignalIngestionInsertTracesIgnoreDuplicates as jest.Mock
    ).mock.calls[0][2];
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

    const rows = (
      SignalIngestionInsertTracesIgnoreDuplicates as jest.Mock
    ).mock.calls[0][2];
    expect(rows[0][4]).toBe("span-svc");
    expect(rows[0][5]).toBe("2.0.0");
    expect(rows[1][4]).toBe("my-svc");
    expect(rows[1][5]).toBe("1.0.0");
  });
});
