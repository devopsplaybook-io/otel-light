import Fastify from "fastify";

jest.mock("@devopsplaybook.io/common-utils", () => ({
  ...jest.requireActual("@devopsplaybook.io/common-utils"),
  AuthHasScope: jest.fn(),
}));

jest.mock("../utils-std-ts/DbUtilsNoTelemetry", () => ({
  DbUtilsNoTelemetryQuerySQL: jest.fn(),
}));

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

jest.mock("../OTelContext", () => ({
  OTelTracer: () => ({ startSpan: () => ({ end: jest.fn() }) }),
}));

import { AuthHasScope } from "@devopsplaybook.io/common-utils";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import { AnalyticsExportInit } from "./AnalyticsExport";
import { AnalyticsLogsRoutes } from "./AnalyticsLogsRoutes";
import { AnalyticsTracesRoutes } from "./AnalyticsTracesRoutes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function allowScope(scope: string): void {
  (AuthHasScope as jest.Mock).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_req: unknown, _res: any, requested: string) => {
      if (requested !== scope) {
        throw new Error("Access Denied");
      }
    },
  );
}

function denyAll(): void {
  (AuthHasScope as jest.Mock).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_req: unknown, res: any, scope: string) => {
      res
        .status(403)
        .send({ error: "Access Denied", code: "FORBIDDEN" });
      throw new Error(`Access Denied: ${scope}`);
    },
  );
}

const LOG = {
  time: 1_700_000_000_000_000_000,
  severity: "ERROR",
  serviceName: "checkout",
  serviceVersion: "1.2",
  traceId: "t1",
  spanId: "s1",
  logText: "boom",
  attributes: '[{"key":"http.method","value":{"stringValue":"GET"}}]',
  recordId: "r1",
};

const TRACE = {
  startTime: 1_700_000_000_000_000_000,
  endTime: 1_700_000_000_120_000_000,
  traceId: "t1",
  spanCount: 4,
  name: "GET /pay",
  serviceName: "checkout",
  serviceVersion: "1.2",
  nbErrors: 1,
  attributes: '[{"key":"http.method","value":{"stringValue":"GET"}}]',
};

describe("Streamed analytics export routes", () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    fastify = Fastify();
    await fastify.register(new AnalyticsLogsRoutes().getRoutes, {
      prefix: "/api/analytics/logs",
    });
    await fastify.register(new AnalyticsTracesRoutes().getRoutes, {
      prefix: "/api/analytics/traces",
    });
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    allowScope("logs");
    (DbUtilsNoTelemetryQuerySQL as jest.Mock).mockResolvedValue([]);
  });

  it("requires the matching signal scope", async () => {
    denyAll();
    const logs = await fastify.inject({
      method: "GET",
      url: "/api/analytics/logs/export",
    });
    expect(logs.statusCode).toBe(403);

    allowScope("traces");
    const traces = await fastify.inject({
      method: "GET",
      url: "/api/analytics/traces/export",
    });
    expect(traces.statusCode).toBe(200);
    expect(AuthHasScope).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "traces",
    );
  });

  it("rejects an unknown format and invalid filters", async () => {
    const format = await fastify.inject({
      method: "GET",
      url: "/api/analytics/logs/export?format=xml",
    });
    expect(format.statusCode).toBe(400);
    expect(format.json().error).toMatch(/format/i);

    const attr = await fastify.inject({
      method: "GET",
      url: "/api/analytics/logs/export?attr=broken",
    });
    expect(attr.statusCode).toBe(400);
    expect(DbUtilsNoTelemetryQuerySQL).not.toHaveBeenCalled();
  });

  it("streams CSV logs with the filter applied and export headers", async () => {
    (DbUtilsNoTelemetryQuerySQL as jest.Mock).mockResolvedValueOnce([LOG]);

    const res = await fastify.inject({
      method: "GET",
      url: "/api/analytics/logs/export?format=csv&keywords=boom&attr=http.method:%3D:GET&severity=error",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["content-disposition"]).toContain(
      'attachment; filename="logs-export.csv"',
    );
    expect(res.headers["x-export-format"]).toBe("csv");
    expect(res.headers["x-export-max-rows"]).toBe("100000");
    expect(res.headers["cache-control"]).toBe("no-store");

    const lines = res.body.split("\r\n").filter((line) => line !== "");
    expect(lines[0]).toBe(
      "time,severity,serviceName,serviceVersion,traceId,spanId,logText,attributes",
    );
    expect(lines[1]).toContain("2023-11-14T22:13:20.000Z,ERROR,checkout");

    const [sql, params] = (DbUtilsNoTelemetryQuerySQL as jest.Mock).mock.calls[0];
    expect(sql).toContain("keywords LIKE ?");
    expect(sql).toContain("json_each(attributes)");
    expect(sql).toContain("severity = ?");
    expect(params).toEqual(
      expect.arrayContaining(["%boom%", "http.method", "GET", "ERROR"]),
    );
  });

  it("streams JSONL logs with structured attributes", async () => {
    allowScope("logs");
    (DbUtilsNoTelemetryQuerySQL as jest.Mock).mockResolvedValueOnce([LOG]);

    const res = await fastify.inject({
      method: "GET",
      url: "/api/analytics/logs/export?format=jsonl",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/x-ndjson/);
    const parsed = JSON.parse(res.body.trim());
    expect(parsed.logText).toBe("boom");
    expect(parsed.attributes).toEqual([
      { key: "http.method", value: { stringValue: "GET" } },
    ]);
  });

  it("streams CSV traces with duration filters and attributes", async () => {
    allowScope("traces");
    (DbUtilsNoTelemetryQuerySQL as jest.Mock).mockResolvedValueOnce([TRACE]);

    const res = await fastify.inject({
      method: "GET",
      url: "/api/analytics/traces/export?format=csv&status=error&durationMin=10&durationMax=500&errorsOnly=true",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain(
      'attachment; filename="traces-export.csv"',
    );
    const lines = res.body.split("\r\n").filter((line) => line !== "");
    expect(lines[0]).toBe(
      "traceId,startTime,endTime,duration,serviceName,serviceVersion,name,spanCount,nbErrors,attributes",
    );
    expect(lines[1]).toContain("t1,2023-11-14T22:13:20.000Z,");
    expect(lines[1]).toContain(",120,checkout,1.2,GET /pay,4,1,");

    const [sql, params] = (DbUtilsNoTelemetryQuerySQL as jest.Mock).mock.calls[0];
    expect(sql).toContain("WITH roots AS");
    expect(sql).toContain("statusCode = ?");
    expect(sql).toContain("MAX(d.endTime) - MIN(d.startTime)");
    expect(params).toEqual(
      expect.arrayContaining([10_000_000, 500_000_000, 2]),
    );
  });

  it("probes one more page and marks a capped export as truncated", async () => {
    await AnalyticsExportInit(
      { end: jest.fn() } as unknown as Parameters<
        typeof AnalyticsExportInit
      >[0],
      { ANALYTICS_EXPORT_MAX_ROWS: 1 } as Parameters<
        typeof AnalyticsExportInit
      >[1],
    );
    (DbUtilsNoTelemetryQuerySQL as jest.Mock)
      .mockResolvedValueOnce([LOG])
      .mockResolvedValueOnce([LOG]);

    const res = await fastify.inject({
      method: "GET",
      url: "/api/analytics/logs/export?format=csv",
    });
    expect(res.headers["x-export-max-rows"]).toBe("1");
    expect(res.body).toContain("# export truncated at 1 rows");
    expect(DbUtilsNoTelemetryQuerySQL).toHaveBeenCalledTimes(2);

    // Restore the default cap for the other tests.
    await AnalyticsExportInit(
      { end: jest.fn() } as unknown as Parameters<
        typeof AnalyticsExportInit
      >[0],
      {} as Parameters<typeof AnalyticsExportInit>[1],
    );
  });
});
