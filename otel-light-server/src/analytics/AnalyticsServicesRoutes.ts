import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { AnalyticsCacheGetServices } from "./AnalyticsCache";

export interface ServiceVersionEntry {
  serviceName: string;
  serviceVersion: string | null;
}

export class AnalyticsServicesRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const cached = AnalyticsCacheGetServices();
      if (!cached) {
        return res
          .status(503)
          .send({ error: "Services cache not yet ready, please retry" });
      }

      return res.status(200).send({
        services: cached.services,
        serviceVersions: cached.serviceVersions,
      });
    });
  }
}
