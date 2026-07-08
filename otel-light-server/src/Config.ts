import { ConfigBase } from "@devopsplaybook.io/common-utils";
import * as fse from "fs-extra";
import path from "path";
import { OTelLogger } from "./OTelContext";

const logger = OTelLogger().createModuleLogger("config");

export class Config extends ConfigBase {
  // Project-specific OTel defaults (override ConfigBase empty-string defaults)
  public OPENTELEMETRY_COLLECTOR_HTTP_TRACES =
    "http://localhost:8080/v1/traces";
  public OPENTELEMETRY_COLLECTOR_HTTP_METRICS =
    "http://localhost:8080/v1/metrics";
  public OPENTELEMETRY_COLLECTOR_HTTP_LOGS = "http://localhost:8080/v1/logs";

  // Analytics & Maintenance
  public METRICS_COMPRESS_MINUTE_THRESHOLD_HOURS = 12;
  public METRICS_COMPRESS_HOUR_THRESHOLD_DAYS = 7;
  public MAINTENANCE_FREQUENCY_HOURS = 6;
  public CACHE_REFRESH_MINUTES = 10;
  public METRICS_SELF_REFRESH_MINUTES = 10;

  // API Limits
  public ANALYTICS_UTILS_RESULT_LIMIT_METRICS = 10000;

  // LLM Recommendation
  public LLM_API_KEY = "";
  public LLM_API_URL = "https://api.deepseek.com/chat/completions";
  public LLM_MODEL = "deepseek-chat";
  public LLM_RECOMMENDATION_SCHEDULE_CRON = "0 0 * * *";
  public LLM_RECOMMENDATION_PERIOD_HOURS = 24;

  // Static Reports
  public STATIC_REPORT_TOP_N = 30;
  public STATIC_REPORT_PERIOD_DAYS = 30;
  public STATIC_REPORT_SCHEDULE_CRON = "0 0 * * *";

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
    this.addConfigField({ field: "CACHE_REFRESH_MINUTES" });
    this.addConfigField({ field: "METRICS_SELF_REFRESH_MINUTES" });
    this.addConfigField({ field: "ANALYTICS_UTILS_RESULT_LIMIT_METRICS" });
    this.addConfigField({ field: "LLM_API_KEY", sensitive: true });
    this.addConfigField({ field: "LLM_API_URL" });
    this.addConfigField({ field: "LLM_MODEL" });
    this.addConfigField({ field: "LLM_RECOMMENDATION_SCHEDULE_CRON" });
    this.addConfigField({ field: "LLM_RECOMMENDATION_PERIOD_HOURS" });
    this.addConfigField({ field: "STATIC_REPORT_TOP_N" });
    this.addConfigField({ field: "STATIC_REPORT_PERIOD_DAYS" });
    this.addConfigField({ field: "STATIC_REPORT_SCHEDULE_CRON" });
  }

  public async reload(): Promise<void> {
    await super.reload((message: string) => logger.info(message));
  }
}
