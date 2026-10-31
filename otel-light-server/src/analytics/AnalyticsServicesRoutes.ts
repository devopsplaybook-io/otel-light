import { FastifyInstance } from "fastify";
import {
  AUTH_ERROR_CODE_FORBIDDEN,
  AuthGetLiveUser,
  AuthMustBeAuthenticated,
} from "@devopsplaybook.io/common-utils";
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
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      // Service list is derived from traces, metrics and logs: any signal
      // scope grants access (admins always allowed). The live user is
      // authoritative — the JWT role/scopes claims are not.
      const user = await AuthGetLiveUser(req);
      const scopes = user?.scopes || [];
      const hasSignalScope =
        user?.role === "admin" ||
        ["traces", "metrics", "logs"].some((scope) => scopes.includes(scope));
      if (!hasSignalScope) {
        return res
          .status(403)
          .send({ error: "Access Denied", code: AUTH_ERROR_CODE_FORBIDDEN });
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
