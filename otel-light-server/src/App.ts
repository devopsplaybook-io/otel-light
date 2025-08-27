import { StandardMeter, StandardTracer } from "@devopsplaybook.io/otel-utils";
import { StandardTracerFastifyRegisterHooks } from "@devopsplaybook.io/otel-utils-fastify";
import Fastify from "fastify";
import { watchFile } from "fs-extra";
import * as path from "path";
import { AnalyticsLogsRoutes } from "./analytics/AnalyticsLogsRoutes";
import { AnalyticsMetricsRoutes } from "./analytics/AnalyticsMetricsRoutes";
import { AnalyticsTracesRoutes } from "./analytics/AnalyticsTracesRoutes";
import { SelfMetricsInit } from "./analytics/SelfMetrics";
import { Config } from "./Config";
import { MaintenanceInit } from "./Maintenance";
import {
  OTelLogger,
  OTelSetMeter,
  OTelSetTracer,
  OTelTracer,
} from "./OTelContext";
import { SettingsRoutes } from "./settings/SettingsRoutes";
import { AuthInit } from "./users/Auth";
import { UsersRoutes } from "./users/UsersRoutes";
import { SqlDbUtilsInit } from "./utils-std-ts/SqlDbUtils";
import { LogsRoutes } from "./v1/logs/LogsRoutes";
import { MetricsRoutes } from "./v1/metrics/MetricsRoutes";
import { SignalUtilsInit } from "./v1/SignalUtils";
import { TracesRoutes } from "./v1/traces/TracesRoutes";

const logger = OTelLogger().createModuleLogger("app");

logger.info("====== Starting otel-light Server ======");

Promise.resolve().then(async () => {
  //
  const config = new Config();
  await config.reload();
  watchFile(config.CONFIG_FILE, () => {
    logger.info(`Config updated: ${config.CONFIG_FILE}`);
    config.reload();
  });

  OTelSetTracer(new StandardTracer(config));
  OTelSetMeter(new StandardMeter(config));
  OTelLogger().initOTel(config);

  const span = OTelTracer().startSpan("init");

  await SignalUtilsInit(span, config);
  await SqlDbUtilsInit(span, config);
  await AuthInit(span, config);
  await MaintenanceInit(span, config);
  await SelfMetricsInit(span, config);

  span.end();

  // APIs

  const fastify = Fastify({
    logger: config.LOG_LEVEL === process.env.FASTIFY_LOG_LEVEL,
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

  StandardTracerFastifyRegisterHooks(fastify, OTelTracer(), OTelLogger());

  fastify.register(new UsersRoutes().getRoutes, {
    prefix: "/api/users",
  });

  fastify.register(new TracesRoutes().getRoutes, {
    prefix: "/v1/traces",
  });
  fastify.register(new MetricsRoutes().getRoutes, {
    prefix: "/v1/metrics",
  });
  fastify.register(new LogsRoutes().getRoutes, {
    prefix: "/v1/logs",
  });

  fastify.register(new AnalyticsTracesRoutes().getRoutes, {
    prefix: "/api/analytics/traces",
  });
  fastify.register(new AnalyticsMetricsRoutes().getRoutes, {
    prefix: "/api/analytics/metrics",
  });
  fastify.register(new AnalyticsLogsRoutes().getRoutes, {
    prefix: "/api/analytics/logs",
  });
  fastify.register(new SettingsRoutes().getRoutes, {
    prefix: "/api/settings",
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
      process.exit(1);
    }
    logger.info("API Listening");
  });
});
