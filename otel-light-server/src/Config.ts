import { ConfigBase } from "@devopsplaybook.io/common-utils";
import * as fse from "fs-extra";
import path from "path";
import { OTelLogger } from "./OTelContext";

const logger = OTelLogger().createModuleLogger("config");

const KNOWN_DEFAULT_JWT_KEYS = ["dev"];

export const INGESTION_BODY_LIMIT_DEFAULT_BYTES = 1_048_576;
export const INGESTION_BODY_LIMIT_MIN_BYTES = 1_024;
export const INGESTION_BODY_LIMIT_MAX_BYTES = 16_777_216;

export function ConfigClampIngestionBodyLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return INGESTION_BODY_LIMIT_DEFAULT_BYTES;
  }
  return Math.min(
    INGESTION_BODY_LIMIT_MAX_BYTES,
    Math.max(INGESTION_BODY_LIMIT_MIN_BYTES, Math.trunc(numeric)),
  );
}

export function ConfigClampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  truncate = true,
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, numeric));
  return truncate ? Math.trunc(clamped) : clamped;
}

export class Config extends ConfigBase {
  // Project-specific OTel defaults (override ConfigBase empty-string defaults)
  public OPENTELEMETRY_COLLECTOR_HTTP_TRACES =
    "http://localhost:8080/v1/traces";
  public OPENTELEMETRY_COLLECTOR_HTTP_METRICS =
    "http://localhost:8080/v1/metrics";
  public OPENTELEMETRY_COLLECTOR_HTTP_LOGS = "http://localhost:8080/v1/logs";

  // Maintenance
  public METRICS_COMPRESS_MINUTE_THRESHOLD_HOURS = 12;
  public METRICS_COMPRESS_HOUR_THRESHOLD_DAYS = 7;
  public MAINTENANCE_FREQUENCY_HOURS = 6;
  // Only traces whose root span is inside this recent window are checked
  // for orphan (root-less) spans, keeping the scheduled job bounded.
  public MAINTENANCE_ORPHAN_LOOKBACK_HOURS = 24;
  public CACHE_REFRESH_MINUTES = 10;
  public METRICS_SELF_REFRESH_MINUTES = 10;

  // API Limits
  public ANALYTICS_UTILS_RESULT_LIMIT_METRICS = 10000;
  public INGESTION_BODY_LIMIT_BYTES = INGESTION_BODY_LIMIT_DEFAULT_BYTES;

  // Security / rate limits (0 disables a limit). Read once at startup.
  public INGESTION_RATE_LIMIT_MAX = 3000;
  public INGESTION_RATE_LIMIT_WINDOW_SECONDS = 60;
  public LOGIN_RATE_LIMIT_MAX = 10;
  public LOGIN_RATE_LIMIT_WINDOW_SECONDS = 60;
  // Only enable behind a trusted reverse proxy that overwrites
  // X-Forwarded-For; otherwise clients can spoof their rate-limit key.
  public API_TRUST_PROXY = false;

  // Analytics traces stats (dashboard): bounded deterministic sampling + cache
  public ANALYTICS_STATS_SAMPLE_CAP = 20000;
  public ANALYTICS_STATS_CACHE_TTL_SECONDS = 30;
  public ANALYTICS_STATS_CACHE_MAX_ENTRIES = 100;

  // LLM Recommendation
  public LLM_API_KEY = "";
  public LLM_API_URL = "https://api.deepseek.com/chat/completions";
  public LLM_MODEL = "deepseek-chat";
  // "disabled"/"enabled" send the DeepSeek-specific `thinking` field;
  // "omit" leaves it out entirely for strict OpenAI-compatible providers.
  public LLM_THINKING_MODE = "disabled";
  public LLM_RECOMMENDATION_SCHEDULE_CRON = "20 0 * * *";
  public LLM_RECOMMENDATION_PERIOD_HOURS = 24;
  // Max root spans randomly sampled for duration percentiles (exact counts
  // are computed SQL-side regardless of this cap).
  public LLM_RECOMMENDATION_SAMPLE_CAP = 20000;
  // Overall budget for all LLM attempts (including retries and backoff).
  public LLM_RECOMMENDATION_TIMEOUT_SECONDS = 180;
  // Delay before the initial (cache-missing) generation after startup, so
  // recommendation/report generations do not all run concurrently.
  public LLM_RECOMMENDATION_STARTUP_DELAY_MINUTES = 2;

  // Static Reports
  public STATIC_REPORT_TOP_N = 30;
  public STATIC_REPORT_PERIOD_DAYS = 30;
  // Longest-traces report only; most-called has its own schedule.
  public STATIC_REPORT_SCHEDULE_CRON = "40 0 * * *";
  public MOST_CALLED_TRACES_SCHEDULE_CRON = "0 1 * * *";
  public LONGEST_TRACES_STARTUP_DELAY_MINUTES = 15;
  public MOST_CALLED_TRACES_STARTUP_DELAY_MINUTES = 25;

  // Heavy scheduled jobs: random delay after a cron fire and how long a job
  // waits for another one to finish before skipping the run.
  public SCHEDULED_JOB_JITTER_MINUTES = 5;
  public SCHEDULED_JOB_OVERLAP_WAIT_MINUTES = 30;

  // Notifications
  public NOTIFICATIONS_API = "";
  public NOTIFICATIONS_TOKEN = "";

  // Error Alerts
  public ERROR_ALERTS_EVALUATION_FREQUENCY_MINUTES = 15;
  public ERROR_ALERTS_STARTUP_DELAY_MINUTES = 1;

  constructor() {
    super("otel-light-server");

    // Override VERSION with otel-light-server's own package.json
    try {
      const pkg = fse.readJsonSync(path.resolve(__dirname, "../package.json"));
      if (pkg && pkg.version) {
        this.VERSION = pkg.version;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_e) {
      // fallback to default
    }

    // Register project-specific fields so reload() processes them
    this.addConfigField({ field: "METRICS_COMPRESS_MINUTE_THRESHOLD_HOURS" });
    this.addConfigField({ field: "METRICS_COMPRESS_HOUR_THRESHOLD_DAYS" });
    this.addConfigField({ field: "MAINTENANCE_FREQUENCY_HOURS" });
    this.addConfigField({ field: "MAINTENANCE_ORPHAN_LOOKBACK_HOURS" });
    this.addConfigField({ field: "CACHE_REFRESH_MINUTES" });
    this.addConfigField({ field: "METRICS_SELF_REFRESH_MINUTES" });
    this.addConfigField({ field: "ANALYTICS_UTILS_RESULT_LIMIT_METRICS" });
    this.addConfigField({ field: "INGESTION_BODY_LIMIT_BYTES" });
    this.addConfigField({ field: "INGESTION_RATE_LIMIT_MAX" });
    this.addConfigField({ field: "INGESTION_RATE_LIMIT_WINDOW_SECONDS" });
    this.addConfigField({ field: "LOGIN_RATE_LIMIT_MAX" });
    this.addConfigField({ field: "LOGIN_RATE_LIMIT_WINDOW_SECONDS" });
    this.addConfigField({ field: "API_TRUST_PROXY" });
    this.addConfigField({ field: "ANALYTICS_STATS_SAMPLE_CAP" });
    this.addConfigField({ field: "ANALYTICS_STATS_CACHE_TTL_SECONDS" });
    this.addConfigField({ field: "ANALYTICS_STATS_CACHE_MAX_ENTRIES" });
    this.addConfigField({ field: "LLM_API_KEY", sensitive: true });
    this.addConfigField({ field: "LLM_API_URL" });
    this.addConfigField({ field: "LLM_MODEL" });
    this.addConfigField({ field: "LLM_THINKING_MODE" });
    this.addConfigField({ field: "LLM_RECOMMENDATION_SCHEDULE_CRON" });
    this.addConfigField({ field: "LLM_RECOMMENDATION_PERIOD_HOURS" });
    this.addConfigField({ field: "LLM_RECOMMENDATION_SAMPLE_CAP" });
    this.addConfigField({ field: "LLM_RECOMMENDATION_TIMEOUT_SECONDS" });
    this.addConfigField({
      field: "LLM_RECOMMENDATION_STARTUP_DELAY_MINUTES",
    });
    this.addConfigField({ field: "STATIC_REPORT_TOP_N" });
    this.addConfigField({ field: "STATIC_REPORT_PERIOD_DAYS" });
    this.addConfigField({ field: "STATIC_REPORT_SCHEDULE_CRON" });
    this.addConfigField({ field: "MOST_CALLED_TRACES_SCHEDULE_CRON" });
    this.addConfigField({ field: "LONGEST_TRACES_STARTUP_DELAY_MINUTES" });
    this.addConfigField({
      field: "MOST_CALLED_TRACES_STARTUP_DELAY_MINUTES",
    });
    this.addConfigField({ field: "SCHEDULED_JOB_JITTER_MINUTES" });
    this.addConfigField({ field: "SCHEDULED_JOB_OVERLAP_WAIT_MINUTES" });
    this.addConfigField({ field: "NOTIFICATIONS_API" });
    this.addConfigField({ field: "NOTIFICATIONS_TOKEN", sensitive: true });
    this.addConfigField({
      field: "ERROR_ALERTS_EVALUATION_FREQUENCY_MINUTES",
    });
    this.addConfigField({ field: "ERROR_ALERTS_STARTUP_DELAY_MINUTES" });
  }

  public async reload(): Promise<void> {
    // JWT_KEY is managed at runtime by AuthInit() (per-deployment key stored
    // in the DB metadata table). A config-file/env reload must never clobber
    // it back to a committed config value like "dev" — otherwise forged
    // admin JWTs signed with the public default would be accepted.
    const jwtKey = this.JWT_KEY;
    await super.reload((message: string) => logger.info(message));
    this.JWT_KEY = jwtKey;
    this.warnIfDefaultJWTKey();

    const requestedBodyLimit = this.INGESTION_BODY_LIMIT_BYTES;
    this.INGESTION_BODY_LIMIT_BYTES = ConfigClampIngestionBodyLimit(
      requestedBodyLimit,
    );
    if (this.INGESTION_BODY_LIMIT_BYTES !== requestedBodyLimit) {
      logger.warn(
        `INGESTION_BODY_LIMIT_BYTES ${requestedBodyLimit} is invalid or out of range ` +
          `(${INGESTION_BODY_LIMIT_MIN_BYTES}-${INGESTION_BODY_LIMIT_MAX_BYTES}); ` +
          `using ${this.INGESTION_BODY_LIMIT_BYTES}.`,
      );
    }

    this.INGESTION_RATE_LIMIT_MAX = ConfigClampNumber(
      this.INGESTION_RATE_LIMIT_MAX,
      3000,
      0,
      1_000_000,
    );
    this.INGESTION_RATE_LIMIT_WINDOW_SECONDS = ConfigClampNumber(
      this.INGESTION_RATE_LIMIT_WINDOW_SECONDS,
      60,
      1,
      86400,
    );
    this.LOGIN_RATE_LIMIT_MAX = ConfigClampNumber(
      this.LOGIN_RATE_LIMIT_MAX,
      10,
      0,
      100_000,
    );
    this.LOGIN_RATE_LIMIT_WINDOW_SECONDS = ConfigClampNumber(
      this.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
      60,
      1,
      86400,
    );
    this.API_TRUST_PROXY = this.API_TRUST_PROXY === true;

    this.SCHEDULED_JOB_JITTER_MINUTES = ConfigClampNumber(
      this.SCHEDULED_JOB_JITTER_MINUTES,
      5,
      0,
      1440,
    );
    this.SCHEDULED_JOB_OVERLAP_WAIT_MINUTES = ConfigClampNumber(
      this.SCHEDULED_JOB_OVERLAP_WAIT_MINUTES,
      30,
      0,
      1440,
    );
    this.LLM_RECOMMENDATION_TIMEOUT_SECONDS = ConfigClampNumber(
      this.LLM_RECOMMENDATION_TIMEOUT_SECONDS,
      180,
      0.001,
      3600,
      false,
    );
    this.ANALYTICS_STATS_SAMPLE_CAP = ConfigClampNumber(
      this.ANALYTICS_STATS_SAMPLE_CAP,
      20000,
      1,
      1_000_000,
    );
    this.ANALYTICS_STATS_CACHE_TTL_SECONDS = ConfigClampNumber(
      this.ANALYTICS_STATS_CACHE_TTL_SECONDS,
      30,
      0,
      86400,
      false,
    );
    this.ANALYTICS_STATS_CACHE_MAX_ENTRIES = ConfigClampNumber(
      this.ANALYTICS_STATS_CACHE_MAX_ENTRIES,
      100,
      1,
      10000,
    );
  }

  public warnIfDefaultJWTKey(): void {
    if (KNOWN_DEFAULT_JWT_KEYS.includes(this.JWT_KEY)) {
      logger.error(
        "SECURITY WARNING: JWT_KEY is set to a known default value. " +
          "Remove JWT_KEY from the config file/environment and restart the " +
          "server so a unique per-deployment key is generated and stored in the database.",
      );
    }
  }
}
