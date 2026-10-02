import Fastify from "fastify";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import * as util from "util";
import * as zlib from "zlib";

const gunzip = util.promisify(zlib.gunzip);

// ---------------------------------------------------------------------------
// Mocks: only the auth helpers are replaced; the DB layer stays real so the
// tests exercise the actual SQL against a temporary SQLite database seeded
// through the real migrations (catches placeholder/param-order bugs that
// mocked DB tests cannot see).
// ---------------------------------------------------------------------------
jest.mock("@devopsplaybook.io/common-utils", () => {
  const actual = jest.requireActual("@devopsplaybook.io/common-utils");
  return {
    ...actual,
    AuthGetUserSession: jest.fn(),
    AuthHasScope: jest.fn(),
    AuthMustBeAdmin: jest.fn(),
  };
});

// Minimal OTel stubs: spans and loggers do nothing, but the modules under test
// can create and use them freely.
jest.mock("./OTelContext", () => {
  const span = {
    end: jest.fn(),
    setStatus: jest.fn(),
    addEvent: jest.fn(),
    setAttribute: jest.fn(),
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

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import {
  AuthGetUserSession,
  AuthHasScope,
  AuthMustBeAdmin,
} from "@devopsplaybook.io/common-utils";
import {
  DbUtilsExecSQL,
  DbUtilsInit,
  DbUtilsQuerySQL,
  DbUtilsSetOTel,
} from "./utils-std-ts/DbUtils";
import { DbUtilsNoTelemetrySetLogger } from "./utils-std-ts/DbUtilsNoTelemetry";
import { OTelLogger, OTelTracer } from "./OTelContext";
import { AnalyticsLogsRoutes } from "./analytics/AnalyticsLogsRoutes";
import { AnalyticsStatsRoutes } from "./analytics/AnalyticsStatsRoutes";
import { AnalyticsTracesRoutes } from "./analytics/AnalyticsTracesRoutes";
import { SettingsRoutes } from "./settings/SettingsRoutes";
import { MaintenanceInit } from "./Maintenance";
import {
  SignalRollupsGetAllCounts,
  SignalRollupsGetMetricNames,
  SignalRollupsGetServicesAndVersions,
  SignalRollupsRecordMetricNameDeletion,
  SignalRollupsRecordMetricNamesInsert,
  SignalRollupsRecordSignalDeletion,
  SignalRollupsRecordSignalInsert,
} from "./SignalRollups";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const testSpan = (): Loose => OTelTracer().startSpan("test");

const runSql = async (sql: string, params: unknown[] = []): Promise<number> =>
  DbUtilsExecSQL(testSpan(), sql, params);

const query = async (sql: string, params: unknown[] = []): Promise<Loose[]> =>
  DbUtilsQuerySQL(testSpan(), sql, params);

const decodeB64Json = async (payload: string): Promise<Loose> =>
  JSON.parse((await gunzip(Buffer.from(payload, "base64"))).toString("utf8"));

const waitFor = async (
  condition: () => Promise<boolean>,
  timeoutMs = 5000,
): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
};

const insertLog = (
  serviceName: string,
  serviceVersion: string,
  severity: string,
  time: number,
  logText: string,
  keywords: string,
  recordId: string,
) =>
  runSql(
    'INSERT INTO logs ("serviceName", "serviceVersion", "severity", "time", "logText", "attributes", "keywords", "traceId", "spanId", "recordId") VALUES (?,?,?,?,?,?,?,?,?,?)',
    [
      serviceName,
      serviceVersion,
      severity,
      time,
      logText,
      "[]",
      keywords,
      null,
      null,
      recordId,
    ],
  );

const insertTrace = (
  traceId: string,
  spanId: string,
  parentSpanId: string | null,
  name: string,
  startTime: number,
  endTime: number,
  statusCode: number,
  serviceName = "trace-svc",
  serviceVersion = "1.0",
  keywords = "",
) =>
  runSql(
    'INSERT INTO traces ("traceId", "spanId", "parentSpanId", "name", "serviceName", "serviceVersion", "startTime", "endTime", "statusCode", "attributes", "rawSpan", "keywords") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      traceId,
      spanId,
      parentSpanId,
      name,
      serviceName,
      serviceVersion,
      startTime,
      endTime,
      statusCode,
      "[]",
      "{}",
      keywords ||
        `${serviceName}:${serviceVersion} ${name} ${traceId} ${spanId} ${parentSpanId}`.toLowerCase(),
    ],
  );

const insertMetric = (
  name: string,
  serviceName: string,
  serviceVersion: string,
  type: string,
  time: number,
) =>
  runSql(
    'INSERT INTO metrics ("name", "serviceName", "serviceVersion", "type", "time", "attributes", "rawMetric", "keywords") VALUES (?,?,?,?,?,?,?,?)',
    [name, serviceName, serviceVersion, type, time, "[]", "{}", name],
  );

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("SQL-level integration (sqlite)", () => {
  let fastify: ReturnType<typeof Fastify>;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "otel-light-sql-"));
    DbUtilsSetOTel(OTelTracer(), OTelLogger());
    DbUtilsNoTelemetrySetLogger(OTelLogger());
    await DbUtilsInit(
      testSpan(),
      { DATA_DIR: dataDir, DATABASE_TYPE: "sqlite" } as unknown as Parameters<
        typeof DbUtilsInit
      >[1],
      path.join(__dirname, "../sql/sqlite"),
    );

    fastify = Fastify();
    await fastify.register(new AnalyticsTracesRoutes().getRoutes, {
      prefix: "/api/analytics/traces",
    });
    await fastify.register(new AnalyticsLogsRoutes().getRoutes, {
      prefix: "/api/analytics/logs",
    });
    await fastify.register(new AnalyticsStatsRoutes().getRoutes, {
      prefix: "/api/analytics",
    });
    await fastify.register(new SettingsRoutes().getRoutes, {
      prefix: "/api/settings",
    });
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
    await fs.remove(dataDir);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: true,
      user: { id: "test", role: "admin", scopes: ["traces", "metrics", "logs"] },
    });
    (AuthHasScope as jest.Mock).mockResolvedValue(undefined);
    (AuthMustBeAdmin as jest.Mock).mockResolvedValue(undefined);
  });

  // =========================================================================
  // Migrations
  // =========================================================================
  describe("Database migrations", () => {
    it("applies all migrations up to version 11 and creates the rollup tables", async () => {
      const versionRows = await query(
        "SELECT MAX(value) AS maxVersion FROM metadata WHERE type = 'db_version'",
        [],
      );
      expect(Number(versionRows[0].maxVersion)).toBe(11);

      const tableRows = await query(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
        [],
      );
      const tableNames = tableRows.map((row) => row.name);
      expect(tableNames).toEqual(
        expect.arrayContaining([
          "traces",
          "metrics",
          "logs",
          "settings",
          "signal_service_counts",
          "signal_metric_names",
          "maintenance_state",
        ]),
      );

      const indexRows = await query(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_settings_category'",
        [],
      );
      expect(indexRows.length).toBe(1);
    });
  });

  // =========================================================================
  // Maintenance (runs first so the initial recount sees the seeded raw rows)
  // =========================================================================
  describe("Maintenance end-to-end", () => {
    it("recounts rollups, applies retention, compresses duplicates and writes the watermark", async () => {
      const nowNs = Date.now() * 1_000_000;
      const oldTraceStart = nowNs - 48 * 3600 * 1_000_000_000;
      const freshTraceStart = nowNs - 60 * 1_000_000_000;
      const metricBase =
        Math.floor((nowNs - 2 * 3600 * 1_000_000_000) / 60_000_000_000) *
          60_000_000_000 +
        20_000_000_000;

      await insertTrace(
        "maint-tr-old",
        "s-old-1",
        null,
        "old-op",
        oldTraceStart,
        oldTraceStart + 1_000_000_000,
        0,
        "maint-svc",
        "1.0",
        "maint-svc:1.0 maint-svc 1.0 old-op maint-tr-old maintcleanup",
      );
      await insertTrace(
        "maint-tr-fresh",
        "s-fresh-1",
        null,
        "fresh-op",
        freshTraceStart,
        freshTraceStart + 1_000_000_000,
        0,
        "maint-svc",
      );
      // Three duplicate metric points (same name/service/minute bucket).
      for (const offset of [0, 1_000_000_000, 2_000_000_000]) {
        await insertMetric(
          "dup-metric",
          "maint-svc",
          "1.0",
          "gauge",
          metricBase + offset,
        );
      }
      // Two old traces carrying the scoped-pattern keyword; only the one
      // belonging to the rule's service may be deleted.
      await insertTrace(
        "sco-tr-old",
        "s-old-2",
        null,
        "scoped-op",
        oldTraceStart,
        oldTraceStart + 1_000_000_000,
        0,
        "scoped-svc",
        "1.0",
        "scoped-svc:1.0 sco-tr-old cleanme-scoped",
      );
      await insertTrace(
        "sco-tr-keep",
        "s-keep-1",
        null,
        "keep-op",
        oldTraceStart,
        oldTraceStart + 1_000_000_000,
        0,
        "sco-keep-svc",
        "1.0",
        "sco-keep-svc:1.0 sco-tr-keep cleanme-scoped",
      );
      await insertLog(
        "scoped-log-svc",
        "1.0",
        "info",
        oldTraceStart,
        "sl1",
        "scoped-log-svc:1.0 cleanme-log",
        "rec-scoped-1",
      );
      await insertLog(
        "sco-keep-log-svc",
        "1.0",
        "info",
        oldTraceStart,
        "sl2",
        "sco-keep-log-svc:1.0 cleanme-log",
        "rec-scoped-2",
      );
      await runSql("INSERT INTO settings (category, content) VALUES (?, ?)", [
        "signal-cleanup-rules",
        JSON.stringify({
          deleteRules: [
            { signalType: "traces", pattern: "maintcleanup", periodHours: 24 },
            {
              signalType: "traces",
              pattern: "cleanme-scoped",
              periodHours: 24,
              serviceName: "scoped-svc",
            },
            // No matching service: exercises the metrics delta builder with a
            // serviceName without deleting anything.
            {
              signalType: "metrics",
              pattern: "cleanme-metric",
              periodHours: 24,
              serviceName: "no-such-service",
            },
            {
              signalType: "logs",
              pattern: "cleanme-log",
              periodHours: 24,
              serviceName: "scoped-log-svc",
            },
          ],
        }),
      ]);

      await MaintenanceInit(testSpan(), {
        MAINTENANCE_FREQUENCY_HOURS: 1,
        MAINTENANCE_ORPHAN_LOOKBACK_HOURS: 24,
        METRICS_COMPRESS_MINUTE_THRESHOLD_HOURS: 1,
        METRICS_COMPRESS_HOUR_THRESHOLD_DAYS: 30,
      } as unknown as Parameters<typeof MaintenanceInit>[1]);

      const done = await waitFor(async () => {
        const rows = await query(
          "SELECT stateValue FROM maintenance_state WHERE stateKey = ?",
          ["metrics-compress-minute-hwm"],
        );
        return rows.length > 0;
      });
      expect(done).toBe(true);

      // Retention: the 48h-old unscoped trace was deleted, the fresh one kept;
      // the scoped rule deleted only its service's trace (sco-tr-keep stays).
      const traceIds = (
        await query("SELECT traceId FROM traces ORDER BY traceId", [])
      ).map((row) => row.traceId);
      expect(traceIds).toEqual(["maint-tr-fresh", "sco-tr-keep"]);

      // Compression: one row per (name, service, minute bucket) kept.
      const metricCount = await query("SELECT COUNT(*) AS c FROM metrics", []);
      expect(Number(metricCount[0].c)).toBe(1);

      // Rollups decremented accordingly: traces 2 -> 1, metrics 3 -> 1.
      const counts = await SignalRollupsGetAllCounts();
      const tracesRollup = counts.find(
        (row) => row.signalType === "traces" && row.serviceName === "maint-svc",
      );
      expect(tracesRollup?.count).toBe(1);
      const metricsRollup = counts.find(
        (row) => row.signalType === "metrics" && row.serviceName === "maint-svc",
      );
      expect(metricsRollup?.count).toBe(1);

      // Metric-name rollup decremented as well (3 -> 1).
      const nameRows = await query(
        "SELECT count FROM signal_metric_names WHERE serviceName = ? AND name = ?",
        ["maint-svc", "dup-metric"],
      );
      expect(Number(nameRows[0].count)).toBe(1);

      // Scoped rules: the serviceName filter must be applied to both the
      // delta query and the delete, and a scoped rule must not abort the
      // remaining ones (regression: a params/placeholders mismatch threw on
      // the first serviceName rule and skipped every rule after it).
      const scopedLogCount = await query(
        "SELECT COUNT(*) AS c FROM logs WHERE serviceName = ?",
        ["scoped-log-svc"],
      );
      expect(Number(scopedLogCount[0].c)).toBe(0);
      const keepLogCount = await query(
        "SELECT COUNT(*) AS c FROM logs WHERE serviceName = ?",
        ["sco-keep-log-svc"],
      );
      expect(Number(keepLogCount[0].c)).toBe(1);

      const scopedRollups = await SignalRollupsGetAllCounts();
      expect(
        scopedRollups.find(
          (row) =>
            row.signalType === "traces" && row.serviceName === "scoped-svc",
        ),
      ).toBeUndefined();
      expect(
        scopedRollups.find(
          (row) =>
            row.signalType === "logs" && row.serviceName === "scoped-log-svc",
        ),
      ).toBeUndefined();
      expect(
        scopedRollups.find(
          (row) =>
            row.signalType === "traces" && row.serviceName === "sco-keep-svc",
        )?.count,
      ).toBe(1);
    });
  });

  // =========================================================================
  // Analytics logs API
  // =========================================================================
  describe("Analytics logs API", () => {
    // 5 minutes ago; all rows share timestamp T except rec-d.
    const T = Date.now() * 1_000_000 - 300_000_000_000;
    const to = T + 10_000_000_000;

    beforeAll(async () => {
      await insertLog(
        "log-svc",
        "1.0",
        "error",
        T,
        "a",
        "log-svc:1.0 log-svc 1.0 error",
        "rec-a",
      );
      await insertLog(
        "log-svc",
        "1.0",
        "info",
        T,
        "b",
        "log-svc:1.0 log-svc 1.0 info",
        "rec-b",
      );
      await insertLog(
        "log-svc",
        "1.0",
        "info",
        T,
        "c",
        "log-svc:1.0 log-svc 1.0 info",
        "rec-c",
      );
      await insertLog(
        "log-svc",
        "1.0",
        "info",
        T + 1_000_000_000,
        "d",
        "log-svc:1.0 log-svc 1.0 info",
        "rec-d",
      );
    });

    it("returns logs ordered by time DESC, recordId DESC", async () => {
      // serviceName-scoped so other describe blocks' seed data stays invisible
      const res = await fastify.inject({
        method: "GET",
        url: `/api/analytics/logs?from=0&to=${to}&serviceName=log-svc`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.compressed).toBe(true);
      const logs = await decodeB64Json(body.logs);
      expect(logs.map((log: Loose) => log.recordId)).toEqual([
        "rec-d",
        "rec-c",
        "rec-b",
        "rec-a",
      ]);
      expect(logs[0].serviceName).toBe("log-svc");
      expect(logs[0].attributes).toEqual([]);
    });

    it("uses the composite before cursor without skipping equal timestamps", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/analytics/logs?from=0&to=${to}&serviceName=log-svc&before=${T}&beforeRecordId=rec-c`,
      });
      expect(res.statusCode).toBe(200);
      const logs = await decodeB64Json(res.json().logs);
      expect(logs.map((log: Loose) => log.recordId)).toEqual([
        "rec-b",
        "rec-a",
      ]);
    });

    it("uses the composite after cursor for refresh including equal timestamps", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/analytics/logs?from=0&to=${to}&serviceName=log-svc&afterTime=${T}&afterRecordId=rec-a`,
      });
      expect(res.statusCode).toBe(200);
      const logs = await decodeB64Json(res.json().logs);
      expect(logs.map((log: Loose) => log.recordId)).toEqual([
        "rec-d",
        "rec-c",
        "rec-b",
      ]);
    });
  });

  // =========================================================================
  // Analytics traces API
  // =========================================================================
  describe("Analytics traces API", () => {
    // 10 minutes ago; tr-a and tr-b share the same startTime.
    const T2 = Date.now() * 1_000_000 - 600_000_000_000;
    const from = T2 - 1_000_000_000;
    const to = T2 + 200_000_000_000;

    beforeAll(async () => {
      await insertTrace(
        "tr-a",
        "s-a1",
        null,
        "op-a",
        T2,
        T2 + 50_000_000_000,
        0,
      );
      await insertTrace(
        "tr-a",
        "s-a2",
        "s-a1",
        "op-a-child",
        T2 + 1_000_000_000,
        T2 + 2_000_000_000,
        2,
      );
      await insertTrace(
        "tr-b",
        "s-b1",
        null,
        "op-b",
        T2,
        T2 + 30_000_000_000,
        0,
      );
      await insertTrace(
        "tr-c",
        "s-c1",
        null,
        "op-c",
        T2 + 100_000_000_000,
        T2 + 150_000_000_000,
        0,
      );
    });

    it("lists traces ordered by startTime DESC, traceId DESC with aggregates", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/analytics/traces?from=${from}&to=${to}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const traces = await decodeB64Json(body.traces);
      expect(traces.map((trace: Loose) => trace.traceId)).toEqual([
        "tr-c",
        "tr-b",
        "tr-a",
      ]);
      const traceA = traces.find((trace: Loose) => trace.traceId === "tr-a");
      expect(traceA.spanCount).toBe(2);
      expect(traceA.nbErrors).toBe(1);
      const traceB = traces.find((trace: Loose) => trace.traceId === "tr-b");
      expect(traceB.spanCount).toBe(1);
      expect(traceB.nbErrors).toBe(0);
    });

    it("uses the composite before cursor without skipping equal start times", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/analytics/traces?from=${from}&to=${to}&before=${T2}&beforeTraceId=tr-b`,
      });
      expect(res.statusCode).toBe(200);
      const traces = await decodeB64Json(res.json().traces);
      expect(traces.map((trace: Loose) => trace.traceId)).toEqual(["tr-a"]);
    });

    it("uses the composite after cursor for refresh including equal start times", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/analytics/traces?from=${from}&to=${to}&afterTime=${T2}&afterTraceId=tr-a`,
      });
      expect(res.statusCode).toBe(200);
      const traces = await decodeB64Json(res.json().traces);
      expect(traces.map((trace: Loose) => trace.traceId)).toEqual([
        "tr-c",
        "tr-b",
      ]);
    });

    it("filters to traces having an error span when errorsOnly is set", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/analytics/traces?from=${from}&to=${to}&errorsOnly=true`,
      });
      expect(res.statusCode).toBe(200);
      const traces = await decodeB64Json(res.json().traces);
      expect(traces.map((trace: Loose) => trace.traceId)).toEqual(["tr-a"]);
    });

    it("returns the spans of a trace ordered by start time", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/analytics/traces/tr-a/spans",
      });
      expect(res.statusCode).toBe(200);
      const spans = res.json().spans;
      expect(spans.map((span: Loose) => span.spanId)).toEqual([
        "s-a1",
        "s-a2",
      ]);
    });
  });

  // =========================================================================
  // Analytics logs stats (regression: sqlite placeholder order)
  // =========================================================================
  describe("Analytics logs stats", () => {
    // Fixed past timestamp far above any other seeded row (year ~2033) so the
    // stats queries cannot see rows from the other test groups.
    const t0 = 2_000_000_000_000_000_000;
    const bucketNs = 3_600_000_000_000;

    beforeAll(async () => {
      await insertLog(
        "stats-svc",
        "1.0",
        "error",
        t0,
        "s1",
        "stats-svc:1.0 stats-svc 1.0 statstoken error",
        "stats-a",
      );
      await insertLog(
        "stats-svc",
        "1.0",
        "info",
        t0,
        "s2",
        "stats-svc:1.0 stats-svc 1.0 statstoken info",
        "stats-b",
      );
      await insertLog(
        "stats-svc",
        "1.0",
        "info",
        t0 + bucketNs,
        "s3",
        "stats-svc:1.0 stats-svc 1.0 statstoken info",
        "stats-c",
      );
    });

    it("aggregates buckets with the requested bucket size", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/analytics/logs/stats?from=${t0}&to=${t0 + bucketNs}&bucketNs=${bucketNs}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const b0 = Math.floor(t0 / bucketNs) * bucketNs;
      expect(body.totalCount).toBe(3);
      expect(body.severityCounts).toEqual({ ERROR: 1, INFO: 2 });
      expect(body.buckets).toEqual([
        { bucket: b0, severities: { ERROR: 1, INFO: 1 } },
        { bucket: b0 + bucketNs, severities: { INFO: 1 } },
      ]);
    });

    it("applies the severity filter", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/analytics/logs/stats?from=${t0}&severity=ERROR&bucketNs=${bucketNs}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalCount).toBe(1);
      expect(body.severityCounts).toEqual({ ERROR: 1 });
    });

    it("applies the keywords filter", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/analytics/logs/stats?from=${t0}&keywords=STATSTOKEN&bucketNs=${bucketNs}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalCount).toBe(3);
    });
  });

  // =========================================================================
  // Analytics traces stats
  // =========================================================================
  describe("Analytics traces stats", () => {
    const T3 = Date.now() * 1_000_000 - 900_000_000_000;
    const from = T3 - 1_000_000_000;
    const to = T3 + 200_000_000_000;

    beforeAll(async () => {
      await insertTrace(
        "st-a",
        "st-a1",
        null,
        "st-op-a",
        T3,
        T3 + 10_000_000_000,
        0,
        "stats-trace-svc",
      );
      await insertTrace(
        "st-a",
        "st-a2",
        "st-a1",
        "st-op-a-child",
        T3 + 1_000_000_000,
        T3 + 2_000_000_000,
        2,
        "stats-trace-svc",
      );
      await insertTrace(
        "st-b",
        "st-b1",
        null,
        "st-op-b",
        T3 + 50_000_000_000,
        T3 + 60_000_000_000,
        0,
        "stats-trace-svc",
      );
    });

    it("groups root traces by name with span and error aggregates", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/analytics/traces/stats?from=${from}&to=${to}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.compressed).toBe(true);
      const groups = await decodeB64Json(body.groups);
      const groupA = groups.find((group: Loose) => group.name === "st-op-a");
      expect(groupA).toMatchObject({
        serviceName: "stats-trace-svc",
        traceCount: 1,
        avgSpanCount: 2,
        nbErrors: 1,
      });
      const groupB = groups.find((group: Loose) => group.name === "st-op-b");
      expect(groupB).toMatchObject({
        traceCount: 1,
        avgSpanCount: 1,
        nbErrors: 0,
      });
    });
  });

  // =========================================================================
  // Settings API
  // =========================================================================
  describe("Settings API", () => {
    it("upserts a settings category atomically", async () => {
      let res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/unit-test-cat",
        payload: { content: { a: 1 } },
      });
      expect(res.statusCode).toBe(201);

      res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/unit-test-cat",
        payload: { content: { a: 2, b: 3 } },
      });
      expect(res.statusCode).toBe(201);

      const getRes = await fastify.inject({
        method: "GET",
        url: "/api/settings/unit-test-cat",
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().settings.content).toEqual({ a: 2, b: 3 });

      const rows = await query(
        "SELECT category FROM settings WHERE category = ?",
        ["unit-test-cat"],
      );
      expect(rows.length).toBe(1);
    });

    it("rejects a PUT without a content object", async () => {
      let res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/unit-test-cat",
        payload: {},
      });
      expect(res.statusCode).toBe(400);

      res = await fastify.inject({
        method: "PUT",
        url: "/api/settings/unit-test-cat",
        payload: { content: "not-an-object" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // Signal rollups (module-level, against the real tables)
  // =========================================================================
  describe("Signal rollups", () => {
    it("accumulates insert entries and tracks last seen", async () => {
      await SignalRollupsRecordSignalInsert("logs", [
        { serviceName: "rollup-svc", serviceVersion: "9.9", time: 1000 },
      ]);
      await SignalRollupsRecordSignalInsert("logs", [
        { serviceName: "rollup-svc", serviceVersion: "9.9", time: 2000 },
        { serviceName: "rollup-svc", serviceVersion: "9.9", time: 3000 },
      ]);

      const counts = await SignalRollupsGetAllCounts();
      const row = counts.find(
        (entry) =>
          entry.signalType === "logs" && entry.serviceName === "rollup-svc",
      );
      expect(row?.count).toBe(3);

      const { services, serviceVersions } =
        await SignalRollupsGetServicesAndVersions();
      expect(services).toContain("rollup-svc");
      const version = serviceVersions.find(
        (entry) => entry.serviceName === "rollup-svc",
      );
      expect(version?.serviceVersion).toBe("9.9");
      expect(version?.lastSeen).toBe(3000);
    });

    it("decrements and drops a rollup row when the count reaches zero", async () => {
      await SignalRollupsRecordSignalDeletion("logs", [
        { serviceName: "rollup-svc", serviceVersion: "9.9", count: 2 },
      ]);
      let counts = await SignalRollupsGetAllCounts();
      expect(
        counts.find(
          (entry) =>
            entry.signalType === "logs" && entry.serviceName === "rollup-svc",
        )?.count,
      ).toBe(1);

      await SignalRollupsRecordSignalDeletion("logs", [
        { serviceName: "rollup-svc", serviceVersion: "9.9", count: 1 },
      ]);
      counts = await SignalRollupsGetAllCounts();
      expect(
        counts.find(
          (entry) =>
            entry.signalType === "logs" && entry.serviceName === "rollup-svc",
        ),
      ).toBeUndefined();
    });

    it("tracks metric names with first/last seen and drops them once deleted", async () => {
      await SignalRollupsRecordMetricNamesInsert([
        { serviceName: "rollup-svc", name: "requests", type: "gauge", time: 500 },
        { serviceName: "rollup-svc", name: "requests", type: "gauge", time: 900 },
        {
          serviceName: "rollup-svc",
          name: "latency",
          type: "histogram",
          time: 700,
        },
      ]);

      let names = await SignalRollupsGetMetricNames();
      const requests = names.find((entry) => entry.name === "requests");
      expect(requests).toMatchObject({
        serviceName: "rollup-svc",
        type: "gauge",
        firstSeen: 500,
        lastSeen: 900,
      });
      expect(names.find((entry) => entry.name === "latency")).toBeDefined();

      await SignalRollupsRecordMetricNameDeletion([
        { serviceName: "rollup-svc", name: "requests", type: "gauge", count: 2 },
      ]);
      names = await SignalRollupsGetMetricNames();
      expect(names.find((entry) => entry.name === "requests")).toBeUndefined();
      expect(names.find((entry) => entry.name === "latency")).toBeDefined();
    });

    it("lists metric-only services but not their versions", async () => {
      await SignalRollupsRecordSignalInsert("metrics", [
        { serviceName: "metric-only-svc", serviceVersion: "1.0", time: 5 },
      ]);
      const { services, serviceVersions } =
        await SignalRollupsGetServicesAndVersions();
      expect(services).toContain("metric-only-svc");
      expect(
        serviceVersions.find(
          (entry) => entry.serviceName === "metric-only-svc",
        ),
      ).toBeUndefined();
    });
  });

  // =========================================================================
  // Restart: migrations re-run on an up-to-date database
  // =========================================================================
  describe("Restart with an up-to-date database", () => {
    it("re-runs the migrations (second boot) without throwing and keeps the data", async () => {
      const logsBefore = await query("SELECT COUNT(*) AS c FROM logs", []);
      expect(Number(logsBefore[0].c)).toBeGreaterThan(0);

      await DbUtilsInit(
        testSpan(),
        { DATA_DIR: dataDir, DATABASE_TYPE: "sqlite" } as unknown as Parameters<
          typeof DbUtilsInit
        >[1],
        path.join(__dirname, "../sql/sqlite"),
      );

      const logsAfter = await query("SELECT COUNT(*) AS c FROM logs", []);
      expect(Number(logsAfter[0].c)).toBe(Number(logsBefore[0].c));
      const versionRows = await query(
        "SELECT MAX(value) AS maxVersion FROM metadata WHERE type = 'db_version'",
        [],
      );
      expect(Number(versionRows[0].maxVersion)).toBe(11);
    });
  });
});
