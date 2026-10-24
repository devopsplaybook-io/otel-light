import { FastifyInstance } from "fastify";
import {
  AuthGetUserSession,
  AuthHasScope,
  AuthMustBeAdmin,
} from "@devopsplaybook.io/common-utils";
import { OTelLogger } from "../OTelContext";
import {
  LongestTracesReportGetCached,
  LongestTracesReportGenerate,
} from "./LongestTracesReport";
import {
  MostCalledTracesReportGetCached,
  MostCalledTracesReportGenerate,
} from "./MostCalledTracesReport";

const logger = OTelLogger().createModuleLogger("ReportsRoutes");

// Reports are derived from traces: the `traces` scope grants access.
export class ReportsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/reports/longest-traces", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      try {
        await AuthHasScope(req, res, "traces");
      } catch {
        return;
      }
      const cached = await LongestTracesReportGetCached();
      if (!cached) {
        return res.status(200).send({
          generatedAt: null,
          periodDays: null,
          topN: null,
          bucketNs: null,
          series: [],
        });
      }
      return res.status(200).send(cached);
    });

    fastify.post("/reports/longest-traces/regenerate", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      // Generation can take longer than the proxy/browser timeout on a large
      // database: accept the request and generate in the background.
      void LongestTracesReportGenerate().catch((err) =>
        logger.error(`Failed to regenerate longest traces report: ${err.message}`),
      );
      return res.status(202).send({ started: true });
    });

    fastify.get("/reports/most-called-traces", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      try {
        await AuthHasScope(req, res, "traces");
      } catch {
        return;
      }
      const cached = await MostCalledTracesReportGetCached();
      if (!cached) {
        return res.status(200).send({
          generatedAt: null,
          periodDays: null,
          topN: null,
          bucketNs: null,
          series: [],
        });
      }
      return res.status(200).send(cached);
    });

    fastify.post("/reports/most-called-traces/regenerate", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      void MostCalledTracesReportGenerate().catch((err) =>
        logger.error(
          `Failed to regenerate most called traces report: ${err.message}`,
        ),
      );
      return res.status(202).send({ started: true });
    });
  }
}
