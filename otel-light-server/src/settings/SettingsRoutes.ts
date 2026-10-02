import { FastifyInstance } from "fastify";
import { Settings } from "../model/Settings";
import { OTelRequestSpan } from "../OTelContext";
import { AuthGetUserSession, AuthMustBeAdmin } from "@devopsplaybook.io/common-utils";
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
      {
        schema: {
          body: {
            type: "object",
            required: ["content"],
            properties: { content: { type: "object" } },
          },
        },
      },
      async (req, res) => {
        try {
          await AuthMustBeAdmin(req, res);
        } catch {
          return;
        }
        // Single-statement upsert: a failed write leaves the previous
        // category content intact (no delete+insert window).
        await DbUtilsExecSQL(
          OTelRequestSpan(req),
          SQL_QUERIES.UPSERT_SETTINGS[DbUtilsGetType()],
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
  UPSERT_SETTINGS: {
    postgres:
      'INSERT INTO settings ("category", "content") VALUES ($1, $2)' +
      ' ON CONFLICT ("category") DO UPDATE SET "content" = EXCLUDED."content"',
    sqlite:
      "INSERT INTO settings (category, content) VALUES (?, ?)" +
      " ON CONFLICT(category) DO UPDATE SET content = excluded.content",
  },
};
