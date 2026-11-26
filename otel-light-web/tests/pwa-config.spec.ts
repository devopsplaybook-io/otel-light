// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";

interface PwaConfig {
  registerType?: string;
  updateViaCache?: string;
  manifest?: {
    name?: string;
    start_url?: string;
    icons?: Array<{ src?: string }>;
  };
  generateSW?: {
    skipWaiting?: boolean;
    clientsClaim?: boolean;
    globIgnores?: string[];
    navigateFallbackDenylist?: RegExp[];
  };
  workbox?: { skipWaiting?: boolean; clientsClaim?: boolean };
}

interface NuxtConfig {
  alias?: Record<string, string>;
  build?: { transpile?: string[] };
  pwa?: PwaConfig;
}

describe("nuxt.config PWA prompt mode", () => {
  let config: NuxtConfig;

  beforeAll(async () => {
    // nuxt.config.ts calls the Nuxt global; stub it for the plain import
    (globalThis as Record<string, unknown>).defineNuxtConfig ??= (
      value: unknown,
    ) => value;
    config = (await import("../nuxt.config")).default as NuxtConfig;
  });

  it("waits for the user before activating a new build", () => {
    expect(config.pwa?.registerType).toBe("prompt");
    expect(config.pwa?.updateViaCache).toBe("none");
    // prompt mode implies the waiting worker stays parked: no automatic
    // activation or page claim at install.
    expect(config.pwa?.generateSW?.skipWaiting).toBeUndefined();
    expect(config.pwa?.generateSW?.clientsClaim).toBeUndefined();
    expect(config.pwa?.workbox?.skipWaiting).toBeUndefined();
    expect(config.pwa?.workbox?.clientsClaim).toBeUndefined();
  });

  it("keeps the existing web app manifest", () => {
    expect(config.pwa?.manifest?.name).toBe("APPLICATION_TITLE");
    expect(config.pwa?.manifest?.start_url).toBe("/");
    expect(config.pwa?.manifest?.icons).toEqual([
      { src: "images/logo.png", sizes: "512x512", type: "image/png" },
    ]);
  });

  it("does not rely on globIgnores (the module re-adds the build manifest)", () => {
    expect(config.pwa?.generateSW?.globIgnores).toBeUndefined();
  });

  it("consumes common-web raw sources through Vite", () => {
    expect(config.alias?.["@devopsplaybook.io/common-web"]).toContain(
      "node_modules/@devopsplaybook.io/common-web",
    );
    expect(config.build?.transpile).toContain(
      "@devopsplaybook.io/common-web",
    );
  });
});
