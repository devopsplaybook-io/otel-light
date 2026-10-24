import Fastify from "fastify";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import {
  SignalIngestionInsertTracesIgnoreDuplicates,
  SignalIngestionRegisterJsonProtocol,
  SignalIngestionSpanKey,
} from "./SignalIngestion";

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsGetType: jest.fn(),
}));

jest.mock("../utils-std-ts/DbUtilsNoTelemetry", () => ({
  DbUtilsNoTelemetryQuerySQL: jest.fn(),
}));

const TABLE_COLS =
  'INTO traces ("traceId", "spanId", "parentSpanId", "name", "serviceName", "serviceVersion", "startTime", "endTime", "statusCode", "attributes", "rawSpan", "keywords")';

const buildRows = (count: number): unknown[][] =>
  Array.from({ length: count }, (_, index) => [
    `trace-${index}`,
    `span-${index}`,
    null,
    "op",
    "svc",
    "1.0",
    1,
    2,
    0,
    "[]",
    "{}",
    "kw",
  ]);

describe("SignalIngestionSpanKey", () => {
  it("builds a distinct key per trace/span pair", () => {
    expect(SignalIngestionSpanKey("a", "b")).toBe("a\u0000b");
    expect(SignalIngestionSpanKey("a", "b")).not.toBe(
      SignalIngestionSpanKey("a", "c"),
    );
    expect(SignalIngestionSpanKey("a", "b")).not.toBe(
      SignalIngestionSpanKey("c", "b"),
    );
  });
});

describe("SignalIngestionRegisterJsonProtocol", () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    fastify = Fastify();
    await fastify.register(async (instance) => {
      SignalIngestionRegisterJsonProtocol(instance);
      instance.post("/", async () => ({}));
    });
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  it("returns 415 with OTLP/JSON guidance for a protobuf content type", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": "application/x-protobuf" },
      payload: Buffer.from([0x0a, 0x00]),
    });

    expect(res.statusCode).toBe(415);
    expect(res.json().message).toContain(
      "OTEL_EXPORTER_OTLP_PROTOCOL=http/json",
    );
    expect(res.json().message).toContain("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL");
  });

  it("still accepts application/json", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/",
      headers: { "content-type": "application/json" },
      payload: { any: "thing" },
    });

    expect(res.statusCode).toBe(200);
  });
});

describe("SignalIngestionInsertTracesIgnoreDuplicates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses INSERT OR IGNORE ... RETURNING on SQLite", async () => {
    (DbUtilsGetType as jest.Mock).mockReturnValue("sqlite");
    (DbUtilsNoTelemetryQuerySQL as jest.Mock).mockResolvedValue([
      { traceId: "trace-0", spanId: "span-0" },
    ]);

    const keys = await SignalIngestionInsertTracesIgnoreDuplicates(
      TABLE_COLS,
      12,
      buildRows(1),
    );

    const [sql, params] = (DbUtilsNoTelemetryQuerySQL as jest.Mock).mock
      .calls[0];
    expect(sql).toContain("INSERT OR IGNORE INTO traces");
    expect(sql).toContain('RETURNING "traceId", "spanId"');
    expect(sql).not.toContain("ON CONFLICT");
    expect(params).toHaveLength(12);
    expect(keys).toEqual(new Set([SignalIngestionSpanKey("trace-0", "span-0")]));
  });

  it("uses ON CONFLICT DO NOTHING ... RETURNING on PostgreSQL", async () => {
    (DbUtilsGetType as jest.Mock).mockReturnValue("postgres");
    (DbUtilsNoTelemetryQuerySQL as jest.Mock).mockResolvedValue([]);

    await SignalIngestionInsertTracesIgnoreDuplicates(
      TABLE_COLS,
      12,
      buildRows(1),
    );

    const [sql] = (DbUtilsNoTelemetryQuerySQL as jest.Mock).mock.calls[0];
    expect(sql).toContain(
      'ON CONFLICT ("traceId", "spanId") DO NOTHING RETURNING "traceId", "spanId"',
    );
    expect(sql).not.toContain("OR IGNORE");
  });

  it("chunks large batches at 500 rows", async () => {
    (DbUtilsGetType as jest.Mock).mockReturnValue("sqlite");
    (DbUtilsNoTelemetryQuerySQL as jest.Mock).mockResolvedValue([]);

    await SignalIngestionInsertTracesIgnoreDuplicates(
      TABLE_COLS,
      12,
      buildRows(501),
    );

    const calls = (DbUtilsNoTelemetryQuerySQL as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toHaveLength(500 * 12);
    expect(calls[1][1]).toHaveLength(12);
  });

  it("does not query the database for an empty batch", async () => {
    (DbUtilsGetType as jest.Mock).mockReturnValue("sqlite");

    const keys = await SignalIngestionInsertTracesIgnoreDuplicates(
      TABLE_COLS,
      12,
      [],
    );

    expect(keys.size).toBe(0);
    expect(DbUtilsNoTelemetryQuerySQL).not.toHaveBeenCalled();
  });
});
