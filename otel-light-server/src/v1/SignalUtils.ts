import { timingSafeEqual } from "crypto";
import { Span } from "@opentelemetry/sdk-trace-base";
import { Config, ConfigClampIngestionBodyLimit } from "../Config";
import { OTelLogger, OTelTracer } from "../OTelContext";

const logger = OTelLogger().createModuleLogger("SignalUtils");

let config: Config;

export async function SignalUtilsInit(context: Span, configIn: Config) {
  const span = OTelTracer().startSpan("SignalUtilsInit", context);
  config = configIn;
  if (!config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER) {
    logger.warn(
      "SECURITY WARNING: /v1/* ingestion accepts unauthenticated writes; " +
        "set OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER to require a Bearer " +
        "token on POST /v1/traces, /v1/metrics and /v1/logs.",
    );
  }
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

export function SignalUtilsGetIngestionBodyLimit(): number {
  return ConfigClampIngestionBodyLimit(config?.INGESTION_BODY_LIMIT_BYTES);
}

// Canonical JSON for a stored attribute list: sorted by key so the exact same
// resource attributes always produce the same text. Metric compression groups
// by this column to keep distinct series, so attribute order must not create
// phantom series (or hide real ones).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SignalUtilsCanonicalizeAttributes(attributes: any): string {
  if (!Array.isArray(attributes)) {
    return "[]";
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sorted = [...attributes].sort((a: any, b: any) =>
    String(a?.key ?? "").localeCompare(String(b?.key ?? "")),
  );
  return JSON.stringify(sorted);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SignalUtilsCheckAuthHeader(req: any): boolean {
  if (!config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER) {
    return true;
  }
  const provided = (req.headers["authorization"] || "").replace("Bearer ", "");
  const expected = config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER;
  const authMatch =
    provided.length === expected.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!authMatch) {
    logger.warn(
      "Ingestion auth header mismatch: expected configured OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER, got " +
        (req.headers["authorization"]
          ? "Bearer ***"
          : "no authorization header"),
    );
  }
  return authMatch;
}
