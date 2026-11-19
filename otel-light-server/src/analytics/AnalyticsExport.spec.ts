import {
  ANALYTICS_EXPORT_LOGS_CSV_HEADER,
  ANALYTICS_EXPORT_TRACES_CSV_HEADER,
  AnalyticsExportContentType,
  AnalyticsExportCsvField,
  AnalyticsExportLogCsvRow,
  AnalyticsExportLogJsonl,
  AnalyticsExportNeutralizeFormula,
  AnalyticsExportParseFormat,
  AnalyticsExportStream,
  AnalyticsExportTraceCsvRow,
  AnalyticsExportTraceJsonl,
  AnalyticsExportCursor,
} from "./AnalyticsExport";

const ATTRIBUTES =
  '[{"key":"http.method","value":{"stringValue":"GET"}}]';

async function collect<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) {
    items.push(item);
  }
  return items;
}

describe("AnalyticsExportParseFormat", () => {
  it("defaults to csv and accepts jsonl", () => {
    expect(AnalyticsExportParseFormat(undefined)).toBe("csv");
    expect(AnalyticsExportParseFormat("CSV")).toBe("csv");
    expect(AnalyticsExportParseFormat(" jsonl ")).toBe("jsonl");
    expect(AnalyticsExportParseFormat("xml")).toBeNull();
  });

  it("returns the matching content types", () => {
    expect(AnalyticsExportContentType("csv")).toMatch(/^text\/csv/);
    expect(AnalyticsExportContentType("jsonl")).toMatch(
      /^application\/x-ndjson/,
    );
  });
});

describe("CSV serialization", () => {
  it("neutralizes spreadsheet formulas", () => {
    for (const value of ["=1+1", "+cmd", "-2", "@SUM(A1)", "\tx", "\rx", "\nx"]) {
      expect(AnalyticsExportNeutralizeFormula(value)).toBe("'" + value);
    }
    expect(AnalyticsExportNeutralizeFormula("plain")).toBe("plain");
  });

  it("quotes separators, quotes and newlines after neutralization", () => {
    expect(AnalyticsExportCsvField('a,b')).toBe('"a,b"');
    expect(AnalyticsExportCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(AnalyticsExportCsvField("line1\nline2")).toBe(
      '"line1\nline2"',
    );
    expect(AnalyticsExportCsvField(null)).toBe("");
    expect(AnalyticsExportCsvField(undefined)).toBe("");
  });

  it("serializes a log row with ISO time and JSON attributes", () => {
    const row = AnalyticsExportLogCsvRow({
      time: 1_700_000_000_000_000_000,
      severity: "ERROR",
      serviceName: "checkout",
      serviceVersion: "1.2",
      traceId: "t1",
      spanId: "s1",
      logText: "boom",
      attributes: ATTRIBUTES,
    });
    expect(row).toBe(
      `2023-11-14T22:13:20.000Z,ERROR,checkout,1.2,t1,s1,boom,"${ATTRIBUTES.replace(
        /"/g,
        '""',
      )}"`,
    );
  });

  it("writes the documented headers", () => {
    expect(ANALYTICS_EXPORT_LOGS_CSV_HEADER.split(",")).toEqual([
      "time",
      "severity",
      "serviceName",
      "serviceVersion",
      "traceId",
      "spanId",
      "logText",
      "attributes",
    ]);
    expect(ANALYTICS_EXPORT_TRACES_CSV_HEADER.split(",")).toEqual([
      "traceId",
      "startTime",
      "endTime",
      "duration",
      "serviceName",
      "serviceVersion",
      "name",
      "spanCount",
      "nbErrors",
      "attributes",
    ]);
  });

  it("serializes a trace row with a millisecond duration", () => {
    const row = AnalyticsExportTraceCsvRow({
      traceId: "t1",
      startTime: 1_700_000_000_000_000_000,
      endTime: 1_700_000_000_500_000_000,
      serviceName: "checkout",
      serviceVersion: "1.2",
      name: "GET /pay",
      spanCount: 7,
      nbErrors: 1,
      attributes: ATTRIBUTES,
    });
    expect(row.startsWith("t1,2023-11-14T22:13:20.000Z,")).toBe(true);
    expect(row).toContain(",500,checkout,1.2,GET /pay,7,1,");
  });
});

describe("JSONL serialization", () => {
  it("keeps attribute arrays structured for logs", () => {
    const parsed = JSON.parse(
      AnalyticsExportLogJsonl({
        time: 1_700_000_000_000_000_000,
        severity: "WARN",
        serviceName: "checkout",
        serviceVersion: "1.2",
        traceId: "t1",
        spanId: "s1",
        logText: "slow",
        attributes: ATTRIBUTES,
      }),
    );
    expect(parsed.time).toBe(1_700_000_000_000_000_000);
    expect(parsed.attributes).toEqual(JSON.parse(ATTRIBUTES));
  });

  it("keeps nanosecond timings for traces", () => {
    const parsed = JSON.parse(
      AnalyticsExportTraceJsonl({
        traceId: "t1",
        startTime: 10,
        endTime: 25,
        name: "op",
        spanCount: "3",
        nbErrors: "0",
        attributes: null,
      }),
    );
    expect(parsed).toMatchObject({
      traceId: "t1",
      startTime: 10,
      endTime: 25,
      duration: 15,
      spanCount: 3,
      nbErrors: 0,
      attributes: [],
    });
  });

  it("falls back to an empty array for malformed attributes", () => {
    const parsed = JSON.parse(
      AnalyticsExportLogJsonl({ attributes: "{not-json" }),
    );
    expect(parsed.attributes).toEqual([]);
  });
});

describe("AnalyticsExportStream", () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({
    n: index,
  }));

  const options = (fetchChunk: jest.Mock, maxRows: number) => ({
    format: "csv" as const,
    maxRows,
    header: "n",
    fetchChunk,
    cursorOf: (row: { n: number }): AnalyticsExportCursor => ({
      time: row.n,
      id: String(row.n),
    }),
    toCsv: (row: { n: number }) => String(row.n),
    toJsonl: (row: { n: number }) => JSON.stringify(row),
  });

  it("streams the header then every row, stopping on a short chunk", async () => {
    const fetchChunk = jest.fn().mockResolvedValueOnce(rows);
    const output = await collect(
      AnalyticsExportStream(options(fetchChunk, 100)),
    );
    expect(output).toEqual([
      "n\r\n",
      "0\r\n",
      "1\r\n",
      "2\r\n",
      "3\r\n",
      "4\r\n",
    ]);
    expect(fetchChunk).toHaveBeenCalledTimes(1);
    expect(fetchChunk).toHaveBeenCalledWith(null, 100);
  });

  it("stops at the row cap and appends a truncation marker", async () => {
    const fetchChunk = jest
      .fn()
      .mockResolvedValueOnce(rows.slice(0, 3))
      .mockResolvedValueOnce(rows.slice(3));
    const output = await collect(AnalyticsExportStream(options(fetchChunk, 3)));
    expect(output).toHaveLength(1 + 3 + 1);
    expect(output[4]).toMatch(/export truncated at 3 rows/);
    // The probe uses the cursor of the last emitted row.
    expect(fetchChunk).toHaveBeenLastCalledWith(
      { time: 2, id: "2" },
      1,
    );
  });

  it("does not emit a marker when the result fits exactly", async () => {
    const fetchChunk = jest
      .fn()
      .mockResolvedValueOnce(rows.slice(0, 5))
      .mockResolvedValueOnce([]);
    const output = await collect(AnalyticsExportStream(options(fetchChunk, 5)));
    expect(output).toHaveLength(1 + 5);
    expect(output.some((line) => line.includes("truncated"))).toBe(false);
  });

  it("writes JSONL without a header and a JSON marker", async () => {
    const fetchChunk = jest
      .fn()
      .mockResolvedValueOnce(rows.slice(0, 2))
      .mockResolvedValueOnce(rows.slice(2));
    const jsonlOptions = {
      ...options(fetchChunk, 2),
      format: "jsonl" as const,
    };
    const output = await collect(AnalyticsExportStream(jsonlOptions));
    expect(output).toHaveLength(3);
    expect(output.slice(0, 2).map((line) => JSON.parse(line))).toEqual(
      rows.slice(0, 2),
    );
    expect(JSON.parse(output[2])).toEqual({
      __otel_light_export__: { truncated: true, maxRows: 2 },
    });
  });
});
