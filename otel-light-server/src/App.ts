import { StandardMeter, StandardTracer } from "@devopsplaybook.io/otel-utils";
import { StandardTracerFastifyRegisterHooks } from "@devopsplaybook.io/otel-utils-fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { watchFile } from "fs-extra";
import * as path from "path";
import { AnalyticsLogsRoutes } from "./analytics/AnalyticsLogsRoutes";
import { AnalyticsMetricsRoutes } from "./analytics/AnalyticsMetricsRoutes";
import { AnalyticsServicesRoutes } from "./analytics/AnalyticsServicesRoutes";
import { AnalyticsCacheInit } from "./analytics/AnalyticsCache";
import { AnalyticsStatsRoutes } from "./analytics/AnalyticsStatsRoutes";
import { AnalyticsTracesRoutes } from "./analytics/AnalyticsTracesRoutes";
import { SelfMetricsInit } from "./analytics/SelfMetrics";
import { Config } from "./Config";
import { MaintenanceInit } from "./Maintenance";
import { RecommendationInit } from "./reports/Recommendation";
import { RecommendationRoutes } from "./reports/RecommendationRoutes";
import { ReportsRoutes } from "./reports/ReportsRoutes";
import { LongestTracesReportInit } from "./reports/LongestTracesReport";
import { MostCalledTracesReportInit } from "./reports/MostCalledTracesReport";
import { NotificationInit } from "./NotificationService";
import {
  OTelLogger,
  OTelSetMeter,
  OTelSetTracer,
  OTelTracer,
} from "./OTelContext";
import { SettingsRoutes } from "./settings/SettingsRoutes";
import {
  AuthInit,
  AuthSetOTel,
  UsersDataSetOTel,
  UsersRoutes,
} from "@devopsplaybook.io/common-utils";
import { DbUtilsSetOTel, DbUtilsInit } from "./utils-std-ts/DbUtils";
import { DbUtilsNoTelemetrySetLogger } from "./utils-std-ts/DbUtilsNoTelemetry";
import { LogsRoutes } from "./v1/logs/LogsRoutes";
import { MetricsRoutes } from "./v1/metrics/MetricsRoutes";
import { SignalUtilsInit } from "./v1/SignalUtils";
import { TracesRoutes } from "./v1/traces/TracesRoutes";
import fastifyCompress from "@fastify/compress";

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

  DbUtilsSetOTel(OTelTracer(), OTelLogger());
  DbUtilsNoTelemetrySetLogger(OTelLogger());

  const span = OTelTracer().startSpan("init");

  await SignalUtilsInit(span, config);
  await DbUtilsInit(
    span,
    config,
    path.join(__dirname, `../sql/${config.DATABASE_TYPE}`),
  );
  AuthSetOTel(OTelTracer());
  UsersDataSetOTel(OTelTracer());
  await AuthInit(span, config, ["traces", "metrics", "logs"]);
  await MaintenanceInit(span, config);
  await SelfMetricsInit(span, config);
  await AnalyticsCacheInit(span, config);
  await RecommendationInit(span, config);
  NotificationInit(config);
  await LongestTracesReportInit(span, config);
  await MostCalledTracesReportInit(span, config);

  span.end();

  // APIs

  const fastify = Fastify({
    logger: {
      level: "error",
    },
  });

  await fastify.register(fastifyCompress, {
    global: true,
    threshold: 1024,
    encodings: ["gzip", "deflate"],
  });

  if (config.CORS_POLICY_ORIGIN) {
    fastify.register(fastifyCors, {
      origin: config.CORS_POLICY_ORIGIN,
      methods: "GET,PUT,POST,DELETE",
    });
  }

  StandardTracerFastifyRegisterHooks(fastify, OTelTracer(), OTelLogger(), {
    ignoreList: [
      "GET-/api/status",
      "POST-/v1/traces",
      "POST-/v1/metrics",
      "POST-/v1/logs",
    ],
  });

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
  fastify.register(new AnalyticsServicesRoutes().getRoutes, {
    prefix: "/api/analytics/services",
  });
  fastify.register(new AnalyticsStatsRoutes().getRoutes, {
    prefix: "/api/analytics",
  });
  fastify.register(new SettingsRoutes().getRoutes, {
    prefix: "/api/settings",
  });
  fastify.register(new RecommendationRoutes().getRoutes, {
    prefix: "/api/recommendation",
  });
  fastify.register(new ReportsRoutes().getRoutes, {
    prefix: "/api",
  });

  fastify.get("/api/status", async () => {
    return { started: true };
  });

  fastify.register(fastifyStatic, {
    root: path.join(__dirname, "../web"),
    prefix: "/",
    maxAge: "1d",
    etag: true,
    lastModified: true,
    immutable: true,
    cacheControl: true,
  });

  fastify.setNotFoundHandler((request, reply) => {
    if (
      request.raw.url &&
      !request.raw.url.startsWith("/api/") &&
      !request.raw.url.startsWith("/v1/") &&
      !path.extname(request.raw.url)
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (reply as any).sendFile("index.html");
    }
    reply.status(404).send({ error: "Not Found" });
  });

  fastify.listen({ port: config.API_PORT, host: "0.0.0.0" }, (err) => {
    if (err) {
      logger.error("Error starting API", err);
      process.exit(1);
    }
    logger.info("API Listening");
  });
});
