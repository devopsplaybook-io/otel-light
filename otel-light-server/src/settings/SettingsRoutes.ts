import { FastifyInstance } from "fastify";
import { AuthGetUserSession } from "../users/Auth";
import {
  SqlDbUtilsExecSQL,
  SqlDbUtilsQuerySQL,
} from "../utils-std-ts/SqlDbUtils";
import { Settings } from "../model/Settings";
import { StandardTracerGetSpanFromRequest } from "../utils-std-ts/StandardTracer";

export class SettingsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{ Params: { category: string } }>(
      "/:category",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(403).send({ error: "Access Denied" });
        }
        const rawSettings = await SqlDbUtilsQuerySQL(
          StandardTracerGetSpanFromRequest(req),
          "SELECT * FROM settings WHERE category = ?",
          [req.params.category]
        );
        if (!rawSettings || rawSettings.length === 0) {
          return res.status(200).send({
            settings: new Settings({
              category: req.params.category,
              content: {},
            }),
          });
        }
        const settings = new Settings(rawSettings[0]);
        return res.status(200).send({ settings });
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fastify.put<{ Params: { category: string }; Body: { content: any } }>(
      "/:category",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(403).send({ error: "Access Denied" });
        }
        await SqlDbUtilsExecSQL(
          StandardTracerGetSpanFromRequest(req),
          "DELETE FROM settings WHERE category = ?",
          [req.params.category]
        );
        await SqlDbUtilsQuerySQL(
          StandardTracerGetSpanFromRequest(req),
          "INSERT INTO settings (category, content) VALUES (?, ?)",
          [req.params.category, JSON.stringify(req.body.content)]
        );
        return res.status(201).send({});
      }
    );
  }
}
