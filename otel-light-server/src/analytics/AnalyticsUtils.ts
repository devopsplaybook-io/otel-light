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

  AnalyticsUtilsResultLimit = configIn.ANALYTICS_UTILS_RESULT_LIMIT;
  AnalyticsUtilsResultLimitMetrics =
    configIn.ANALYTICS_UTILS_RESULT_LIMIT_METRICS;
  span.end();
}

export function AnalyticsUtilsGetDefaultFromTime(): number {
  return (Date.now() - 10 * 60 * 1000) * 1_000_000;
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

export let AnalyticsUtilsResultLimit = 2000;
export let AnalyticsUtilsResultLimitMetrics = 10000;
