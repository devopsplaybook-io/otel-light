import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { Span } from "@opentelemetry/sdk-trace-base";
import {
  ATTR_NETWORK_LOCAL_ADDRESS,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import * as os from "os";
import { Config } from "../Config";
import { StandardTracerStartSpan } from "./StandardTracer";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { SeverityNumber } from "@opentelemetry/api-logs";

let loggerOTEL;

export function LoggerInit(context: Span, config: Config) {
  const span = StandardTracerStartSpan("LoggerInit", context);

  if (config.OPENTELEMETRY_COLLECTOR_HTTP_LOGS) {
    const exporterHeaders: Record<string, string> = {};
    if (config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER) {
      exporterHeaders["Authorization"] =
        config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER;
    }
    const exporter = new OTLPLogExporter({
      url: config.OPENTELEMETRY_COLLECTOR_HTTP_LOGS,
      headers: exporterHeaders,
    });

    const loggerProvider = new LoggerProvider({
      processors: [
        new BatchLogRecordProcessor(exporter, {
          maxQueueSize: 100,
          scheduledDelayMillis:
            config.OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS * 1000,
        }),
      ],
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: `${config.SERVICE_ID}`,
        [ATTR_SERVICE_VERSION]: `${config.VERSION}`,
        [ATTR_NETWORK_LOCAL_ADDRESS]: os.hostname(),
      }),
    });

    loggerOTEL = loggerProvider.getLogger(
      `${config.SERVICE_ID}:${config.VERSION}`
    );
  }
  span.end();
}

const DEV_MODE = (() => {
  if (process.env.NODE_ENV === "dev") {
    return true;
  }
  return false;
})();

export class Logger {
  private module: string;

  constructor(module: string) {
    this.module = `${module}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public debug(message: Error | string | any): void {
    if (DEV_MODE) {
      this.display("debug", message, SeverityNumber.DEBUG);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public info(message: Error | string | any): void {
    this.display("info", message, SeverityNumber.WARN);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public warn(message: Error | string | any): void {
    this.display("warn", message, SeverityNumber.WARN);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public error(message: Error | string | any): void {
    this.display("error", message, SeverityNumber.ERROR);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private display(
    level: string,
    message: any,
    severityNumber = SeverityNumber.INFO
  ): void {
    if (typeof message === "string") {
      // eslint:disable-next-line:no-console
      console.log(`[${level}] [${this.module}] ${message}`);
    } else if (message instanceof Error) {
      // eslint:disable-next-line:no-console
      console.log(`${level} [${this.module}] ${message}`);
      // eslint:disable-next-line:no-console
      console.log((message as Error).stack);
    } else if (typeof message === "object") {
      // eslint:disable-next-line:no-console
      console.log(`${level} [${this.module}] ${JSON.stringify(message)}`);
    }
    if (loggerOTEL) {
      {
        loggerOTEL.emit({
          severityNumber,
          severityText: level,
          body: message,
          attributes: { "log.type": "custom" },
        });
      }
    }
  }
}
