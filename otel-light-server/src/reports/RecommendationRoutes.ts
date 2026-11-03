import { FastifyInstance } from "fastify";
import {
  AuthHasScope,
  AuthMustBeAdmin,
} from "@devopsplaybook.io/common-utils";
import {
  RecommendationGenerate,
  RecommendationGetCached,
} from "./Recommendation";

// The cached payload and the LLM text include log totals, per-severity
// counts and top error messages: both the `traces` and `logs` scopes are
// required (the logs endpoints grant the same data only with `logs`).
export class RecommendationRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/", async (req, res) => {
      try {
        await AuthHasScope(req, res, "traces");
        await AuthHasScope(req, res, "logs");
      } catch {
        return;
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
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      await RecommendationGenerate();
      const cached = await RecommendationGetCached();
      return res.status(200).send(cached);
    });
  }
}
