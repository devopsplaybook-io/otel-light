import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axios", () => ({ default: { post: vi.fn() } }));

import { AuthService } from "../services/AuthService";
import {
  SESSION_RENEWAL_MAX_DELAY_MS,
  SESSION_RENEWAL_MIN_DELAY_MS,
  SessionRenewalDelayMs,
  SessionRenewalIsAuthError,
  SessionRenewalRefresh,
} from "../services/SessionRenewal";

const NOW_MS = 1_700_000_000_000;
const NOW_SECONDS = NOW_MS / 1000;

function makeToken(expSeconds: number): string {
  const encode = (payload: any) =>
    Buffer.from(JSON.stringify(payload)).toString("base64url");
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({
      userId: "user-1",
      userName: "admin",
      role: "admin",
      scopes: ["traces", "metrics", "logs"],
      exp: expSeconds,
    }),
    "signature",
  ].join(".");
}

describe("SessionRenewalDelayMs", () => {
  it("renews immediately for an expired token", () => {
    expect(SessionRenewalDelayMs(NOW_SECONDS - 1, NOW_MS)).toBe(0);
  });

  it("renews halfway through the remaining lifetime", () => {
    expect(SessionRenewalDelayMs(NOW_SECONDS + 100, NOW_MS)).toBe(50_000);
  });

  it("caps the delay at 24 hours", () => {
    expect(
      SessionRenewalDelayMs(NOW_SECONDS + 3 * 24 * 60 * 60, NOW_MS),
    ).toBe(SESSION_RENEWAL_MAX_DELAY_MS);
  });

  it("never schedules faster than one second", () => {
    expect(SessionRenewalDelayMs(NOW_SECONDS + 1, NOW_MS)).toBe(
      SESSION_RENEWAL_MIN_DELAY_MS,
    );
  });
});

describe("SessionRenewalIsAuthError", () => {
  it("treats 401 and 403 as auth errors", () => {
    expect(SessionRenewalIsAuthError({ response: { status: 401 } })).toBe(true);
    expect(SessionRenewalIsAuthError({ response: { status: 403 } })).toBe(true);
  });

  it("treats other failures as transient", () => {
    expect(SessionRenewalIsAuthError({ response: { status: 500 } })).toBe(false);
    expect(SessionRenewalIsAuthError(new Error("network"))).toBe(false);
  });
});

describe("SessionRenewalRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AuthService.removeToken();
  });

  it("posts to the refresh endpoint and stores the returned token", async () => {
    const realNowSeconds = Math.floor(Date.now() / 1000);
    const oldToken = makeToken(realNowSeconds + 3_600);
    const newToken = makeToken(realNowSeconds + 7_200);
    AuthService.saveToken(oldToken);
    vi.mocked(axios.post).mockResolvedValue({ data: { token: newToken } });

    const returned = await SessionRenewalRefresh();

    expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
      "/api/users/session/refresh",
      {},
      { headers: { Authorization: `Bearer ${oldToken}` } },
    );
    expect(returned).toBe(newToken);
    expect(AuthService.getToken()).toBe(newToken);
  });
});
