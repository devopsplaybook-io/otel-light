import { FastifyInstance } from "fastify";
import { AuthMustBeAdmin } from "@devopsplaybook.io/common-utils";
import { ErrorAlertsGetStatus } from "./ErrorAlerts";
import {
  ALERT_HISTORY_DEFAULT_LIMIT,
  ALERT_HISTORY_MAX_LIMIT,
  AlertHistoryList,
} from "./AlertHistory";
import { NotificationSendTest } from "../NotificationService";
import { ALERT_SEVERITIES, AlertSeverity } from "./AlertRules";

const HISTORY_STATUSES = [
  "fired",
  "notified",
  "resolved",
  "suppressed",
  "error",
];

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

    fastify.get<{
      Querystring: {
        ruleId?: string;
        serviceName?: string;
        status?: string;
        from?: string;
        to?: string;
        limit?: string;
        offset?: string;
      };
    }>("/history", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      const query = req.query || {};
      if (query.status && !HISTORY_STATUSES.includes(query.status)) {
        return res
          .status(400)
          .send({ error: `status must be one of: ${HISTORY_STATUSES.join(", ")}` });
      }
      if (query.from && !Number.isFinite(Date.parse(query.from))) {
        return res.status(400).send({ error: "from must be a valid ISO date" });
      }
      if (query.to && !Number.isFinite(Date.parse(query.to))) {
        return res.status(400).send({ error: "to must be a valid ISO date" });
      }
      const limit = ErrorAlertsParseInteger(query.limit, ALERT_HISTORY_DEFAULT_LIMIT);
      if (limit === null || limit < 1 || limit > ALERT_HISTORY_MAX_LIMIT) {
        return res
          .status(400)
          .send({ error: `limit must be an integer between 1 and ${ALERT_HISTORY_MAX_LIMIT}` });
      }
      const offset = ErrorAlertsParseInteger(query.offset, 0);
      if (offset === null || offset < 0) {
        return res
          .status(400)
          .send({ error: "offset must be an integer >= 0" });
      }
      const page = await AlertHistoryList({
        ruleId: query.ruleId,
        serviceName: query.serviceName,
        status: query.status,
        from: query.from,
        to: query.to,
        limit,
        offset,
      });
      return res.status(200).send(page);
    });

    fastify.post<{ Body: { severity?: string } }>(
      "/test",
      {
        schema: {
          body: {
            type: "object",
            additionalProperties: true,
            properties: { severity: { type: "string" } },
          },
        },
      },
      async (req, res) => {
        try {
          await AuthMustBeAdmin(req, res);
        } catch {
          return;
        }
        const severity = (req.body?.severity || "info") as AlertSeverity;
        if (!ALERT_SEVERITIES.includes(severity)) {
          return res
            .status(400)
            .send({ error: `severity must be one of: ${ALERT_SEVERITIES.join(", ")}` });
        }
        const outcome = await NotificationSendTest(severity);
        return res.status(200).send({
          sent: outcome.sent,
          severity,
          ...(outcome.error ? { error: outcome.error } : {}),
        });
      },
    );
  }
}

function ErrorAlertsParseInteger(
  value: string | undefined,
  fallback: number,
): number | null {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (!/^\d+$/.test(String(value))) {
    return null;
  }
  return Number(value);
}
