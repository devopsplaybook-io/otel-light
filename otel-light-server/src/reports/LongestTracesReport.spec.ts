jest.mock("../OTelContext", () => {
  const span = {
    end: jest.fn(),
    setStatus: jest.fn(),
    addEvent: jest.fn(),
    setAttribute: jest.fn(),
    setAttributes: jest.fn(),
  };
  const moduleLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    OTelLogger: () => ({ createModuleLogger: () => moduleLogger }),
    OTelTracer: () => ({ startSpan: () => span }),
  };
});

// Static reports schedule cron jobs / startup delays on init; keep them out of
// the test runner.
jest.mock("../ScheduledJobs", () => ({
  ScheduledJobRegisterCron: jest.fn(),
  ScheduledJobRunDelayed: jest.fn(),
}));

import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { OTelLogger, OTelTracer } from "../OTelContext";
import {
  DbUtilsExecSQL,
  DbUtilsInit,
  DbUtilsSetOTel,
} from "../utils-std-ts/DbUtils";
import { DbUtilsNoTelemetrySetLogger } from "../utils-std-ts/DbUtilsNoTelemetry";
import {
  LongestTracesReportGenerate,
  LongestTracesReportGetCached,
  LongestTracesReportInit,
} from "./LongestTracesReport";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const testSpan = (): Loose => OTelTracer().startSpan("test");

describe("Longest traces report sub-second durations (M8)", () => {
  let dataDir: string;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "otel-light-longest-"));
    DbUtilsSetOTel(OTelTracer(), OTelLogger());
    DbUtilsNoTelemetrySetLogger(OTelLogger());
    await DbUtilsInit(
      testSpan(),
      { DATA_DIR: dataDir, DATABASE_TYPE: "sqlite" } as unknown as Parameters<
        typeof DbUtilsInit
      >[1],
      path.join(__dirname, "../../sql/sqlite"),
    );

    // 500 ms root span, one hour ago: integer division used to report 0.
    const nowNs = Date.now() * 1_000_000;
    const startTime = nowNs - 3_600_000_000_000;
    await DbUtilsExecSQL(
      testSpan(),
      'INSERT INTO traces ("traceId", "spanId", "parentSpanId", "name", "serviceName", "serviceVersion", "startTime", "endTime", "statusCode", "attributes", "rawSpan", "keywords") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        "subsecond-trace",
        "subsecond-root",
        null,
        "fast-op",
        "subsecond-svc",
        "1.0",
        startTime,
        startTime + 500_000_000,
        0,
        "[]",
        "{}",
        "subsecond-svc:1.0 fast-op",
      ],
    );

    await LongestTracesReportInit(testSpan(), {
      DATA_DIR: dataDir,
      STATIC_REPORT_SCHEDULE_CRON: "0 0 1 1 *",
      STATIC_REPORT_TOP_N: 5,
      STATIC_REPORT_PERIOD_DAYS: 30,
      LONGEST_TRACES_STARTUP_DELAY_MINUTES: 0,
      SCHEDULED_JOB_JITTER_MINUTES: 5,
      SCHEDULED_JOB_OVERLAP_WAIT_MINUTES: 30,
    } as unknown as Parameters<typeof LongestTracesReportInit>[1]);
  });

  afterAll(async () => {
    await fs.remove(dataDir);
  });

  it("keeps sub-second precision instead of truncating to zero", async () => {
    await LongestTracesReportGenerate();

    const report = await LongestTracesReportGetCached();
    expect(report).not.toBeNull();
    const series = report?.series.find(
      (entry) => entry.serviceName === "subsecond-svc" && entry.name === "fast-op",
    );
    expect(series).toBeDefined();
    expect(series?.dataPoints).toHaveLength(1);
    expect(series?.dataPoints[0].value).toBeCloseTo(0.5, 6);
    expect(series?.dataPoints[0].value).toBeGreaterThan(0);
  });
});
