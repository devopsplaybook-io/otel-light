import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import { SqlDbUtilsQuerySQL } from "../utils-std-ts/SqlDbUtils";
import { StandardTracerGetSpanFromRequest } from "../utils-std-ts/StandardTracer";
import { Trace } from "../model/Trace";
import { Span } from "../model/Span";

export class AnalyticsTracesRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const rawTraces = await SqlDbUtilsQuerySQL(
        StandardTracerGetSpanFromRequest(req),
        "SELECT MIN(startTime) AS startTime, MAX(endTime) AS endTime, traceId, MIN(name) AS name, COUNT(*) as spanCount " +
          " FROM traces " +
          " GROUP BY traceId " +
          " ORDER BY startTime DESC "
      );
      const traces = [];
      rawTraces.forEach((rawTrace) => {
        traces.push(new Trace(rawTrace));
      });

      return res.status(200).send({ traces });
    });

    fastify.get<{
      Params: {
        traceId: string;
      };
    }>("/:traceId/spans", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }

      const rawSpans = await SqlDbUtilsQuerySQL(
        StandardTracerGetSpanFromRequest(req),
        "SELECT * " +
          " FROM traces " +
          " WHERE traceId = ? " +
          " ORDER BY startTime ",
        [req.params.traceId]
      );
      const spans = [];
      rawSpans.forEach((rawSpan) => {
        spans.push(new Span(rawSpan));
      });

      return res.status(200).send({ spans });
    });
  }
}
