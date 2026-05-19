import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { RecommendationGetCached, RecommendationGenerate } from "./Recommendation";

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

    fastify.post("/generate", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      // Trigger a manual generation (fire-and-forget, return immediately)
      RecommendationGenerate().catch((err) => {
        req.log.error(`Manual recommendation generation failed: ${err.message}`);
      });
      return res.status(202).send({ message: "Recommendation generation triggered" });
    });
  }
}
