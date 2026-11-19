import { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import {
  AUTH_ERROR_CODE_FORBIDDEN,
  AuthGetLiveUser,
  AuthMustBeAuthenticated,
} from "@devopsplaybook.io/common-utils";
import { OTelRequestSpan } from "../OTelContext";
import {
  DbUtilsExecSQL,
  DbUtilsGetType,
  DbUtilsQuerySQL,
} from "../utils-std-ts/DbUtils";
import { SavedView } from "../model/SavedView";

const SIGNAL_TYPES = ["logs", "traces"];
const NAME_MAX_LENGTH = 100;
const QUERY_MAX_LENGTH = 4_000;

interface SavedViewInput {
  name?: unknown;
  signalType?: unknown;
  query?: unknown;
  shared?: unknown;
}

function validateName(value: unknown): string | null {
  if (typeof value !== "string") {
    return "name must be a string";
  }
  const name = value.trim();
  if (!name || name.length > NAME_MAX_LENGTH) {
    return `name must be 1-${NAME_MAX_LENGTH} characters`;
  }
  return null;
}

function validateSignalType(value: unknown): string | null {
  if (typeof value !== "string" || !SIGNAL_TYPES.includes(value)) {
    return `signalType must be one of: ${SIGNAL_TYPES.join(", ")}`;
  }
  return null;
}

function validateQuery(value: unknown): string | null {
  if (typeof value !== "string" || value.length > QUERY_MAX_LENGTH) {
    return `query must be a string of at most ${QUERY_MAX_LENGTH} characters`;
  }
  return null;
}

function validateShared(value: unknown): string | null {
  if (typeof value !== "boolean") {
    return "shared must be a boolean";
  }
  return null;
}

// Returns the stored view only when the live user owns it; answers 404 for
// an unknown id and 403 for another user's view.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadOwnedView(req: any, res: any, userId: string) {
  const rows = await DbUtilsQuerySQL(
    OTelRequestSpan(req),
    SQL_QUERIES.GET_VIEW[DbUtilsGetType()],
    [req.params.id],
  );
  if (!rows || rows.length === 0) {
    res.status(404).send({ error: "Not Found" });
    return null;
  }
  const view = new SavedView(rows[0]);
  if (view.userId !== userId) {
    res
      .status(403)
      .send({ error: "Access Denied", code: AUTH_ERROR_CODE_FORBIDDEN });
    return null;
  }
  return view;
}

export class SavedViewsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{ Querystring: { signalType?: string } }>(
      "/",
      async (req, res) => {
        try {
          await AuthMustBeAuthenticated(req, res);
        } catch {
          return;
        }
        const user = await AuthGetLiveUser(req);
        if (!user) {
          return res
            .status(401)
            .send({ error: "Authentication Required", code: "UNAUTHENTICATED" });
        }
        const signalType = String(req.query.signalType ?? "").trim();
        if (signalType && validateSignalType(signalType)) {
          return res.status(400).send({ error: "Invalid signalType" });
        }
        const dbType = DbUtilsGetType();
        const q = (ident: string) =>
          dbType === "postgres" ? `"${ident}"` : ident;
        const params: unknown[] = [user.id];
        let sql =
          `SELECT * FROM saved_views WHERE (${q("userId")} = 1 OR ${q("shared")} = 1)`;
        if (signalType) {
          params.push(signalType);
          sql += ` AND ${q("signalType")} = ${dbType === "postgres" ? "$2" : "?"}`;
        }
        sql += ` ORDER BY ${q("name")} ASC, ${q("dateCreated")} ASC`;
        const rows = await DbUtilsQuerySQL(OTelRequestSpan(req), sql, params);
        return res.status(200).send({
          views: (rows || []).map((row) => new SavedView(row)),
        });
      },
    );

    fastify.post<{ Body: SavedViewInput }>(
      "/",
      {
        schema: {
          body: {
            type: "object",
            required: ["name", "signalType", "query"],
            properties: {
              name: { type: "string" },
              signalType: { type: "string" },
              query: { type: "string" },
              shared: { type: "boolean" },
            },
          },
        },
      },
      async (req, res) => {
        try {
          await AuthMustBeAuthenticated(req, res);
        } catch {
          return;
        }
        const user = await AuthGetLiveUser(req);
        if (!user) {
          return res
            .status(401)
            .send({ error: "Authentication Required", code: "UNAUTHENTICATED" });
        }
        const body = req.body || {};
        const issues = [
          validateName(body.name),
          validateSignalType(body.signalType),
          validateQuery(body.query),
          body.shared === undefined ? null : validateShared(body.shared),
        ].filter((issue): issue is string => issue !== null);
        if (issues.length > 0) {
          return res.status(400).send({ error: issues.join("; ") });
        }
        const now = new Date().toISOString();
        const view = new SavedView({
          id: randomUUID(),
          userId: user.id,
          name: String(body.name).trim(),
          signalType: String(body.signalType),
          query: String(body.query),
          shared: body.shared === true,
          dateCreated: now,
          dateUpdated: now,
        });
        await DbUtilsExecSQL(
          OTelRequestSpan(req),
          SQL_QUERIES.INSERT_VIEW[DbUtilsGetType()],
          [
            view.id,
            view.userId,
            view.name,
            view.signalType,
            view.query,
            view.shared ? 1 : 0,
            view.dateCreated,
            view.dateUpdated,
          ],
        );
        return res.status(201).send({ view });
      },
    );

    fastify.patch<{ Params: { id: string }; Body: SavedViewInput }>(
      "/:id",
      {
        schema: {
          body: {
            type: "object",
            properties: {
              name: { type: "string" },
              shared: { type: "boolean" },
            },
          },
        },
      },
      async (req, res) => {
        try {
          await AuthMustBeAuthenticated(req, res);
        } catch {
          return;
        }
        const user = await AuthGetLiveUser(req);
        if (!user) {
          return res
            .status(401)
            .send({ error: "Authentication Required", code: "UNAUTHENTICATED" });
        }
        const existing = await loadOwnedView(req, res, user.id);
        if (!existing) {
          return;
        }
        const body = req.body || {};
        const issues = [
          body.name === undefined ? null : validateName(body.name),
          body.shared === undefined ? null : validateShared(body.shared),
        ].filter((issue): issue is string => issue !== null);
        if (issues.length > 0) {
          return res.status(400).send({ error: issues.join("; ") });
        }
        const updated = new SavedView({
          ...existing,
          name:
            body.name === undefined ? existing.name : String(body.name).trim(),
          shared:
            body.shared === undefined ? existing.shared : body.shared === true,
          dateUpdated: new Date().toISOString(),
        });
        await DbUtilsExecSQL(
          OTelRequestSpan(req),
          SQL_QUERIES.UPDATE_VIEW[DbUtilsGetType()],
          [updated.name, updated.shared ? 1 : 0, updated.dateUpdated, updated.id],
        );
        return res.status(200).send({ view: updated });
      },
    );

    fastify.delete<{ Params: { id: string } }>("/:id", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      const user = await AuthGetLiveUser(req);
      if (!user) {
        return res
          .status(401)
          .send({ error: "Authentication Required", code: "UNAUTHENTICATED" });
      }
      const existing = await loadOwnedView(req, res, user.id);
      if (!existing) {
        return;
      }
      await DbUtilsExecSQL(
        OTelRequestSpan(req),
        SQL_QUERIES.DELETE_VIEW[DbUtilsGetType()],
        [existing.id],
      );
      return res.status(200).send({ deleted: true });
    });
  }
}

// SQL

const SQL_QUERIES = {
  GET_VIEW: {
    postgres: 'SELECT * FROM saved_views WHERE "id" = $1',
    sqlite: "SELECT * FROM saved_views WHERE id = ?",
  },
  INSERT_VIEW: {
    postgres:
      'INSERT INTO saved_views ("id", "userId", "name", "signalType", "query", "shared", "dateCreated", "dateUpdated") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    sqlite:
      "INSERT INTO saved_views (id, userId, name, signalType, query, shared, dateCreated, dateUpdated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  },
  UPDATE_VIEW: {
    postgres:
      'UPDATE saved_views SET "name" = $1, "shared" = $2, "dateUpdated" = $3 WHERE "id" = $4',
    sqlite:
      "UPDATE saved_views SET name = ?, shared = ?, dateUpdated = ? WHERE id = ?",
  },
  DELETE_VIEW: {
    postgres: 'DELETE FROM saved_views WHERE "id" = $1',
    sqlite: "DELETE FROM saved_views WHERE id = ?",
  },
};
