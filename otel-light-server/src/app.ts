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
import { StandardTracerApiRegisterHooks } from "./StandardTracerApi";
import { AuthInit } from "./users/Auth";
import { KubeCtlCommandRoutes } from "./kubectl/KubeCtlCommandRoutes";
import { KubeCtlLogsRoutes } from "./kubectl/KubeCtlLogsRoutes";
import { StatsDataInit } from "./stats/StatsData";
import { StatsRoutes } from "./stats/StatsRoutes";

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
  await StatsDataInit(span, config);

  span.end();

  // API

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

  StandardTracerApiRegisterHooks(fastify, config);

  fastify.register(new UsersRoutes().getRoutes, {
    prefix: "/api/users",
  });
  fastify.register(new KubeCtlCommandRoutes().getRoutes, {
    prefix: "/api/kubectl/command",
  });
  fastify.register(new KubeCtlLogsRoutes().getRoutes, {
    prefix: "/api/kubectl/logs",
  });
  fastify.register(new StatsRoutes().getRoutes, {
    prefix: "/api/stats",
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
