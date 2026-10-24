import { beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "../services/AuthService";

const AUTH_TOKEN_KEY = "auth_token";

function makeToken(payload: unknown): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" })
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u-1",
    userName: "alice",
    role: "user",
    scopes: ["traces"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

describe("AuthService token validation", () => {
  beforeEach(() => {
    AuthService.removeToken();
    localStorage.clear();
  });

  it("rejects and removes a token without exp", () => {
    localStorage.setItem(
      AUTH_TOKEN_KEY,
      makeToken(validPayload({ exp: undefined }))
    );

    expect(AuthService.getToken()).toBeNull();
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });

  it("rejects and removes an expired token", () => {
    localStorage.setItem(
      AUTH_TOKEN_KEY,
      makeToken(validPayload({ exp: Math.floor(Date.now() / 1000) - 60 }))
    );

    expect(AuthService.getToken()).toBeNull();
    expect(AuthService.getTokenInfo()).toBeNull();
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });

  it("accepts a token with a future exp and exposes role and scopes", () => {
    AuthService.saveToken(makeToken(validPayload()));

    expect(AuthService.isAuthenticated()).toBe(true);
    expect(AuthService.getTokenInfo()).toMatchObject({
      userId: "u-1",
      role: "user",
      scopes: ["traces"],
    });
    expect(AuthService.hasScope("traces")).toBe(true);
    expect(AuthService.hasScope("logs")).toBe(false);
  });

  it("rejects a malformed token", () => {
    localStorage.setItem(AUTH_TOKEN_KEY, "not-a-jwt");

    expect(AuthService.getToken()).toBeNull();
  });

  it("does not authenticate when saving a token without exp", () => {
    AuthService.saveToken(makeToken({ userId: "u-1", role: "admin" }));

    expect(AuthService.isAuthenticated()).toBe(false);
    expect(AuthService.isAdmin()).toBe(false);
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });
});
