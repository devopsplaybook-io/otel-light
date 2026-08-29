import { analyticsGet } from "~~/services/AnalyticsQueue";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";
import { UtilsDecompressJson } from "~~/services/Utils";

/**
 * Maximum number of data rows requested per metric chart. The server
 * downsamples evenly across the time range when more rows exist, so the
 * UI transfers a bounded payload instead of paginating through the full
 * data set only to downsample it locally before rendering.
 */
const METRICS_FETCH_MAX_POINTS = 1000;

/**
 * Fetches the (server-side downsampled) data rows for a single metric.
 */
export async function MetricsServiceFetchMetricData(
  serviceName: string,
  name: string,
  filterQueryString: string,
): Promise<any[]> {
  const params = new URLSearchParams(filterQueryString || "");
  params.delete("serviceName");
  params.delete("name");
  params.delete("limit");
  params.set("serviceName", serviceName);
  params.set("name", name);
  params.set("maxPoints", String(METRICS_FETCH_MAX_POINTS));
  const url = `${SERVER_URL}/analytics/metrics?${params.toString()}`;
  const response = await analyticsGet(url, await AuthService.getAuthHeader());
  return await UtilsDecompressJson(response.data.metrics);
}
