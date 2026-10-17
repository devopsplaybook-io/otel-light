import { UtilsMetricSeriesName } from "./Utils";

export interface MetricsCardLatestInfo {
  unit: string;
  timeUnixNano: number;
  value: number;
  isHistogramCount: boolean;
  seriesName: string;
}

export interface MetricsCardsEntry {
  serviceName: string;
  name: string;
  lastSeen: number;
  autoLoad?: boolean;
}

export type MetricsCardsSortKey = "service" | "name" | "lastUpdate";
export type MetricsCardsSortOrder = "asc" | "desc";

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

export function MetricsCardsFilterNames(
  names: MetricsCardsEntry[],
  text: string
): MetricsCardsEntry[] {
  const query = (text || "").trim().toLowerCase();
  if (!query) return names;
  return names.filter(
    (metric) =>
      (metric.name || "").toLowerCase().includes(query) ||
      (metric.serviceName || "").toLowerCase().includes(query)
  );
}

export function MetricsCardsSortNames(
  names: MetricsCardsEntry[],
  sortKey: MetricsCardsSortKey,
  sortOrder: MetricsCardsSortOrder
): MetricsCardsEntry[] {
  const sorted = [...names];
  const direction = sortOrder === "desc" ? -1 : 1;
  sorted.sort((a, b) => {
    if (sortKey === "lastUpdate") {
      return (Number(a.lastSeen) - Number(b.lastSeen)) * direction;
    }
    if (sortKey === "name") {
      const nameCompare = String(a.name).localeCompare(String(b.name));
      if (nameCompare !== 0) return nameCompare * direction;
      return String(a.serviceName).localeCompare(String(b.serviceName));
    }
    if (a.autoLoad && !b.autoLoad) return -1;
    if (!a.autoLoad && b.autoLoad) return 1;
    const serviceCompare = String(a.serviceName).localeCompare(
      String(b.serviceName)
    );
    if (serviceCompare !== 0) return serviceCompare * direction;
    return String(a.name).localeCompare(String(b.name)) * direction;
  });
  return sorted;
}
