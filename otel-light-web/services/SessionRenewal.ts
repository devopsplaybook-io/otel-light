import axios from "axios";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";

// Sliding session: renew once 80% of the token lifetime is spent, so a user
// keeping the app open (or reopening it) never falls back to the login form
// while the absolute server-side session cap allows it.
export const SESSION_RENEWAL_RATIO = 0.2;
export const SESSION_RENEWAL_MIN_DELAY_MS = 1_000;
export const SESSION_RENEWAL_MAX_DELAY_MS = 24 * 60 * 60 * 1_000;

export interface SessionClaims {
  exp?: number;
  iat?: number;
}

/** Renewal is due when 20% or less of the token lifetime remains. */
export function SessionRenewalIsDue(
  claims: SessionClaims,
  nowMs: number,
): boolean {
  if (typeof claims?.exp !== "number" || typeof claims?.iat !== "number") {
    return false;
  }
  const lifetimeMs = (claims.exp - claims.iat) * 1_000;
  if (lifetimeMs <= 0) {
    return false;
  }
  return claims.exp * 1_000 - nowMs <= lifetimeMs * SESSION_RENEWAL_RATIO;
}

/** Delay until the renewal threshold is reached, clamped to sane bounds. */
export function SessionRenewalDelayMs(
  claims: SessionClaims,
  nowMs: number,
): number {
  if (typeof claims?.exp !== "number" || typeof claims?.iat !== "number") {
    return SESSION_RENEWAL_MAX_DELAY_MS;
  }
  const lifetimeMs = (claims.exp - claims.iat) * 1_000;
  if (lifetimeMs <= 0) {
    return SESSION_RENEWAL_MIN_DELAY_MS;
  }
  const dueAtMs = claims.exp * 1_000 - lifetimeMs * SESSION_RENEWAL_RATIO;
  return Math.min(
    SESSION_RENEWAL_MAX_DELAY_MS,
    Math.max(SESSION_RENEWAL_MIN_DELAY_MS, dueAtMs - nowMs),
  );
}

/** The session is not usable anymore: the user must sign in again. */
export function SessionRenewalIsAuthError(error: any): boolean {
  const status = error?.response?.status;
  return status === 401 || status === 403;
}

export async function SessionRenewalRefresh(): Promise<string> {
  const response = await axios.post(
    `${SERVER_URL}/users/session/refresh`,
    {},
    await AuthService.getAuthHeader(),
  );
  AuthService.saveToken(response.data.token);
  return response.data.token;
}
