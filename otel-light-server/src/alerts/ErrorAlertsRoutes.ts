import { FastifyInstance } from "fastify";
import { AuthMustBeAdmin } from "@devopsplaybook.io/common-utils";
import { ErrorAlertsGetStatus } from "./ErrorAlerts";

export class ErrorAlertsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/status", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      const status = await ErrorAlertsGetStatus();
      return res.status(200).send(status);
    });
  }
}
