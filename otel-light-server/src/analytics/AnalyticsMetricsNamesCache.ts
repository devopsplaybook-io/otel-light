import * as fse from "fs-extra";
import * as path from "path";
import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "../Config";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";

const logger = OTelLogger().createModuleLogger("AnalyticsMetricsNamesCache");

const CACHE_FILE_NAME = "metricsNames.json";

export interface MetricsNamesEntry {
  serviceName: string;
  name: string;
  type: string;
}

export interface MetricsNamesCacheContent {
  names: MetricsNamesEntry[];
}

let config: Config;
let cachedMetricsNames: MetricsNamesCacheContent | null = null;

export async function AnalyticsMetricsNamesCacheInit(
  context: Span,
  configIn: Config,
): Promise<void> {
  const span = OTelTracer().startSpan(
    "AnalyticsMetricsNamesCacheInit",
    context,
  );
  config = configIn;

  // Load from file if it exists (avoid cold-start latency)
  const cacheFile = getCacheFilePath();
  try {
    if (await fse.pathExists(cacheFile)) {
      cachedMetricsNames = await fse.readJson(cacheFile);
      logger.info("Metrics names cache loaded from file", span);
    }
  } catch (err) {
    logger.error("Failed to read metrics names cache file", err, span);
  }

  span.end();

  // Kick off initial refresh and start scheduler
  AnalyticsMetricsNamesCacheRefresh().catch((err) => {
    logger.error("Error during initial metrics names cache refresh", err);
  });
}

export function AnalyticsMetricsNamesCacheGet(): MetricsNamesCacheContent | null {
  return cachedMetricsNames;
}

export function AnalyticsMetricsNamesCacheFilter(
  serviceName?: string,
  keywords?: string,
): MetricsNamesEntry[] {
  if (!cachedMetricsNames) {
    return [];
  }
  let names = cachedMetricsNames.names;

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

  return names;
}

// Private

function getCacheFilePath(): string {
  return path.join(config.DATA_DIR, "cache", CACHE_FILE_NAME);
}

async function AnalyticsMetricsNamesCacheRefresh(): Promise<void> {
  const span = OTelTracer().startSpan("AnalyticsMetricsNamesCacheRefresh");
  try {
    logger.info("Refreshing metrics names cache", span);

    const rawNames = await DbUtilsNoTelemetryQuerySQL(
      SQL_QUERIES.GET_METRICS_NAMES[DbUtilsGetType()],
      [],
    );

    const names: MetricsNamesEntry[] = rawNames.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (row: any) => ({
        serviceName: row.serviceName,
        name: row.name,
        type: row.type,
      }),
    );

    const newCache: MetricsNamesCacheContent = { names };
    cachedMetricsNames = newCache;

    // Persist to file
    const cacheFile = getCacheFilePath();
    await fse.ensureDir(path.dirname(cacheFile));
    await fse.writeJson(cacheFile, newCache);
    logger.info(
      `Metrics names cache refreshed: ${names.length} metric names`,
      span,
    );
  } catch (err) {
    logger.error("Error refreshing metrics names cache", err, span);
  }
  span.end();

  // Schedule next refresh
  const intervalMs =
    Math.max(Number(config.CACHE_REFRESH_MINUTES) || 10, 1) * 60 * 1000;
  setTimeout(() => {
    AnalyticsMetricsNamesCacheRefresh().catch((err) => {
      logger.error("Error during scheduled metrics names cache refresh", err);
    });
  }, intervalMs);
}

const SQL_QUERIES = {
  GET_METRICS_NAMES: {
    postgres: `SELECT DISTINCT "name", "serviceName", "type" FROM metrics ORDER BY "serviceName", "name", "type"`,
    sqlite: `SELECT DISTINCT name, serviceName, type FROM metrics ORDER BY serviceName, name, type`,
  },
};
