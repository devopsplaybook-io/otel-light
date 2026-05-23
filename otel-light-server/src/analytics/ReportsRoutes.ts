import { FastifyInstance } from "fastify";
import { AuthGetUserSession, AuthMustBeAdmin } from "../users/Auth";
import {
  LongestTracesReportGetCached,
  LongestTracesReportGenerate,
} from "./LongestTracesReport";

export class ReportsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/reports/longest-traces", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const cached = await LongestTracesReportGetCached();
      if (!cached) {
        return res.status(200).send({
          generatedAt: null,
          periodDays: null,
          topN: null,
          fromTime: null,
          toTime: null,
          traces: [],
        });
      }
      return res.status(200).send(cached);
    });

    fastify.post("/reports/longest-traces/regenerate", async (req, res) => {
      await AuthMustBeAdmin(req, res);
      await LongestTracesReportGenerate();
      const cached = await LongestTracesReportGetCached();
      return res.status(200).send(cached);
    });
  }
}
