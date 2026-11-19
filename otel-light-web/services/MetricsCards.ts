import { UtilsMetricSeriesName } from "./Utils";

export interface MetricsCardLatestInfo {
  unit: string;
  timeUnixNano: number;
  value: number;
  isHistogramCount: boolean;
  seriesName: string;
}

/**
 * Resolves the latest data point of a metric from the raw OTLP rows
 * returned by /api/analytics/metrics: the point with the greatest
 * timeUnixNano across all series (first series wins on ties). Histograms
 * expose their point count instead of a value.
 */
export function MetricsCardsLatestInfo(
  allMetrics: any[]
): MetricsCardLatestInfo | null {
  if (!Array.isArray(allMetrics)) return null;
  let latest: MetricsCardLatestInfo | null = null;
  for (const row of allMetrics) {
    const data = row?.data;
    if (!data) continue;
    const unit = typeof data.unit === "string" ? data.unit : "";
    const kind = ["gauge", "sum", "histogram"].find(
      (k) => data[k] && Array.isArray(data[k].dataPoints)
    );
    if (!kind) continue;
    for (const point of data[kind].dataPoints) {
      const timeUnixNano = Number(point?.timeUnixNano);
      if (!Number.isFinite(timeUnixNano)) continue;
      if (latest && timeUnixNano <= latest.timeUnixNano) continue;
      const isHistogramCount = kind === "histogram";
      const rawValue = isHistogramCount
        ? point.count
        : point.asDouble ?? point.asInt ?? 0;
      latest = {
        unit,
        timeUnixNano,
        value: Number(rawValue) || 0,
        isHistogramCount,
        seriesName: UtilsMetricSeriesName(point.attributes),
      };
    }
  }
  return latest;
}

export function MetricsCardsFormatValue(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** How far the server-reported last-seen time may trail the latest point. */
export const METRICS_CARDS_STALE_TOLERANCE_NS = 60_000_000_000; // 60 s

/**
 * True only when a latest rendered point is known and the server-reported
 * last-seen time is more than the tolerance behind it, i.e. the chart shows
 * older data than what the server already has.
 */
export function MetricsCardsIsStale(
  lastSeenNs: number,
  latestTimeNs: number | null | undefined,
  toleranceNs: number = METRICS_CARDS_STALE_TOLERANCE_NS,
): boolean {
  if (
    !Number.isFinite(lastSeenNs) ||
    latestTimeNs === null ||
    latestTimeNs === undefined ||
    !Number.isFinite(latestTimeNs)
  ) {
    return false;
  }
  return lastSeenNs - latestTimeNs > toleranceNs;
}

/** True only when both values are finite numbers and next > previous. */
export function MetricsCardsLastSeenAdvanced(
  previousNs: unknown,
  nextNs: unknown,
): boolean {
  const previous = Number(previousNs);
  const next = Number(nextNs);
  return (
    Number.isFinite(previous) && Number.isFinite(next) && next > previous
  );
}

/**
 * Orders metric cards for display: metrics with auto-load enabled first,
 * metrics the user chose not to load by default last; each group ordered
 * by service name then metric name. Returns a new array, never mutates.
 */
export function MetricsCardsSortAutoLoadLast(names: any[]): any[] {
  return [...names].sort((a, b) => {
    if (a.autoLoad && !b.autoLoad) return -1;
    if (!a.autoLoad && b.autoLoad) return 1;
    const serviceCompare = String(a.serviceName).localeCompare(
      String(b.serviceName)
    );
    if (serviceCompare !== 0) return serviceCompare;
    return String(a.name).localeCompare(String(b.name));
  });
}
