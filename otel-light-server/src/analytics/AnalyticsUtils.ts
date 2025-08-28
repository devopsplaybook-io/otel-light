import * as zlib from "zlib";
import * as util from "util";

const gzip = util.promisify(zlib.gzip);
const deflate = util.promisify(zlib.deflate);
const brotliCompress = util.promisify(zlib.brotliCompress);

export function AnalyticsUtilsGetDefaultFromTime(): number {
  return (Date.now() - 10 * 60 * 1000) * 1_000_000;
}

export async function AnalyticsUtilsCompressJson(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jsonData: any,
  method = "gzip"
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

export const AnalyticsUtilsResultLimit = 2000;
export const AnalyticsUtilsResultLimitMetrics = 10000;
