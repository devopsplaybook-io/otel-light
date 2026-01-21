import { ConfigOTelInterface } from "@devopsplaybook.io/otel-utils";
import * as fse from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import { OTelLogger } from "./OTelContext";
import path from "path";

const logger = OTelLogger().createModuleLogger("config");

export class Config implements ConfigOTelInterface {
  //
  public readonly CONFIG_FILE: string = "config.json";
  public readonly SERVICE_ID = "otel-light-server";
  public VERSION = "1";
  public readonly API_PORT: number = 8080;
  public JWT_VALIDITY_DURATION: number = 3 * 31 * 24 * 3600;
  public CORS_POLICY_ORIGIN: string;
  public DATA_DIR = process.env.DATA_DIR || "/data";
  public JWT_KEY: string = uuidv4();
  public LOG_LEVEL = "info";
  public OPENTELEMETRY_COLLECTOR_HTTP_TRACES: string =
    process.env.OPENTELEMETRY_COLLECTOR_HTTP_TRACES ||
    "http://localhost:8080/v1/traces";
  public OPENTELEMETRY_COLLECTOR_HTTP_METRICS: string =
    process.env.OPENTELEMETRY_COLLECTOR_HTTP_METRICS ||
    "http://localhost:8080/v1/metrics";
  public OPENTELEMETRY_COLLECTOR_HTTP_LOGS: string =
    process.env.OPENTELEMETRY_COLLECTOR_HTTP_LOGS ||
    "http://localhost:8080/v1/logs";
  public OPENTELEMETRY_COLLECTOR_AWS =
    process.env.OPENTELEMETRY_COLLECTOR_AWS === "true";
  public OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS = 60;
  public OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS = 60;
  public OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER =
    process.env.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER || "";
  public METRICS_COMPRESS_MINUTE_THRESHOLD_HOURS = 12;
  public METRICS_COMPRESS_HOUR_THRESHOLD_DAYS = 7;
  public MAINTENANCE_FREQUENCY_HOURS = 6;
  // Database configuration
  public DATABASE_TYPE: "sqlite" | "postgres" = "sqlite";
  public DATABASE_POSTGRES_HOST: string;
  public DATABASE_POSTGRES_PORT: number;
  public DATABASE_POSTGRES_USER: string;
  public DATABASE_POSTGRES_PASSWORD: string;
  public DATABASE_POSTGRES_DATABASE: string;

  constructor() {
    let version = "1";
    try {
      const pkg = fse.readJsonSync(path.resolve(__dirname, "../package.json"));
      if (pkg && pkg.version) {
        version = pkg.version;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_e) {
      // fallback to default "1"
    }
    this.VERSION = version;
  }

  public async reload(): Promise<void> {
    const content = await fse.readJson(this.CONFIG_FILE);
    const setIfSet = (field: string, displayLog = true) => {
      let fromEnv = "defaults";
      if (process.env[field]) {
        this[field] = process.env[field];
        fromEnv = "environment";
      } else if (content[field]) {
        this[field] = content[field];
        fromEnv = "config";
      }
      if (displayLog) {
        logger.info(
          `Configuration Value: ${field}: ${this[field]} (from ${fromEnv})`,
        );
      } else {
        logger.info(
          `Configuration Value: ${field}: ******************** (from ${fromEnv})`,
        );
      }
    };
    logger.info(`Configuration Value: CONFIG_FILE: ${this.CONFIG_FILE}`);
    logger.info(`Configuration Value: VERSION: ${this.VERSION}`);
    setIfSet("JWT_VALIDITY_DURATION");
    setIfSet("CORS_POLICY_ORIGIN");
    setIfSet("DATA_DIR");
    setIfSet("JWT_KEY", false);
    setIfSet("LOG_LEVEL");
    setIfSet("OPENTELEMETRY_COLLECTOR_HTTP_TRACES");
    setIfSet("OPENTELEMETRY_COLLECTOR_HTTP_METRICS");
    setIfSet("OPENTELEMETRY_COLLECTOR_HTTP_LOGS");
    setIfSet("OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS");
    setIfSet("OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS");
    setIfSet("OPENTELEMETRY_COLLECTOR_AWS");
    setIfSet("OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER", false);
    setIfSet("METRICS_COMPRESS_MINUTE_THRESHOLD_HOURS");
    setIfSet("METRICS_COMPRESS_HOUR_THRESHOLD_DAYS");
    setIfSet("MAINTENANCE_FREQUENCY_HOURS");
    setIfSet("DATABASE_TYPE");
    setIfSet("DATABASE_POSTGRES_HOST");
    setIfSet("DATABASE_POSTGRES_PORT");
    setIfSet("DATABASE_POSTGRES_USER");
    setIfSet("DATABASE_POSTGRES_PASSWORD", false);
    setIfSet("DATABASE_POSTGRES_DATABASE");
  }
}
