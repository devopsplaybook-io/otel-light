import { Span } from "@opentelemetry/sdk-trace";
import * as util from "util";
import * as zlib from "zlib";
import { Config } from "../Config";
import { OTelTracer } from "../OTelContext";

const gzip = util.promisify(zlib.gzip);
const deflate = util.promisify(zlib.deflate);
const brotliCompress = util.promisify(zlib.brotliCompress);

export async function AnalyticsUtilsInit(
  context: Span,
  configIn: Config,
): Promise<void> {
  const span = OTelTracer().startSpan("AnalyticsUtilsInit", context);

  AnalyticsUtilsResultLimitMetrics = AnalyticsUtilsSanitizeResultLimit(
    configIn.ANALYTICS_UTILS_RESULT_LIMIT_METRICS,
  );
  span.end();
}

export function AnalyticsUtilsSanitizeResultLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 10000;
  }
  return Math.trunc(numeric);
}

export function AnalyticsUtilsGetDefaultFromTime(): number {
  return (Date.now() - 10 * 60 * 1000) * 1_000_000;
}

export function AnalyticsUtilsGetDefaultFromTime24h(): number {
  return (Date.now() - 24 * 60 * 60 * 1000) * 1_000_000;
}

// Escape LIKE metacharacters so user text matches literally. Same convention
// as the retention rules in Maintenance.ts: every LIKE site must add
// `ESCAPE '\'` for these escapes to take effect.
export function AnalyticsUtilsEscapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function AnalyticsUtilsParsePositiveInt(
  value: unknown,
  max: number,
): number | null {
  const parsed = parseInt(String(value ?? ""), 10);
  if (isNaN(parsed) || parsed < 1) {
    return null;
  }
  return Math.min(parsed, max);
}

export const ANALYTICS_MAX_OFFSET = 1_000_000;

// Offset must be a non-negative integer. Everything else (negative, decimal,
// non-numeric, arrays, SQL fragments) returns null so the route can answer 400
// instead of interpolating or binding an unexpected value.
export function AnalyticsUtilsParseOffset(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > ANALYTICS_MAX_OFFSET
  ) {
    return null;
  }
  return parsed;
}

export async function AnalyticsUtilsCompressJson(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jsonData: any,
  method = "gzip",
): Promise<string> {
  const jsonString = JSON.stringify(jsonData);
  let compressedBuffer;
  switch (method) {
    case "deflate":
      compressedBuffer = await deflate(jsonString);
      break;
    case "brotli":
      compressedBuffer = await brotliCompress(jsonString);
      break;
    case "gzip":
    default:
      compressedBuffer = await gzip(jsonString);
  }
  return compressedBuffer.toString("base64");
}

export function AnalyticsUtilsGetSQLVariable(
  dbType: string,
  index: number,
): string {
  if (dbType === "postgres") {
    return `$${index}`;
  }
  return "?";
}

// Nanosecond timestamps exceed Number.MAX_SAFE_INTEGER, so the digits sent by
// clients are the shortest round-trip form of a JS number (double), while the
// DB stored that same double. Binding the raw digits as text makes SQLite
// parse them as an exact 64-bit integer, which no longer equals the stored
// value - silently breaking equality and composite-cursor predicates. Coerce
// back to the double before binding.
export function AnalyticsUtilsGetTimeParam(
  value: string | number | undefined,
): string | number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}

export let AnalyticsUtilsResultLimitMetrics = 10000;
