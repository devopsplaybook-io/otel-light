import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "@devopsplaybook.io/common-utils";
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
      // Service list is derived from traces, metrics and logs: any signal
      // scope grants access (admins always allowed).
      if (userSession.role !== "admin") {
        const scopes = userSession.scopes || [];
        const hasSignalScope = ["traces", "metrics", "logs"].some((scope) =>
          scopes.includes(scope),
        );
        if (!hasSignalScope) {
          return res.status(403).send({ error: "Access Denied" });
        }
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
