import Fastify from "fastify";
import * as path from "path";
import { watchFile } from "fs-extra";
import { Config } from "./Config";
import { Logger } from "./utils-std-ts/Logger";
import { UsersRoutes } from "./users/UsersRoutes";
import {
  StandardTracerInitTelemetry,
  StandardTracerStartSpan,
} from "./utils-std-ts/StandardTracer";
import { SqlDbUtilsInit } from "./utils-std-ts/SqlDbUtils";
import { AuthInit } from "./users/Auth";
import { TracesRoutes } from "./v1/traces/TracesRoutes";
import { AnalyticsTracesRoutes } from "./analytics/AnalyticsTracesRoutes";
import { MaintenanceInit } from "./Maintenance";
import { MetricsRoutes } from "./v1/metrics/MetricsRoutes";
import { SelfMetricsInit } from "./analytics/SelfMetrics";
import { AnalyticsMetricsRoutes } from "./analytics/AnalyticsMetricsRoutes";

const logger = new Logger("app");

logger.info("====== Starting otel-light Server ======");

Promise.resolve().then(async () => {
  //
  const config = new Config();
  await config.reload();
  watchFile(config.CONFIG_FILE, () => {
    logger.info(`Config updated: ${config.CONFIG_FILE}`);
    config.reload();
  });

  StandardTracerInitTelemetry(config);

  const span = StandardTracerStartSpan("init");

  await SqlDbUtilsInit(span, config);
  await AuthInit(span, config);
  await MaintenanceInit(span, config);
  await SelfMetricsInit(span, config);

  span.end();

  // APIs

  const fastify = Fastify({
    logger: config.LOG_LEVEL === "debug_tmp",
    ignoreTrailingSlash: true,
  });

  if (config.CORS_POLICY_ORIGIN) {
    /* eslint-disable-next-line */
    fastify.register(require("@fastify/cors"), {
      origin: config.CORS_POLICY_ORIGIN,
      methods: "GET,PUT,POST,DELETE",
    });
  }
  /* eslint-disable-next-line */
  fastify.register(require("@fastify/multipart"));

  // fastify.addHook("onRequest", async (req) => {
  //   console.log(`${req.method}-${req.url}`);
  // });

  fastify.register(new UsersRoutes().getRoutes, {
    prefix: "/api/users",
  });

  fastify.register(new TracesRoutes().getRoutes, {
    prefix: "/api/v1/traces",
  });
  fastify.register(new MetricsRoutes().getRoutes, {
    prefix: "/api/v1/metrics",
  });

  fastify.register(new AnalyticsTracesRoutes().getRoutes, {
    prefix: "/api/analytics/traces",
  });
  fastify.register(new AnalyticsMetricsRoutes().getRoutes, {
    prefix: "/api/analytics/metrics",
  });

  fastify.get("/api/status", async () => {
    return { started: true };
  });

  /* eslint-disable-next-line */
  fastify.register(require("@fastify/static"), {
    root: path.join(__dirname, "../web"),
    prefix: "/",
  });

  fastify.listen({ port: config.API_PORT, host: "0.0.0.0" }, (err) => {
    if (err) {
      logger.error(err);
      fastify.log.error(err);
      process.exit(1);
    }
    logger.info("API Listerning");
  });
});
