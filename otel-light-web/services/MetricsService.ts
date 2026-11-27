import { analyticsGet } from "~~/services/AnalyticsQueue";
import type { AnalyticsEnqueueOptions } from "~~/services/AnalyticsQueue";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { UtilsDecompressJson } from "~~/services/Utils";

/**
 * Maximum number of data rows requested per metric chart. The server
 * downsamples evenly across the time range when more rows exist, so the
 * UI transfers a bounded payload instead of paginating through the full
 * data set only to downsample it locally before rendering. The charts
 * sample to 500 points before rendering, so requesting more rows only
 * inflates the response each card has to download and decompress.
 */
const METRICS_FETCH_MAX_POINTS = 500;

/**
 * Fetches the (server-side downsampled) data rows for a single metric.
 */
export async function MetricsServiceFetchMetricData(
  serviceName: string,
  name: string,
  filterQueryString: string,
  options?: AnalyticsEnqueueOptions,
): Promise<any[]> {
  const params = new URLSearchParams(filterQueryString || "");
  params.delete("serviceName");
  params.delete("name");
  params.delete("limit");
  params.set("serviceName", serviceName);
  params.set("name", name);
  params.set("maxPoints", String(METRICS_FETCH_MAX_POINTS));
  const url = `${SERVER_URL}/analytics/metrics?${params.toString()}`;
  const response = await analyticsGet(
    url,
    await AuthService.getAuthHeader(),
    options,
  );
  return await UtilsDecompressJson(response.data.metrics);
}
