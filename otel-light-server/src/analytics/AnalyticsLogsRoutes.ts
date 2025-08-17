import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { Log } from "../model/Log";
import { SqlDbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/SqlDbUtilsNoTelemetry";
import { AnalyticsUtilsGetDefaultFromTime } from "./AnalyticsUtils";

export class AnalyticsLogsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{
      Querystring: {
        from?: number;
        to?: number;
        keywords?: string;
      };
    }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const sqlParams = [];
      const fromTime = req.query.from || AnalyticsUtilsGetDefaultFromTime();
      let sqlWhere = " WHERE time >= ? ";
      sqlParams.push(fromTime);

      if (req.query.to) {
        sqlWhere += " AND time <= ? ";
        sqlParams.push(req.query.to);
      }
      if (req.query.keywords?.trim()) {
        sqlWhere += " AND keywords LIKE ? ";
        sqlParams.push(`%${req.query.keywords.trim()}%`);
      }

      const rawLogs = await SqlDbUtilsNoTelemetryQuerySQL(
        "SELECT * FROM logs " + sqlWhere,
        sqlParams
      );
      const logs = [];
      rawLogs.forEach((rawLog) => {
        logs.push(new Log(rawLog));
      });

      return res.status(200).send({ logs });
    });
  }
}
