import { FastifyInstance, FastifyRequest } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";

export interface RateLimitsSettings {
  INGESTION_RATE_LIMIT_MAX: number;
  INGESTION_RATE_LIMIT_WINDOW_SECONDS: number;
  LOGIN_RATE_LIMIT_MAX: number;
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: number;
}

export interface RateLimitRouteConfigValue {
  max: number;
  timeWindow: number;
  keyGenerator: (req: FastifyRequest) => string;
}

const INGESTION_PATHS = new Set(["/v1/traces", "/v1/metrics", "/v1/logs"]);
const LOGIN_PATH = "/api/users/session";

function RateLimitsNormalizePath(url: string): string {
  const path = url.split("?")[0];
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function RateLimitsRouteConfig(
  method: string | string[] | undefined,
  url: string,
  settings: RateLimitsSettings,
): RateLimitRouteConfigValue | null {
  const methods = (Array.isArray(method) ? method : [method ?? ""]).map((m) =>
    String(m).toUpperCase(),
  );
  if (!methods.includes("POST")) {
    return null;
  }

  const path = RateLimitsNormalizePath(url);

  if (INGESTION_PATHS.has(path)) {
    if (settings.INGESTION_RATE_LIMIT_MAX <= 0) {
      return null;
    }
    return {
      max: settings.INGESTION_RATE_LIMIT_MAX,
      timeWindow: settings.INGESTION_RATE_LIMIT_WINDOW_SECONDS * 1000,
      keyGenerator: (req) => req.ip,
    };
  }

  if (path === LOGIN_PATH) {
    if (settings.LOGIN_RATE_LIMIT_MAX <= 0) {
      return null;
    }
    return {
      max: settings.LOGIN_RATE_LIMIT_MAX,
      timeWindow: settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS * 1000,
      // Per IP + username: a single account cannot be hammered from one
      // client, while users behind the same IP do not share a bucket.
      keyGenerator: (req) => {
        const body = req.body as { name?: unknown } | undefined;
        const userName = String(body?.name ?? "")
          .trim()
          .toLowerCase()
          .slice(0, 255);
        return `${req.ip}:${userName}`;
      },
    };
  }

  return null;
}

export async function RateLimitsInit(
  fastify: FastifyInstance,
  settings: RateLimitsSettings,
): Promise<void> {
  // The onRoute hook must be registered before the plugin so the plugin's own
  // onRoute hook sees the per-route configuration.
  fastify.addHook("onRoute", (routeOptions) => {
    const routeConfig = RateLimitsRouteConfig(
      routeOptions.method,
      routeOptions.url,
      settings,
    );
    if (routeConfig) {
      routeOptions.config = {
        ...routeOptions.config,
        rateLimit: routeConfig,
      };
    }
  });

  await fastify.register(fastifyRateLimit, {
    global: false,
    // preHandler (not onRequest) so req.body is available for the login key.
    hook: "preHandler",
    errorResponseBuilder: (_req, context) => {
      const error = new Error(
        `Rate limit exceeded, retry in ${context.after}`,
      ) as Error & { statusCode?: number; code?: string };
      error.statusCode = 429;
      error.code = "RATE_LIMITED";
      return error;
    },
  });
}
