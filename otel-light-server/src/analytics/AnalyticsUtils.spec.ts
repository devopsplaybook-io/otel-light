jest.mock("../OTelContext", () => ({
  OTelTracer: () => ({
    startSpan: () => ({
      end: jest.fn(),
      addEvent: jest.fn(),
      setStatus: jest.fn(),
    }),
  }),
}));

import {
  AnalyticsUtilsEscapeLike,
  AnalyticsUtilsGetDefaultFromTime,
  AnalyticsUtilsGetSQLVariable,
  AnalyticsUtilsGetTimeParam,
  AnalyticsUtilsCompressJson,
  AnalyticsUtilsInit,
  AnalyticsUtilsParseOffset,
  AnalyticsUtilsParsePositiveInt,
  AnalyticsUtilsResultLimitMetrics,
} from "./AnalyticsUtils";

const fakeSpan = { end: jest.fn() } as never;

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

describe("AnalyticsUtilsGetTimeParam", () => {
  it("should coerce query-string timestamps to numbers", () => {
    expect(AnalyticsUtilsGetTimeParam("1750000000000000000")).toBe(
      1750000000000000000,
    );
    expect(AnalyticsUtilsGetTimeParam("0")).toBe(0);
  });

  it("should round nanosecond digits to the double the DB stored", () => {
    // "1790946325746000000" is the shortest round-trip form of a double whose
    // exact value is 1790946325745999872; binding the raw text would compare
    // against the former. Coercion restores the stored value.
    expect(AnalyticsUtilsGetTimeParam("1790946325746000000")).toBe(
      Number("1790946325746000000"),
    );
  });

  it("should pass through numbers, undefined and non-numeric values", () => {
    expect(AnalyticsUtilsGetTimeParam(123)).toBe(123);
    expect(AnalyticsUtilsGetTimeParam(undefined)).toBeUndefined();
    expect(AnalyticsUtilsGetTimeParam("abc")).toBe("abc");
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

describe("AnalyticsUtilsEscapeLike", () => {
  it("escapes %, _ and \\ so LIKE matches them literally", () => {
    expect(AnalyticsUtilsEscapeLike("100%")).toBe("100\\%");
    expect(AnalyticsUtilsEscapeLike("a_b")).toBe("a\\_b");
    expect(AnalyticsUtilsEscapeLike("a\\b")).toBe("a\\\\b");
    expect(AnalyticsUtilsEscapeLike("%a\\%b\\_c\\\\d%%")).toBe(
      "\\%a\\\\\\%b\\\\\\_c\\\\\\\\d\\%\\%",
    );
  });

  it("leaves normal text unchanged", () => {
    expect(AnalyticsUtilsEscapeLike("GET /api v1")).toBe("GET /api v1");
    expect(AnalyticsUtilsEscapeLike("")).toBe("");
  });
});

describe("AnalyticsUtilsParseOffset", () => {
  it("defaults absent or empty values to 0", () => {
    expect(AnalyticsUtilsParseOffset(undefined)).toBe(0);
    expect(AnalyticsUtilsParseOffset(null)).toBe(0);
    expect(AnalyticsUtilsParseOffset("")).toBe(0);
  });

  it("accepts non-negative integers up to the bound", () => {
    expect(AnalyticsUtilsParseOffset("0")).toBe(0);
    expect(AnalyticsUtilsParseOffset(0)).toBe(0);
    expect(AnalyticsUtilsParseOffset("200")).toBe(200);
    expect(AnalyticsUtilsParseOffset(200)).toBe(200);
    expect(AnalyticsUtilsParseOffset("1000000")).toBe(1000000);
  });

  it("rejects everything that is not a bounded non-negative integer", () => {
    expect(AnalyticsUtilsParseOffset("-1")).toBeNull();
    expect(AnalyticsUtilsParseOffset("abc")).toBeNull();
    expect(AnalyticsUtilsParseOffset("1.5")).toBeNull();
    expect(AnalyticsUtilsParseOffset("(SELECT 1)")).toBeNull();
    expect(AnalyticsUtilsParseOffset("1000001")).toBeNull();
    expect(AnalyticsUtilsParseOffset(["1", "2"])).toBeNull();
  });
});

describe("AnalyticsUtilsParsePositiveInt", () => {
  it("preserves the metrics limit semantics", () => {
    expect(AnalyticsUtilsParsePositiveInt("12abc", 100)).toBe(12);
    expect(AnalyticsUtilsParsePositiveInt("0", 100)).toBeNull();
    expect(AnalyticsUtilsParsePositiveInt("-3", 100)).toBeNull();
    expect(AnalyticsUtilsParsePositiveInt("abc", 100)).toBeNull();
    expect(AnalyticsUtilsParsePositiveInt("500", 100)).toBe(100);
    expect(AnalyticsUtilsParsePositiveInt(undefined, 100)).toBeNull();
  });
});

describe("AnalyticsUtilsResultLimitMetrics", () => {
  it("should default to 10000", () => {
    expect(AnalyticsUtilsResultLimitMetrics).toBe(10000);
  });
});

describe("AnalyticsUtilsInit (L9)", () => {
  it("applies the configured result limit", async () => {
    await AnalyticsUtilsInit(fakeSpan, {
      ANALYTICS_UTILS_RESULT_LIMIT_METRICS: 42,
    } as never);

    expect(AnalyticsUtilsResultLimitMetrics).toBe(42);
  });

  it("falls back to 10000 for an invalid configured value", async () => {
    await AnalyticsUtilsInit(fakeSpan, {
      ANALYTICS_UTILS_RESULT_LIMIT_METRICS: -1,
    } as never);

    expect(AnalyticsUtilsResultLimitMetrics).toBe(10000);
  });
});
