import { describe, expect, it } from "vitest";
import {
  API_TOKENS_DEFAULT_EXPIRY_DAYS,
  ApiTokensExpiryIso,
  ApiTokensExpiryOptions,
  ApiTokensFormatDate,
  ApiTokensIsExpired,
} from "../services/ApiTokens";

describe("ApiTokensExpiryOptions", () => {
  it("offers 30, 90, 180 and 365 days", () => {
    expect(ApiTokensExpiryOptions.map((option) => option.days)).toEqual([
      30, 90, 180, 365,
    ]);
  });

  it("has a default that is one of the options", () => {
    expect(
      ApiTokensExpiryOptions.some(
        (option) => option.days === API_TOKENS_DEFAULT_EXPIRY_DAYS,
      ),
    ).toBe(true);
  });
});

describe("ApiTokensExpiryIso", () => {
  it("adds the chosen number of days to the supplied clock", () => {
    expect(ApiTokensExpiryIso(30, 0)).toBe(
      new Date(30 * 86_400_000).toISOString(),
    );
  });

  it("returns null for a non-positive or non-finite duration", () => {
    expect(ApiTokensExpiryIso(0, 0)).toBeNull();
    expect(ApiTokensExpiryIso(-5, 0)).toBeNull();
    expect(ApiTokensExpiryIso(Number.NaN, 0)).toBeNull();
  });
});

describe("ApiTokensIsExpired", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");

  it("is false for a future expiry", () => {
    expect(ApiTokensIsExpired("2027-01-01T00:00:00.000Z", now)).toBe(false);
  });

  it("is true for a past expiry", () => {
    expect(ApiTokensIsExpired("2025-01-01T00:00:00.000Z", now)).toBe(true);
  });

  it("is false for a missing or invalid value", () => {
    expect(ApiTokensIsExpired(null, now)).toBe(false);
    expect(ApiTokensIsExpired(undefined, now)).toBe(false);
    expect(ApiTokensIsExpired("not-a-date", now)).toBe(false);
  });
});

describe("ApiTokensFormatDate", () => {
  it("formats a valid ISO date", () => {
    expect(ApiTokensFormatDate("2026-01-02T03:04:05.000Z")).toBe(
      new Date("2026-01-02T03:04:05.000Z").toLocaleString(),
    );
  });

  it("renders an em dash for a missing or invalid value", () => {
    expect(ApiTokensFormatDate(null)).toBe("—");
    expect(ApiTokensFormatDate(undefined)).toBe("—");
    expect(ApiTokensFormatDate("not-a-date")).toBe("—");
  });
});
