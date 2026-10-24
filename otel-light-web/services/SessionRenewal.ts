import axios from "axios";
import { AuthService } from "~~/services/AuthService";
import { SERVER_URL } from "~~/services/Config";

export const SESSION_RENEWAL_MIN_DELAY_MS = 1_000;
export const SESSION_RENEWAL_MAX_DELAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Renew halfway through the remaining token lifetime, so a long-lived tab
 * keeps a valid session while a nearly expired one renews immediately.
 */
export function SessionRenewalDelayMs(
  expSeconds: number,
  nowMs: number,
): number {
  if (!Number.isFinite(expSeconds) || !Number.isFinite(nowMs)) {
    return 0;
  }
  const remainingMs = expSeconds * 1_000 - nowMs;
  if (remainingMs <= 0) {
    return 0;
  }
  return Math.min(
    SESSION_RENEWAL_MAX_DELAY_MS,
    Math.max(SESSION_RENEWAL_MIN_DELAY_MS, Math.floor(remainingMs / 2)),
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
