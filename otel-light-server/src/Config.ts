import { ConfigBase } from "@devopsplaybook.io/common-utils";
import * as fse from "fs-extra";
import path from "path";
import { OTelLogger } from "./OTelContext";

const logger = OTelLogger().createModuleLogger("config");

const KNOWN_DEFAULT_JWT_KEYS = ["dev"];

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

  // LLM Recommendation
  public LLM_API_KEY = "";
  public LLM_API_URL = "https://api.deepseek.com/chat/completions";
  public LLM_MODEL = "deepseek-chat";
  // "disabled"/"enabled" send the DeepSeek-specific `thinking` field;
  // "omit" leaves it out entirely for strict OpenAI-compatible providers.
  public LLM_THINKING_MODE = "disabled";
  public LLM_RECOMMENDATION_SCHEDULE_CRON = "0 0 * * *";
  public LLM_RECOMMENDATION_PERIOD_HOURS = 24;
  // Max root spans randomly sampled for duration percentiles (exact counts
  // are computed SQL-side regardless of this cap).
  public LLM_RECOMMENDATION_SAMPLE_CAP = 20000;
  // Delay before the initial (cache-missing) generation after startup, so
  // recommendation/report generations do not all run concurrently.
  public LLM_RECOMMENDATION_STARTUP_DELAY_MINUTES = 2;

  // Static Reports
  public STATIC_REPORT_TOP_N = 30;
  public STATIC_REPORT_PERIOD_DAYS = 30;
  public STATIC_REPORT_SCHEDULE_CRON = "0 0 * * *";
  public LONGEST_TRACES_STARTUP_DELAY_MINUTES = 15;
  public MOST_CALLED_TRACES_STARTUP_DELAY_MINUTES = 25;

  // Notifications
  public NOTIFICATIONS_API = "";
  public NOTIFICATIONS_TOKEN = "";

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
    this.addConfigField({ field: "LLM_API_KEY", sensitive: true });
    this.addConfigField({ field: "LLM_API_URL" });
    this.addConfigField({ field: "LLM_MODEL" });
    this.addConfigField({ field: "LLM_THINKING_MODE" });
    this.addConfigField({ field: "LLM_RECOMMENDATION_SCHEDULE_CRON" });
    this.addConfigField({ field: "LLM_RECOMMENDATION_PERIOD_HOURS" });
    this.addConfigField({ field: "LLM_RECOMMENDATION_SAMPLE_CAP" });
    this.addConfigField({
      field: "LLM_RECOMMENDATION_STARTUP_DELAY_MINUTES",
    });
    this.addConfigField({ field: "STATIC_REPORT_TOP_N" });
    this.addConfigField({ field: "STATIC_REPORT_PERIOD_DAYS" });
    this.addConfigField({ field: "STATIC_REPORT_SCHEDULE_CRON" });
    this.addConfigField({ field: "LONGEST_TRACES_STARTUP_DELAY_MINUTES" });
    this.addConfigField({
      field: "MOST_CALLED_TRACES_STARTUP_DELAY_MINUTES",
    });
    this.addConfigField({ field: "NOTIFICATIONS_API" });
    this.addConfigField({ field: "NOTIFICATIONS_TOKEN", sensitive: true });
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
