import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "@devopsplaybook.io/common-utils";
import { ErrorAlertsGetStatus } from "./ErrorAlerts";

export class ErrorAlertsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/status", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const status = await ErrorAlertsGetStatus();
      return res.status(200).send(status);
    });
  }
}
