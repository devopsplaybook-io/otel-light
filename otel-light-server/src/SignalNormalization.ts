// Signal values are normalized at ingestion so the database only receives
// values its schema can store on both SQLite and PostgreSQL. Severity text is
// canonicalized to the uppercase OTLP set so list filters, stats and error
// alerts can compare one exact value.

// Largest value a signed BIGINT (PostgreSQL) can hold, in nanoseconds.
export const SIGNAL_MAX_TIME_UNIX_NANO = 9_000_000_000_000_000_000;
export const SIGNAL_LOG_TEXT_MAX_LENGTH = 65_536;
export const SIGNAL_ID_MAX_LENGTH = 50;
export const SIGNAL_NAME_MAX_LENGTH = 2_000;
export const SIGNAL_KEYWORDS_MAX_LENGTH = 4_000;

const SEVERITY_MAX_LENGTH = 50;
const SEVERITY_SUFFIXES = ["1", "2", "3", "4"];
const CANONICAL_SEVERITIES = new Set([
  "TRACE",
  "DEBUG",
  "INFO",
  "WARN",
  "ERROR",
  "FATAL",
]);
const SEVERITY_ALIASES: Record<string, string> = {
  WARNING: "WARN",
  INFORMATION: "INFO",
  NOTICE: "INFO",
  ERR: "ERROR",
  CRITICAL: "FATAL",
  CRIT: "FATAL",
  ALERT: "FATAL",
  EMERG: "FATAL",
  EMERGENCY: "FATAL",
};

export type SignalTimeParseResult =
  | { kind: "missing" }
  | { kind: "valid"; value: number }
  | { kind: "invalid" };

export function SignalNormalizationText(value: unknown): string {
  if (typeof value === "string") {
    return value.split("\u0000").join("");
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  return "";
}

export function SignalNormalizationTruncate(
  value: unknown,
  maxLength: number,
): string {
  return SignalNormalizationText(value).substring(0, maxLength);
}

export function SignalNormalizationId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const id = value.split("\u0000").join("").trim();
  return id ? id.substring(0, SIGNAL_ID_MAX_LENGTH) : null;
}

function SignalNormalizationSeverityFromNumber(value: unknown): string {
  let numberValue: number;
  if (typeof value === "number") {
    numberValue = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    numberValue = Number(value);
  } else {
    return "";
  }
  if (
    !Number.isInteger(numberValue) ||
    numberValue < 1 ||
    numberValue > 24
  ) {
    return "";
  }
  if (numberValue <= 4) return "TRACE";
  if (numberValue <= 8) return "DEBUG";
  if (numberValue <= 12) return "INFO";
  if (numberValue <= 16) return "WARN";
  if (numberValue <= 20) return "ERROR";
  return "FATAL";
}

export function SignalNormalizationSeverity(
  severityText: unknown,
  severityNumber?: unknown,
): string {
  let severity = SignalNormalizationText(severityText).trim().toUpperCase();
  if (!severity) {
    return SignalNormalizationSeverityFromNumber(severityNumber);
  }
  if (SEVERITY_SUFFIXES.includes(severity.charAt(severity.length - 1))) {
    const base = severity.slice(0, -1);
    // Only a known base loses its numeric suffix; custom values are kept.
    if (CANONICAL_SEVERITIES.has(base) || base in SEVERITY_ALIASES) {
      severity = base;
    }
  }
  severity = SEVERITY_ALIASES[severity] ?? severity;
  return severity.substring(0, SEVERITY_MAX_LENGTH);
}

export function SignalNormalizationTimeUnixNano(
  value: unknown,
): SignalTimeParseResult {
  if (value === undefined || value === null) {
    return { kind: "missing" };
  }
  if (typeof value === "string" && value.trim() === "") {
    return { kind: "missing" };
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return { kind: "invalid" };
  }
  const time = typeof value === "number" ? value : Number(value);
  if (
    !Number.isInteger(time) ||
    time <= 0 ||
    time > SIGNAL_MAX_TIME_UNIX_NANO
  ) {
    return { kind: "invalid" };
  }
  return { kind: "valid", value: time };
}
