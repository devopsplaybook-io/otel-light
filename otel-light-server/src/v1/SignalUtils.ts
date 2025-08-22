import { find } from "lodash";
import { Logger } from "../utils-std-ts/Logger";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "../Config";

const logger = new Logger("SignalUtils");
let config: Config;

export async function SignalUtilsInit(context: Span, configIn: Config) {
  const span = StandardTracerStartSpan("SignalUtilsInit", context);

  config = configIn;
  span.end();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SignalUtilsGetServiceName(resource: any): string {
  return (
    find(resource.attributes, { key: "service.name" })?.value?.stringValue ||
    "unknown"
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SignalUtilsGetServiceVersion(resource: any): string {
  return (
    find(resource.attributes, { key: "service.version" })?.value?.stringValue ||
    "unknown"
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SignalUtilsCheckAuthHeader(req: any): boolean {
  if (!config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER) {
    return true;
  }
  return (
    !!req.headers["authorization"] &&
    req.headers["authorization"].replace("Bearer ", "") ===
      config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER
  );
}
