import {
  TraceGroupReport,
  TraceGroupSeries,
  TraceTimeSeriesPoint,
} from "./TraceGroupReportTypes";

describe("TraceGroupReportTypes Data Structures", () => {
  it("should create a valid time series point", () => {
    const pt: TraceTimeSeriesPoint = {
      bucket: 1000000000000000000,
      value: 5000000000,
    };
    expect(pt.bucket).toBe(1000000000000000000);
    expect(pt.value).toBe(5000000000);
  });

  it("should create a valid group series with data points", () => {
    const series: TraceGroupSeries = {
      serviceName: "api-gateway",
      name: "GET /users",
      dataPoints: [
        { bucket: 1000000000000000000, value: 10000000 },
        { bucket: 1000086400000000000, value: 15000000 },
      ],
    };
    expect(series.serviceName).toBe("api-gateway");
    expect(series.name).toBe("GET /users");
    expect(series.dataPoints).toHaveLength(2);
    expect(series.dataPoints[1].bucket - series.dataPoints[0].bucket).toBe(
      86_400_000_000_000,
    );
  });

  it("should create a valid report with multiple series", () => {
    const report: TraceGroupReport = {
      generatedAt: "2025-01-15T10:00:00.000Z",
      periodDays: 30,
      topN: 50,
      bucketNs: 86_400_000_000_000,
      series: [
        {
          serviceName: "svc-a",
          name: "POST /data",
          dataPoints: [
            { bucket: 1000000000000000000, value: 5000000000 },
            { bucket: 1000086400000000000, value: 8000000000 },
          ],
        },
        {
          serviceName: "svc-b",
          name: "GET /health",
          dataPoints: [
            { bucket: 1000000000000000000, value: 1000000 },
            { bucket: 1000086400000000000, value: 2000000 },
          ],
        },
      ],
    };
    expect(report.generatedAt).toBe("2025-01-15T10:00:00.000Z");
    expect(report.topN).toBe(50);
    expect(report.series).toHaveLength(2);
    expect(report.bucketNs).toBe(86_400_000_000_000);
  });

  it("should handle empty report", () => {
    const report: TraceGroupReport = {
      generatedAt: new Date().toISOString(),
      periodDays: 7,
      topN: 10,
      bucketNs: 86_400_000_000_000,
      series: [],
    };
    expect(report.series).toHaveLength(0);
  });

  it("should handle empty data points per series", () => {
    const report: TraceGroupReport = {
      generatedAt: new Date().toISOString(),
      periodDays: 30,
      topN: 5,
      bucketNs: 86_400_000_000_000,
      series: [
        {
          serviceName: "svc",
          name: "op",
          dataPoints: [],
        },
      ],
    };
    expect(report.series[0].dataPoints).toHaveLength(0);
  });
});
