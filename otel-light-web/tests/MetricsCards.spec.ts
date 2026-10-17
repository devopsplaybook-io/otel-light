import { describe, expect, it } from "vitest";
import {
  MetricsCardsFilterNames,
  MetricsCardsFormatValue,
  MetricsCardsLatestInfo,
  MetricsCardsSortNames,
} from "../services/MetricsCards";

function gaugeRow(unit: string, points: any[]): any {
  return { data: { unit, gauge: { dataPoints: points } } };
}

function sumRow(unit: string, points: any[]): any {
  return { data: { unit, sum: { dataPoints: points } } };
}

function histogramRow(unit: string, points: any[]): any {
  return { data: { unit, histogram: { dataPoints: points } } };
}

describe("MetricsCardsLatestInfo", () => {
  it("returns the latest gauge point with unit and series name", () => {
    const info = MetricsCardsLatestInfo([
      gaugeRow("s", [
        {
          timeUnixNano: "1000000000",
          asDouble: 1.5,
          attributes: [{ key: "probe.name", value: { stringValue: "ping" } }],
        },
        {
          timeUnixNano: "3000000000",
          asDouble: 2.5,
          attributes: [],
        },
      ]),
    ]);
    expect(info).toEqual({
      unit: "s",
      timeUnixNano: 3000000000,
      value: 2.5,
      isHistogramCount: false,
      seriesName: "default",
    });
  });

  it("handles asInt values in sum rows", () => {
    const info = MetricsCardsLatestInfo([
      sumRow("", [{ timeUnixNano: "10", asInt: 42, attributes: [] }]),
    ]);
    expect(info).toEqual({
      unit: "",
      timeUnixNano: 10,
      value: 42,
      isHistogramCount: false,
      seriesName: "default",
    });
  });

  it("uses the histogram point count", () => {
    const info = MetricsCardsLatestInfo([
      histogramRow("ms", [
        { timeUnixNano: "20", count: 7, sum: 100, attributes: [] },
      ]),
    ]);
    expect(info).toEqual({
      unit: "ms",
      timeUnixNano: 20,
      value: 7,
      isHistogramCount: true,
      seriesName: "default",
    });
  });

  it("picks the greatest timeUnixNano across out-of-order rows", () => {
    const info = MetricsCardsLatestInfo([
      gaugeRow("", [{ timeUnixNano: "500", asDouble: 5, attributes: [] }]),
      gaugeRow("", [{ timeUnixNano: "100", asDouble: 1, attributes: [] }]),
      sumRow("", [{ timeUnixNano: "300", asDouble: 3, attributes: [] }]),
    ]);
    expect(info?.timeUnixNano).toBe(500);
    expect(info?.value).toBe(5);
  });

  it("keeps the first series on equal timestamps", () => {
    const info = MetricsCardsLatestInfo([
      gaugeRow("", [
        { timeUnixNano: "100", asDouble: 1, attributes: [{ key: "k", value: { stringValue: "first" } }] },
        { timeUnixNano: "100", asDouble: 2, attributes: [{ key: "k", value: { stringValue: "second" } }] },
      ]),
    ]);
    expect(info?.value).toBe(1);
    expect(info?.seriesName).toBe("k:first");
  });

  it("returns null for empty or invalid input", () => {
    expect(MetricsCardsLatestInfo([])).toBeNull();
    expect(MetricsCardsLatestInfo(null)).toBeNull();
    expect(MetricsCardsLatestInfo([{}])).toBeNull();
    expect(MetricsCardsLatestInfo([{ data: { gauge: {} } }])).toBeNull();
    expect(MetricsCardsLatestInfo([{ data: { sum: { dataPoints: [] } } }])).toBeNull();
  });
});

describe("MetricsCardsFormatValue", () => {
  it("formats numbers with up to 4 fraction digits", () => {
    expect(MetricsCardsFormatValue(1234.56789)).toBe("1,234.5679");
    expect(MetricsCardsFormatValue(0)).toBe("0");
    expect(MetricsCardsFormatValue(2)).toBe("2");
  });
});

describe("MetricsCardsFilterNames", () => {
  const names = [
    { serviceName: "planner-llm-agent", name: "session.duration", lastSeen: 1 },
    { serviceName: "otel-light", name: "http.requests", lastSeen: 2 },
    { serviceName: "OTel-Light", name: "db.queries", lastSeen: 3 },
  ];

  it("matches case-insensitively over name and serviceName", () => {
    expect(MetricsCardsFilterNames(names, "duration")).toHaveLength(1);
    expect(MetricsCardsFilterNames(names, "PLANNER")).toHaveLength(1);
    expect(MetricsCardsFilterNames(names, "otel-light")).toHaveLength(2);
  });

  it("returns all entries for empty or whitespace text", () => {
    expect(MetricsCardsFilterNames(names, "")).toHaveLength(3);
    expect(MetricsCardsFilterNames(names, "   ")).toHaveLength(3);
  });

  it("returns no entries when nothing matches", () => {
    expect(MetricsCardsFilterNames(names, "nomatch")).toHaveLength(0);
  });
});

describe("MetricsCardsSortNames", () => {
  const names = [
    { serviceName: "b-service", name: "z-metric", lastSeen: 10, autoLoad: false },
    { serviceName: "a-service", name: "m-metric", lastSeen: 30, autoLoad: false },
    { serviceName: "a-service", name: "a-metric", lastSeen: 20, autoLoad: true },
  ];

  it("sorts by service with autoLoad entries first (default)", () => {
    const sorted = MetricsCardsSortNames(names, "service", "asc");
    expect(sorted.map((m) => m.name)).toEqual([
      "a-metric",
      "m-metric",
      "z-metric",
    ]);
    expect(sorted[0].autoLoad).toBe(true);
  });

  it("reverses service order but keeps autoLoad first on desc", () => {
    const sorted = MetricsCardsSortNames(names, "service", "desc");
    expect(sorted[0].autoLoad).toBe(true);
    expect(sorted[1].serviceName).toBe("b-service");
    expect(sorted[2].serviceName).toBe("a-service");
  });

  it("sorts by name with service as tie-break", () => {
    const sorted = MetricsCardsSortNames(names, "name", "asc");
    expect(sorted.map((m) => m.name)).toEqual([
      "a-metric",
      "m-metric",
      "z-metric",
    ]);
    const desc = MetricsCardsSortNames(names, "name", "desc");
    expect(desc.map((m) => m.name)).toEqual([
      "z-metric",
      "m-metric",
      "a-metric",
    ]);
  });

  it("sorts by lastUpdate newest first on desc", () => {
    const desc = MetricsCardsSortNames(names, "lastUpdate", "desc");
    expect(desc.map((m) => m.lastSeen)).toEqual([30, 20, 10]);
    const asc = MetricsCardsSortNames(names, "lastUpdate", "asc");
    expect(asc.map((m) => m.lastSeen)).toEqual([10, 20, 30]);
  });

  it("never mutates the input array", () => {
    const input = [...names];
    MetricsCardsSortNames(input, "name", "desc");
    MetricsCardsSortNames(input, "lastUpdate", "asc");
    MetricsCardsSortNames(input, "service", "desc");
    expect(input).toEqual(names);
  });
});
