import { Span } from "@opentelemetry/sdk-trace-base";
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

  AnalyticsUtilsResultLimitMetrics =
    configIn.ANALYTICS_UTILS_RESULT_LIMIT_METRICS;
  span.end();
}

export function AnalyticsUtilsGetDefaultFromTime(): number {
  return (Date.now() - 10 * 60 * 1000) * 1_000_000;
}

export function AnalyticsUtilsGetDefaultFromTime24h(): number {
  return (Date.now() - 24 * 60 * 60 * 1000) * 1_000_000;
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
