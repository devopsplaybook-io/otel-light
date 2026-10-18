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
        if (req.params.category === "signal-cleanup-rules") {
          const issues = validateSignalCleanupRules(req.body.content);
          if (issues.length > 0) {
            return res.status(400).send({ error: issues.join("; ") });
          }
        }
        if (req.params.category === "error-alert-rules") {
          const issues = validateErrorAlertRules(req.body.content);
          if (issues.length > 0) {
            return res.status(400).send({ error: issues.join("; ") });
          }
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

// Rules the maintenance engine would silently skip must be rejected here so
// users learn at save time that a rule will never run. Mirrors the skip
// conditions in Maintenance.ts ApplyCleanupRule.
function validateSignalCleanupRules(content: unknown): string[] {
  const issues: string[] = [];
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return ["deleteRules must be an array of cleanup rules"];
  }
  const deleteRules = (content as { deleteRules?: unknown }).deleteRules;
  if (!Array.isArray(deleteRules)) {
    return ["deleteRules must be an array of cleanup rules"];
  }
  const signalTypes = ["traces", "metrics", "logs"];
  deleteRules.forEach((rule, idx) => {
    const n = idx + 1;
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      issues.push(`Rule ${n}: rule must be an object`);
      return;
    }
    const r = rule as { signalType?: unknown; periodHours?: unknown; pattern?: unknown; serviceName?: unknown };
    if (!signalTypes.includes(r.signalType as string)) {
      issues.push(`Rule ${n}: signalType must be one of: ${signalTypes.join(", ")}`);
    }
    const periodHours = Number(r.periodHours);
    if (!Number.isFinite(periodHours) || periodHours <= 0) {
      issues.push(`Rule ${n}: periodHours must be a positive number`);
    }
    if (typeof r.pattern !== "string" || !r.pattern.trim()) {
      issues.push(`Rule ${n}: pattern must be a non-empty string`);
    }
    if (r.serviceName !== undefined && (typeof r.serviceName !== "string" || !r.serviceName.trim())) {
      issues.push(`Rule ${n}: serviceName must be a non-empty string`);
    }
  });
  return issues;
}

// Rules the error alerts engine would not be able to run must be rejected
// here so users learn at save time. Mirrors the engine's checks in
// ErrorAlerts.ts (the id is also used as the maintenance_state key prefix,
// hence the length cap).
function validateErrorAlertRules(content: unknown): string[] {
  const issues: string[] = [];
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return ["alertRules must be an array of alert rules"];
  }
  const alertRules = (content as { alertRules?: unknown }).alertRules;
  if (!Array.isArray(alertRules)) {
    return ["alertRules must be an array of alert rules"];
  }
  if (alertRules.length > 100) {
    return ["alertRules must contain at most 100 rules"];
  }
  alertRules.forEach((rule, idx) => {
    const n = idx + 1;
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      issues.push(`Rule ${n}: rule must be an object`);
      return;
    }
    const r = rule as {
      id?: unknown;
      serviceName?: unknown;
      threshold?: unknown;
      periodHours?: unknown;
      enabled?: unknown;
    };
    if (typeof r.id !== "string" || !r.id.trim()) {
      issues.push(`Rule ${n}: id must be a non-empty string`);
    } else if (r.id.length > 80) {
      issues.push(`Rule ${n}: id must be at most 80 characters`);
    }
    if (r.serviceName !== undefined && typeof r.serviceName !== "string") {
      issues.push(`Rule ${n}: serviceName must be a string (empty = all services)`);
    }
    // An empty string must not be silently coerced to 0 ("any error").
    const threshold = Number(r.threshold);
    if (
      r.threshold === "" ||
      r.threshold === null ||
      r.threshold === undefined ||
      !Number.isFinite(threshold) ||
      threshold < 0
    ) {
      issues.push(`Rule ${n}: threshold must be a number >= 0`);
    }
    const periodHours = Number(r.periodHours);
    if (!Number.isFinite(periodHours) || periodHours <= 0) {
      issues.push(`Rule ${n}: periodHours must be a positive number`);
    }
    if (typeof r.enabled !== "boolean") {
      issues.push(`Rule ${n}: enabled must be a boolean`);
    }
  });
  return issues;
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
