import * as fse from "fs-extra";
import * as path from "path";
import { Span } from "@opentelemetry/sdk-trace";
import { Config } from "../Config";
import { FileUtilsWriteJsonAtomic } from "../FileUtils";
import { OTelLogger, OTelTracer } from "../OTelContext";
import {
  SignalRollupsGetMetricNames,
  SignalRollupsGetServicesAndVersions,
  SignalRollupsIsReady,
} from "../SignalRollups";

const logger = OTelLogger().createModuleLogger("AnalyticsCache");
const CACHE_FILE_NAME = "analyticsCache.json";

// ========================================================================
// Types
// ========================================================================

export interface ServiceVersionEntry {
  serviceName: string;
  serviceVersion: string | null;
}

export interface ServicesCacheContent {
  services: string[];
  serviceVersions: ServiceVersionEntry[];
}

export interface MetricsNamesEntry {
  serviceName: string;
  name: string;
  type: string;
  firstSeen: number;
  lastSeen: number;
}

export interface MetricsNamesCacheContent {
  names: MetricsNamesEntry[];
}

// ========================================================================
// Module state
// ========================================================================

interface CacheFile {
  services: ServicesCacheContent | null;
  metricsNames: MetricsNamesCacheContent | null;
  lastUpdated: number;
}

let config: Config;
let cachedData: CacheFile | null = null;
let lastAccessTime = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

// ========================================================================
// Public API
// ========================================================================

export async function AnalyticsCacheInit(
  context: Span,
  configIn: Config,
): Promise<void> {
  const span = OTelTracer().startSpan("AnalyticsCacheInit", context);
  config = configIn;

  // Load from file if it exists (avoid cold-start latency)
  const cacheFile = getCacheFilePath();
  try {
    if (await fse.pathExists(cacheFile)) {
      cachedData = await fse.readJson(cacheFile);
      logger.info("Analytics cache loaded from file", span);
    }
  } catch (err) {
    logger.error("Failed to read analytics cache file", err, span);
  }

  // Ensure the first scheduled refresh uses the short interval
  // (otherwise lastAccessTime=0 triggers the 1-hour fallback)
  lastAccessTime = Date.now();

  span.end();

  // Refresh once at startup (the caller is still initializing, no need for a
  // fire-and-forget task), then keep the adaptive scheduler running.
  await AnalyticsCacheRefresh();
}

export function AnalyticsCacheGetServices(): ServicesCacheContent | null {
  lastAccessTime = Date.now();
  return cachedData?.services ?? null;
}

export function AnalyticsCacheFilterMetricsNames(
  serviceName?: string,
  keywords?: string,
  from?: number,
  to?: number,
): MetricsNamesEntry[] {
  lastAccessTime = Date.now();
  if (!cachedData?.metricsNames) {
    return [];
  }
  let names = cachedData.metricsNames.names;

  if (serviceName && serviceName.trim()) {
    const sn = serviceName.trim();
    names = names.filter((n) => n.serviceName === sn);
  }

  if (keywords && keywords.trim()) {
    const kw = keywords.toLowerCase().trim();
    names = names.filter(
      (n) =>
        n.name.toLowerCase().includes(kw) ||
        n.serviceName.toLowerCase().includes(kw),
    );
  }

  // Filter by time window: metric must have data within [from, to]
  if (from) {
    names = names.filter((n) => n.lastSeen >= from);
  }
  if (to) {
    names = names.filter((n) => n.firstSeen <= to);
  }

  return names;
}

// ========================================================================
// Private
// ========================================================================

function getCacheFilePath(): string {
  return path.join(config.DATA_DIR, "cache", CACHE_FILE_NAME);
}

function getRefreshInterval(): number {
  const oneHourMs = 60 * 60 * 1000;
  const tenMinMs = 10 * 60 * 1000;
  const minIntervalMs =
    Math.max(Number(config.CACHE_REFRESH_MINUTES) || 1, 1) * 60 * 1000;

  // If cache was accessed within the past hour, refresh every 10 min
  if (lastAccessTime > 0 && Date.now() - lastAccessTime < oneHourMs) {
    return Math.max(tenMinMs, minIntervalMs);
  }
  // Otherwise refresh every hour
  return Math.max(oneHourMs, minIntervalMs);
}

function scheduleNextRefresh(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  const intervalMs = getRefreshInterval();
  refreshTimer = setTimeout(() => {
    AnalyticsCacheRefresh().catch((err) => {
      logger.error("Error during scheduled analytics cache refresh", err);
    });
  }, intervalMs);
  // Never keep the process alive just for the cache scheduler (tests/CLI).
  refreshTimer.unref();
}

export async function AnalyticsCacheRefresh(): Promise<void> {
  const span = OTelTracer().startSpan("AnalyticsCacheRefresh");
  try {
    logger.info("Refreshing analytics cache", span);

    // Refresh services and metrics names in parallel
    const [servicesData, metricsNamesData] = await Promise.all([
      refreshServices(),
      refreshMetricsNames(),
    ]);

    // Build new cache: preserve existing data only when a refresh failed
    // (null) or when the rollups are not ready yet (empty tables before the
    // one-time recount). A valid empty result means the signals were deleted
    // and must clear the cache instead of keeping stale services/metrics.
    const rollupsReady = SignalRollupsIsReady();
    const newData: CacheFile = {
      services: cachedData?.services ?? null,
      metricsNames: cachedData?.metricsNames ?? null,
      lastUpdated: cachedData?.lastUpdated ?? Date.now(),
    };
    if (rollupsReady && servicesData) {
      newData.services = servicesData;
    }
    if (rollupsReady && metricsNamesData) {
      newData.metricsNames = metricsNamesData;
    }
    newData.lastUpdated = Date.now();
    cachedData = newData;

    // Persist atomically: a crash mid-write must not truncate the cache file.
    await FileUtilsWriteJsonAtomic(getCacheFilePath(), newData);
    logger.info(
      `Analytics cache refreshed: ${servicesData?.services.length ?? 0} services, ${servicesData?.serviceVersions.length ?? 0} service versions, ${metricsNamesData?.names.length ?? 0} metric names`,
      span,
    );
  } catch (err) {
    logger.error("Error refreshing analytics cache", err, span);
  }
  span.end();

  scheduleNextRefresh();
}

// Rollup reads (maintained incrementally on ingestion and maintenance deletes)
// replace the previous full-table GROUP BY scans over logs/traces/metrics (M4).
async function refreshServices(): Promise<ServicesCacheContent | null> {
  try {
    const { services, serviceVersions } =
      await SignalRollupsGetServicesAndVersions();
    return { services, serviceVersions };
  } catch (err) {
    logger.error("Error refreshing services data", err);
    return null;
  }
}

async function refreshMetricsNames(): Promise<MetricsNamesCacheContent | null> {
  try {
    const names: MetricsNamesEntry[] = await SignalRollupsGetMetricNames();
    return { names };
  } catch (err) {
    logger.error("Error refreshing metrics names data", err);
    return null;
  }
}
