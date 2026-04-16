import * as fse from "fs-extra";
import * as path from "path";
import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "../Config";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";
import { ServiceVersionEntry } from "./AnalyticsServicesRoutes";

const logger = OTelLogger().createModuleLogger("AnalyticsServicesCache");

const CACHE_FILE_NAME = "services.json";

export interface ServicesCacheContent {
  services: string[];
  serviceVersions: ServiceVersionEntry[];
}

let config: Config;
let cachedServices: ServicesCacheContent | null = null;

export async function AnalyticsServicesCacheInit(
  context: Span,
  configIn: Config,
): Promise<void> {
  const span = OTelTracer().startSpan("AnalyticsServicesCacheInit", context);
  config = configIn;

  // Load from file if it exists (avoid cold-start latency)
  const cacheFile = getCacheFilePath();
  try {
    if (await fse.pathExists(cacheFile)) {
      cachedServices = await fse.readJson(cacheFile);
      logger.info("Services cache loaded from file", span);
    }
  } catch (err) {
    logger.error("Failed to read services cache file", err, span);
  }

  span.end();

  // Kick off initial refresh and start scheduler
  AnalyticsServicesCacheRefresh().catch((err) => {
    logger.error("Error during initial services cache refresh", err);
  });
}

export function AnalyticsServicesCacheGet(): ServicesCacheContent | null {
  return cachedServices;
}

// Private

function getCacheFilePath(): string {
  return path.join(config.DATA_DIR, "cache", CACHE_FILE_NAME);
}

async function AnalyticsServicesCacheRefresh(): Promise<void> {
  const span = OTelTracer().startSpan("AnalyticsServicesCacheRefresh");
  try {
    logger.info("Refreshing services cache", span);

    const [rawLogsServices, rawTracesServices, rawMetricsServices] =
      await Promise.all([
        DbUtilsNoTelemetryQuerySQL(
          SQL_QUERIES.GET_SERVICES_FROM_LOGS[DbUtilsGetType()],
          [],
        ),
        DbUtilsNoTelemetryQuerySQL(
          SQL_QUERIES.GET_SERVICES_FROM_TRACES[DbUtilsGetType()],
          [],
        ),
        DbUtilsNoTelemetryQuerySQL(
          SQL_QUERIES.GET_SERVICES_FROM_METRICS[DbUtilsGetType()],
          [],
        ),
      ]);

    // Deduplicate service names across all signal types
    const serviceSet = new Set<string>();
    for (const row of rawLogsServices) {
      if (row.serviceName) serviceSet.add(row.serviceName);
    }
    for (const row of rawTracesServices) {
      if (row.serviceName) serviceSet.add(row.serviceName);
    }
    for (const row of rawMetricsServices) {
      if (row.serviceName) serviceSet.add(row.serviceName);
    }
    const services = Array.from(serviceSet).sort();

    // Build serviceName/serviceVersion pairs from logs and traces (not metrics).
    // The SQL already orders by MAX(time) DESC so the most recent version comes first.
    const seen = new Set<string>();
    const serviceVersions: ServiceVersionEntry[] = [];
    for (const row of [...rawLogsServices, ...rawTracesServices]) {
      if (!row.serviceName) continue;
      const key = `${row.serviceName}::${row.serviceVersion ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      serviceVersions.push({
        serviceName: row.serviceName,
        serviceVersion: row.serviceVersion ?? null,
      });
    }

    const newCache: ServicesCacheContent = { services, serviceVersions };
    cachedServices = newCache;

    // Persist to file
    const cacheFile = getCacheFilePath();
    await fse.ensureDir(path.dirname(cacheFile));
    await fse.writeJson(cacheFile, newCache);
    logger.info(
      `Services cache refreshed: ${services.length} services, ${serviceVersions.length} service versions`,
      span,
    );
  } catch (err) {
    logger.error("Error refreshing services cache", err, span);
  }
  span.end();

  // Schedule next refresh
  const intervalMs =
    Math.max(Number(config.CACHE_REFRESH_MINUTES) || 10, 1) * 60 * 1000;
  setTimeout(() => {
    AnalyticsServicesCacheRefresh().catch((err) => {
      logger.error("Error during scheduled services cache refresh", err);
    });
  }, intervalMs);
}

// SQL — order by most recent appearance so latest version comes first

const SQL_QUERIES = {
  GET_SERVICES_FROM_LOGS: {
    postgres: `
      SELECT "serviceName", "serviceVersion", MAX("time") AS lastSeen
      FROM logs
      WHERE "serviceName" IS NOT NULL
      GROUP BY "serviceName", "serviceVersion"
      ORDER BY "serviceName", lastSeen DESC`,
    sqlite: `
      SELECT serviceName, serviceVersion, MAX(time) AS lastSeen
      FROM logs
      WHERE serviceName IS NOT NULL
      GROUP BY serviceName, serviceVersion
      ORDER BY serviceName, lastSeen DESC`,
  },
  GET_SERVICES_FROM_TRACES: {
    postgres: `
      SELECT "serviceName", "serviceVersion", MAX("startTime") AS lastSeen
      FROM traces
      WHERE "serviceName" IS NOT NULL
      GROUP BY "serviceName", "serviceVersion"
      ORDER BY "serviceName", lastSeen DESC`,
    sqlite: `
      SELECT serviceName, serviceVersion, MAX(startTime) AS lastSeen
      FROM traces
      WHERE serviceName IS NOT NULL
      GROUP BY serviceName, serviceVersion
      ORDER BY serviceName, lastSeen DESC`,
  },
  GET_SERVICES_FROM_METRICS: {
    postgres: `
      SELECT DISTINCT "serviceName"
      FROM metrics
      WHERE "serviceName" IS NOT NULL
      ORDER BY "serviceName"`,
    sqlite: `
      SELECT DISTINCT serviceName
      FROM metrics
      WHERE serviceName IS NOT NULL
      ORDER BY serviceName`,
  },
};
