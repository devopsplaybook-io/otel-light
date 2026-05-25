import {
  AnalyticsUtilsGetDefaultFromTime,
  AnalyticsUtilsGetSQLVariable,
  AnalyticsUtilsCompressJson,
  AnalyticsUtilsResultLimitMetrics,
} from "./AnalyticsUtils";

describe("AnalyticsUtilsGetDefaultFromTime", () => {
  it("should return a nanosecond timestamp approximately 10 minutes in the past", () => {
    const result = AnalyticsUtilsGetDefaultFromTime();
    const nowNs = Date.now() * 1_000_000;
    const diffNs = nowNs - result;
    // Should be close to 10 minutes in nanoseconds (600,000 ms * 1,000,000 ns/ms)
    const tenMinNs = 10 * 60 * 1000 * 1_000_000;
    const toleranceNs = 2_000_000_000; // 2 seconds tolerance
    expect(diffNs).toBeGreaterThan(tenMinNs - toleranceNs);
    expect(diffNs).toBeLessThan(tenMinNs + toleranceNs);
  });
});

describe("AnalyticsUtilsGetSQLVariable", () => {
  it("should return $1 for postgres with index 1", () => {
    expect(AnalyticsUtilsGetSQLVariable("postgres", 1)).toBe("$1");
  });

  it("should return $5 for postgres with index 5", () => {
    expect(AnalyticsUtilsGetSQLVariable("postgres", 5)).toBe("$5");
  });

  it("should return ? for sqlite", () => {
    expect(AnalyticsUtilsGetSQLVariable("sqlite", 1)).toBe("?");
    expect(AnalyticsUtilsGetSQLVariable("sqlite", 99)).toBe("?");
  });
});

describe("AnalyticsUtilsCompressJson", () => {
  it("should compress data with gzip and return base64 string", async () => {
    const data = { test: "hello", value: 42 };
    const compressed = await AnalyticsUtilsCompressJson(data, "gzip");
    expect(typeof compressed).toBe("string");
    expect(compressed.length).toBeGreaterThan(0);
  });

  it("should compress data with deflate and return base64 string", async () => {
    const data = { test: "deflate" };
    const compressed = await AnalyticsUtilsCompressJson(data, "deflate");
    expect(typeof compressed).toBe("string");
    expect(compressed.length).toBeGreaterThan(0);
  });

  it("should compress data with brotli and return base64 string", async () => {
    const data = { test: "brotli" };
    const compressed = await AnalyticsUtilsCompressJson(data, "brotli");
    expect(typeof compressed).toBe("string");
    expect(compressed.length).toBeGreaterThan(0);
  });

  it("should default to gzip when no method specified", async () => {
    const data = { foo: "bar" };
    const compressed = await AnalyticsUtilsCompressJson(data);
    expect(typeof compressed).toBe("string");
  });

  it("should produce valid base64 that can be decompressed", async () => {
    const data = { msg: "roundtrip" };
    const compressed = await AnalyticsUtilsCompressJson(data, "gzip");
    const buffer = Buffer.from(compressed, "base64");
    const zlib = await import("zlib");
    const promisify = await import("util");
    const decompressed = await promisify.promisify(zlib.gunzip)(buffer);
    expect(JSON.parse(decompressed.toString())).toEqual(data);
  });
});

describe("AnalyticsUtilsResultLimitMetrics", () => {
  it("should default to 10000", () => {
    expect(AnalyticsUtilsResultLimitMetrics).toBe(10000);
  });
});
