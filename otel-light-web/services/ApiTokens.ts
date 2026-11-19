export const API_TOKENS_DEFAULT_EXPIRY_DAYS = 90;

export interface ApiTokenExpiryOption {
  label: string;
  days: number;
}

export const ApiTokensExpiryOptions: ApiTokenExpiryOption[] = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "180 days", days: 180 },
  { label: "365 days", days: 365 },
];

const DAY_MS = 86_400_000;

/** ISO-8601 expiry timestamp, or null when the number of days is invalid. */
export function ApiTokensExpiryIso(
  days: number,
  nowMs: number = Date.now(),
): string | null {
  if (!Number.isFinite(days) || days <= 0) {
    return null;
  }
  return new Date(nowMs + days * DAY_MS).toISOString();
}

/** False for a missing or unparseable value (unknown is never "expired"). */
export function ApiTokensIsExpired(
  expiresAt?: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!expiresAt) {
    return false;
  }
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) {
    return false;
  }
  return expiresMs <= nowMs;
}

/** Localized date, or an em dash for a missing/unparseable value. */
export function ApiTokensFormatDate(value?: string | null): string {
  if (!value) {
    return "—";
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return "—";
  }
  return new Date(ms).toLocaleString();
}
