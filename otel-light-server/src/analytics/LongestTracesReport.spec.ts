import { LongestTraceReport, LongestTraceReportEntry } from "./LongestTracesReport";

describe("LongestTracesReport Data Structures", () => {
  it("should create a valid report entry", () => {
    const entry: LongestTraceReportEntry = {
      traceId: "abc123",
      name: "GET /api/users",
      serviceName: "user-service",
      serviceVersion: "1.2.3",
      startTime: 1000000000000000,
      endTime: 1000000500000000,
      spanCount: 5,
      nbErrors: 0,
      duration: 500000000,
    };

    expect(entry.traceId).toBe("abc123");
    expect(entry.duration).toBe(500000000);
    expect(entry.spanCount).toBe(5);
  });

  it("should create a valid report", () => {
    const report: LongestTraceReport = {
      generatedAt: "2025-01-15T10:00:00.000Z",
      periodDays: 30,
      topN: 50,
      fromTime: 1000000000000000,
      toTime: 1000000000000000,
      traces: [],
    };

    expect(report.generatedAt).toBe("2025-01-15T10:00:00.000Z");
    expect(report.periodDays).toBe(30);
    expect(report.topN).toBe(50);
    expect(report.traces).toHaveLength(0);
  });

  it("should handle report with traces", () => {
    const report: LongestTraceReport = {
      generatedAt: new Date().toISOString(),
      periodDays: 7,
      topN: 10,
      fromTime: 0,
      toTime: 0,
      traces: [
        {
          traceId: "trace-1",
          name: "GET /api/test",
          serviceName: "test-service",
          serviceVersion: "1.0",
          startTime: 1000000000000000,
          endTime: 1000010000000000,
          spanCount: 3,
          nbErrors: 1,
          duration: 10000000000,
        },
        {
          traceId: "trace-2",
          name: "POST /api/data",
          serviceName: "data-service",
          serviceVersion: "2.0",
          startTime: 1000000000000000,
          endTime: 1000005000000000,
          spanCount: 7,
          nbErrors: 0,
          duration: 5000000000,
        },
      ],
    };

    expect(report.traces).toHaveLength(2);
    expect(report.traces[0].duration).toBeGreaterThan(report.traces[1].duration);
    expect(report.traces[0].serviceName).toBe("test-service");
    expect(report.traces[1].serviceName).toBe("data-service");
  });

  it("should compute duration correctly", () => {
    const startTime = 1000000000000000;
    const endTime = 1000050000000000;
    const duration = endTime - startTime;
    const entry: LongestTraceReportEntry = {
      traceId: "duration-test",
      name: "test",
      serviceName: "svc",
      serviceVersion: "1.0",
      startTime,
      endTime,
      spanCount: 1,
      nbErrors: 0,
      duration,
    };

    expect(entry.duration).toBe(50000000000);
    // 50 seconds in nanoseconds
    expect(entry.duration).toBe(50 * 1_000_000_000);
  });
});
