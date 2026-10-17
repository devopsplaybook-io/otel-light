import { describe, expect, it } from "vitest";
import { ExportLogsCsv, ExportTraceJson } from "../services/ExportService";

const CSV_HEADER =
  "time,severity,serviceName,serviceVersion,traceId,spanId,logText";

describe("ExportLogsCsv", () => {
  it("writes only the header when there are no logs", () => {
    expect(ExportLogsCsv([])).toBe(CSV_HEADER);
    expect(ExportLogsCsv(null)).toBe(CSV_HEADER);
  });

  it("converts nanosecond time to ISO and maps the fields in order", () => {
    const csv = ExportLogsCsv([
      {
        time: new Date("2026-10-16T13:00:00.000Z").getTime() * 1e6,
        severity: "INFO",
        serviceName: "svc",
        serviceVersion: "1.0.0",
        traceId: "t-1",
        spanId: "s-1",
        logText: "hello",
      },
    ]);
    expect(csv).toBe(
      CSV_HEADER + "\r\n2026-10-16T13:00:00.000Z,INFO,svc,1.0.0,t-1,s-1,hello"
    );
  });

  it("escapes commas, double quotes and newlines per RFC-4180", () => {
    const csv = ExportLogsCsv([
      {
        time: new Date("1970-01-01T00:00:00.000Z").getTime() * 1e6,
        severity: "ERROR",
        logText: 'a,b "c"\r\nd',
      },
    ]);
    expect(csv).toBe(
      CSV_HEADER +
        '\r\n1970-01-01T00:00:00.000Z,ERROR,,,,,"a,b ""c""\r\nd"'
    );
  });

  it("leaves missing fields empty", () => {
    const csv = ExportLogsCsv([{ severity: "WARN" }]);
    expect(csv).toBe(CSV_HEADER + "\r\n,WARN,,,,,");
  });
});

describe("ExportTraceJson", () => {
  it("returns pretty-printed JSON bundling trace, spans and logs", () => {
    const trace = { traceId: "t-1", name: "GET /api" };
    const spans = [{ spanId: "s-1", rawSpan: { spanId: "s-1" } }];
    const logs = [{ logText: "hi" }];
    const json = ExportTraceJson(trace, spans, logs);
    expect(JSON.parse(json)).toEqual({ trace, spans, logs });
    expect(json).toContain('\n  "trace"');
  });

  it("defaults missing spans and logs to empty arrays", () => {
    const json = ExportTraceJson({ traceId: "t-1" }, null, null);
    expect(JSON.parse(json)).toEqual({
      trace: { traceId: "t-1" },
      spans: [],
      logs: [],
    });
  });
});
