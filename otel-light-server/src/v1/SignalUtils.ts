import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "../Config";
import { OTelTracer } from "../OTelContext";

let config: Config;

export async function SignalUtilsInit(context: Span, configIn: Config) {
  const span = OTelTracer().startSpan("SignalUtilsInit", context);
  config = configIn;
  span.end();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SignalUtilsGetServiceName(resource: any): string {
  return (
    resource?.attributes?.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (attr: any) => attr?.key === "service.name",
    )?.value?.stringValue || "unknown"
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SignalUtilsGetServiceVersion(resource: any): string {
  return (
    resource?.attributes?.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (attr: any) => attr?.key === "service.version",
    )?.value?.stringValue || "unknown"
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SignalUtilsCheckAuthHeader(req: any): boolean {
  if (!config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER) {
    return true;
  }
  return (
    (req.headers["authorization"] || "").replace("Bearer ", "") ===
    config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER
  );
}
