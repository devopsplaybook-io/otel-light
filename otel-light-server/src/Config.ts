import * as fse from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import { Logger } from "./utils-std-ts/Logger";
import { ConfigInterface } from "./utils-std-ts/models/ConfigInterface";

const logger = new Logger("config");

export class Config implements ConfigInterface {
  //
  public readonly CONFIG_FILE: string = "config.json";
  public readonly SERVICE_ID = "otel-light-server";
  public VERSION = 1;
  public readonly API_PORT: number = 8080;
  public JWT_VALIDITY_DURATION: number = 3 * 31 * 24 * 3600;
  public CORS_POLICY_ORIGIN: string;
  public DATA_DIR = process.env.DATA_DIR || "/data";
  public JWT_KEY: string = uuidv4();
  public LOG_LEVEL = "info";
  public LOGS_RETENTION_DAYS = 30;
  public METRICS_RETENTION_DAYS = 30;
  public TRACES_RETENTION_DAYS = 30;
  public OPENTELEMETRY_COLLECTOR_HTTP: string =
    process.env.OPENTELEMETRY_COLLECTOR_HTTP || "";
  public OPENTELEMETRY_COLLECTOR_AWS =
    process.env.OPENTELEMETRY_COLLECTOR_AWS === "true";

  public async reload(): Promise<void> {
    const content = await fse.readJson(this.CONFIG_FILE);
    const setIfSet = (field: string, displayLog = true) => {
      if (content[field]) {
        this[field] = content[field];
      }
      if (displayLog) {
        logger.info(`Configuration Value: ${field}: ${this[field]}`);
      } else {
        logger.info(`Configuration Value: ${field}: ********************`);
      }
    };
    logger.info(`Configuration Value: CONFIG_FILE: ${this.CONFIG_FILE}`);
    logger.info(`Configuration Value: VERSION: ${this.VERSION}`);
    setIfSet("JWT_VALIDITY_DURATION");
    setIfSet("CORS_POLICY_ORIGIN");
    setIfSet("DATA_DIR");
    setIfSet("JWT_KEY", false);
    setIfSet("LOG_LEVEL");
    setIfSet("LOGS_RETENTION_DAYS");
    setIfSet("METRICS_RETENTION_DAYS");
    setIfSet("TRACES_RETENTION_DAYS");
    setIfSet("OPENTELEMETRY_COLLECTOR_HTTP");
    setIfSet("OPENTELEMETRY_COLLECTOR_AWS");
  }
}
