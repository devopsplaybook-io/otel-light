import { Span } from "@opentelemetry/sdk-trace";
import { Config } from "../Config";
import { OTelTracer } from "../OTelContext";

const DEFAULT_SAMPLE_CAP = 20000;
const DEFAULT_MAX_ENTRIES = 100;

export interface AnalyticsStatsPayload {
  groups: string;
  compressed: boolean;
}

interface CacheEntry {
  expiresAt: number;
  payload: AnalyticsStatsPayload;
}

// Module defaults keep caching disabled until AnalyticsStatsInit runs, so unit
// and SQL tests that never initialize the stats module behave as before.
let ttlMs = 0;
let maxEntries = DEFAULT_MAX_ENTRIES;
let sampleCap = DEFAULT_SAMPLE_CAP;
const cache = new Map<string, CacheEntry>();

export async function AnalyticsStatsInit(
  context: Span,
  configIn: Config,
): Promise<void> {
  const span = OTelTracer().startSpan("AnalyticsStatsInit", context);

  const ttlSeconds = Number(configIn.ANALYTICS_STATS_CACHE_TTL_SECONDS);
  ttlMs =
    Number.isFinite(ttlSeconds) && ttlSeconds > 0
      ? Math.trunc(ttlSeconds) * 1000
      : 0;
  const entries = Number(configIn.ANALYTICS_STATS_CACHE_MAX_ENTRIES);
  maxEntries =
    Number.isFinite(entries) && entries > 0
      ? Math.trunc(entries)
      : DEFAULT_MAX_ENTRIES;
  const cap = Number(configIn.ANALYTICS_STATS_SAMPLE_CAP);
  sampleCap =
    Number.isFinite(cap) && cap > 0 ? Math.trunc(cap) : DEFAULT_SAMPLE_CAP;

  cache.clear();
  span.end();
}

export function AnalyticsStatsGetSampleCap(): number {
  return sampleCap;
}

export function AnalyticsStatsCacheBuildKey(
  from: number | string | undefined,
  to: number | string | undefined,
  serviceName: string | undefined,
  serviceVersion: string | undefined,
  includePercentiles: boolean,
): string {
  return [
    from,
    to ?? "",
    serviceName ?? "",
    serviceVersion ?? "",
    includePercentiles ? "1" : "0",
  ].join("|");
}

export function AnalyticsStatsCacheGet(
  key: string,
): AnalyticsStatsPayload | null {
  if (ttlMs <= 0) {
    return null;
  }
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  // Refresh insertion order so eviction drops the least recently used entry.
  cache.delete(key);
  cache.set(key, entry);
  return entry.payload;
}

export function AnalyticsStatsCacheSet(
  key: string,
  payload: AnalyticsStatsPayload,
): void {
  if (ttlMs <= 0) {
    return;
  }
  cache.delete(key);
  cache.set(key, { expiresAt: Date.now() + ttlMs, payload });
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
}
