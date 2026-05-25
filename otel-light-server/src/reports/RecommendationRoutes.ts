import { FastifyInstance } from "fastify";
import { AuthGetUserSession, AuthMustBeAdmin } from "../users/Auth";
import {
  RecommendationGenerate,
  RecommendationGetCached,
} from "./Recommendation";

export class RecommendationRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const cached = await RecommendationGetCached();
      if (!cached) {
        return res.status(200).send({
          generatedAt: null,
          periodHours: null,
          stats: null,
          analysis: null,
          recommendations: null,
        });
      }
      return res.status(200).send(cached);
    });

    fastify.post("/regenerate", async (req, res) => {
      await AuthMustBeAdmin(req, res);
      await RecommendationGenerate();
      const cached = await RecommendationGetCached();
      return res.status(200).send(cached);
    });
  }
}
