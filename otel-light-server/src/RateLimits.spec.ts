import Fastify from "fastify";
import {
  RateLimitsInit,
  RateLimitsRouteConfig,
  RateLimitsSettings,
} from "./RateLimits";

const SETTINGS: RateLimitsSettings = {
  INGESTION_RATE_LIMIT_MAX: 3000,
  INGESTION_RATE_LIMIT_WINDOW_SECONDS: 60,
  LOGIN_RATE_LIMIT_MAX: 10,
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60,
};

describe("RateLimitsRouteConfig", () => {
  it.each(["/v1/traces", "/v1/metrics", "/v1/logs"])(
    "limits POST %s with the ingestion budget",
    (url) => {
      const config = RateLimitsRouteConfig("POST", url, SETTINGS);
      expect(config).not.toBeNull();
      expect(config?.max).toBe(3000);
      expect(config?.timeWindow).toBe(60_000);
    },
  );

  it("normalizes method names and arrays", () => {
    expect(RateLimitsRouteConfig("post", "/v1/logs", SETTINGS)).not.toBeNull();
    expect(
      RateLimitsRouteConfig(["GET", "post"], "/v1/logs", SETTINGS),
    ).not.toBeNull();
  });

  it("ignores the query string and a trailing slash", () => {
    expect(
      RateLimitsRouteConfig("POST", "/v1/logs/?foo=bar", SETTINGS),
    ).not.toBeNull();
  });

  it("does not limit GET routes", () => {
    expect(RateLimitsRouteConfig("GET", "/v1/logs", SETTINGS)).toBeNull();
  });

  it("does not limit unrelated POST routes", () => {
    expect(
      RateLimitsRouteConfig("POST", "/api/settings/maintenance", SETTINGS),
    ).toBeNull();
  });

  it("disables the ingestion limit when max is 0", () => {
    expect(
      RateLimitsRouteConfig("POST", "/v1/traces", {
        ...SETTINGS,
        INGESTION_RATE_LIMIT_MAX: 0,
      }),
    ).toBeNull();
  });

  it("uses the login budget for POST /api/users/session", () => {
    const config = RateLimitsRouteConfig(
      "POST",
      "/api/users/session",
      SETTINGS,
    );
    expect(config?.max).toBe(10);
    expect(config?.timeWindow).toBe(60_000);
  });

  it("builds a per-IP + per-username login key", () => {
    const config = RateLimitsRouteConfig(
      "POST",
      "/api/users/session",
      SETTINGS,
    );
    const key = config?.keyGenerator({
      ip: "203.0.113.5",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(key).toBe("203.0.113.5:");
  });

  it("lowercases, trims and caps the username in the login key", () => {
    const config = RateLimitsRouteConfig(
      "POST",
      "/api/users/session",
      SETTINGS,
    );
    const key = config?.keyGenerator({
      ip: "10.0.0.1",
      body: { name: `  ${"A".repeat(300)}  ` },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(key).toBe(`10.0.0.1:${"a".repeat(255)}`);

    const mixed = config?.keyGenerator({
      ip: "10.0.0.1",
      body: { name: "  Alice  " },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(mixed).toBe("10.0.0.1:alice");
  });

  it("disables the login limit when max is 0", () => {
    expect(
      RateLimitsRouteConfig("POST", "/api/users/session", {
        ...SETTINGS,
        LOGIN_RATE_LIMIT_MAX: 0,
      }),
    ).toBeNull();
  });
});

describe("RateLimitsInit", () => {
  const buildServer = async (settings: RateLimitsSettings) => {
    const fastify = Fastify();
    await RateLimitsInit(fastify, settings);
    fastify.post("/v1/traces", async () => ({ ok: true }));
    fastify.post("/v1/metrics", async () => ({ ok: true }));
    fastify.post("/v1/logs", async () => ({ ok: true }));
    fastify.post("/api/users/session", async () => ({ ok: true }));
    fastify.get("/api/status", async () => ({ started: true }));
    await fastify.ready();
    return fastify;
  };

  it("returns 429 with Retry-After and RATE_LIMITED on the third ingestion request", async () => {
    const fastify = await buildServer({
      ...SETTINGS,
      INGESTION_RATE_LIMIT_MAX: 2,
    });

    expect(
      (await fastify.inject({ method: "POST", url: "/v1/traces" })).statusCode,
    ).toBe(200);
    expect(
      (await fastify.inject({ method: "POST", url: "/v1/traces" })).statusCode,
    ).toBe(200);

    const limited = await fastify.inject({
      method: "POST",
      url: "/v1/traces",
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(limited.json()).toMatchObject({
      statusCode: 429,
      error: "Too Many Requests",
      code: "RATE_LIMITED",
    });
    expect(limited.json().message).toContain("Rate limit exceeded");

    await fastify.close();
  });

  it("keeps login buckets separate per username from the same IP", async () => {
    const fastify = await buildServer({
      ...SETTINGS,
      LOGIN_RATE_LIMIT_MAX: 2,
    });

    const login = (name: string) =>
      fastify.inject({
        method: "POST",
        url: "/api/users/session",
        payload: { name },
      });

    expect((await login("alice")).statusCode).toBe(200);
    expect((await login("alice")).statusCode).toBe(200);
    expect((await login("alice")).statusCode).toBe(429);
    // A different user from the same IP still has its own bucket.
    expect((await login("bob")).statusCode).toBe(200);

    await fastify.close();
  });

  it("does not limit unrelated GET routes", async () => {
    const fastify = await buildServer({
      ...SETTINGS,
      INGESTION_RATE_LIMIT_MAX: 1,
    });

    for (let i = 0; i < 3; i++) {
      const res = await fastify.inject({ method: "GET", url: "/api/status" });
      expect(res.statusCode).toBe(200);
    }

    await fastify.close();
  });

  it("does not limit any route when max is 0", async () => {
    const fastify = await buildServer({
      ...SETTINGS,
      INGESTION_RATE_LIMIT_MAX: 0,
      LOGIN_RATE_LIMIT_MAX: 0,
    });

    for (let i = 0; i < 3; i++) {
      expect(
        (await fastify.inject({ method: "POST", url: "/v1/logs" })).statusCode,
      ).toBe(200);
      expect(
        (
          await fastify.inject({
            method: "POST",
            url: "/api/users/session",
            payload: { name: "alice" },
          })
        ).statusCode,
      ).toBe(200);
    }

    await fastify.close();
  });
});
