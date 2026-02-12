import { FastifyInstance } from "fastify";
import { Settings } from "../model/Settings";
import { OTelRequestSpan } from "../OTelContext";
import { AuthGetUserSession } from "../users/Auth";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsGetType,
} from "../utils-std-ts/DbUtils";

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
        const rawSettings = await DbUtilsQuerySQL(
          OTelRequestSpan(req),
          SQL_QUERIES.GET_SETTINGS[DbUtilsGetType()],
          [req.params.category],
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
      },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fastify.put<{ Params: { category: string }; Body: { content: any } }>(
      "/:category",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(403).send({ error: "Access Denied" });
        }
        await DbUtilsExecSQL(
          OTelRequestSpan(req),
          SQL_QUERIES.DELETE_SETTINGS[DbUtilsGetType()],
          [req.params.category],
        );
        await DbUtilsQuerySQL(
          OTelRequestSpan(req),
          SQL_QUERIES.INSERT_SETTINGS[DbUtilsGetType()],
          [req.params.category, JSON.stringify(req.body.content)],
        );
        return res.status(201).send({});
      },
    );
  }
}

// SQL

const SQL_QUERIES = {
  GET_SETTINGS: {
    postgres: 'SELECT * FROM settings WHERE "category" = $1',
    sqlite: "SELECT * FROM settings WHERE category = ?",
  },
  DELETE_SETTINGS: {
    postgres: 'DELETE FROM settings WHERE "category" = $1',
    sqlite: "DELETE FROM settings WHERE category = ?",
  },
  INSERT_SETTINGS: {
    postgres: 'INSERT INTO settings ("category", "content") VALUES ($1, $2)',
    sqlite: "INSERT INTO settings (category, content) VALUES (?, ?)",
  },
};
