import { afterEach, describe, expect, it } from "vitest";
import { UtilsGenerateId } from "../services/Utils";

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "crypto",
);

function setCrypto(value: any): void {
  Object.defineProperty(globalThis, "crypto", {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (originalCryptoDescriptor) {
    Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
  }
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("UtilsGenerateId", () => {
  it("uses crypto.randomUUID when available", () => {
    const expected = "123e4567-e89b-42d3-a456-426614174000";
    setCrypto({ randomUUID: () => expected });
    expect(UtilsGenerateId()).toBe(expected);
  });

  it("falls back to crypto.getRandomValues when randomUUID is missing", () => {
    setCrypto({
      getRandomValues: (array: Uint8Array) => {
        for (let i = 0; i < array.length; i++) {
          array[i] = (i * 7 + 1) % 256;
        }
        return array;
      },
    });
    expect(UtilsGenerateId()).toMatch(UUID_RE);
  });

  it("returns unique IDs across calls", () => {
    if (!originalCryptoDescriptor) {
      return;
    }
    setCrypto(originalCryptoDescriptor.value);
    const ids = new Set(Array.from({ length: 100 }, () => UtilsGenerateId()));
    expect(ids.size).toBe(100);
  });

  it("returns a short rule ID without any crypto API", () => {
    setCrypto(undefined);
    const id = UtilsGenerateId();
    expect(id).toMatch(/^rule-[a-z0-9]+-[a-z0-9]+$/);
    expect(id.length).toBeLessThanOrEqual(80);
  });
});
