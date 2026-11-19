import Fastify from "fastify";

jest.mock("@devopsplaybook.io/common-utils", () => ({
  ...jest.requireActual("@devopsplaybook.io/common-utils"),
  AuthMustBeAdmin: jest.fn(),
}));

jest.mock("./ErrorAlerts", () => ({
  ErrorAlertsGetStatus: jest.fn(),
}));

jest.mock("./AlertHistory", () => ({
  ALERT_HISTORY_DEFAULT_LIMIT: 100,
  ALERT_HISTORY_MAX_LIMIT: 500,
  AlertHistoryList: jest.fn(),
}));

jest.mock("../NotificationService", () => ({
  NotificationSendTest: jest.fn(),
}));

import { AuthMustBeAdmin } from "@devopsplaybook.io/common-utils";
import { ErrorAlertsGetStatus } from "./ErrorAlerts";
import { AlertHistoryList } from "./AlertHistory";
import { NotificationSendTest } from "../NotificationService";
import { ErrorAlertsRoutes } from "./ErrorAlertsRoutes";

const deny = (
  mock: jest.Mock,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) =>
  mock.mockImplementation(async (_req: unknown, res: any) => {
    res.status(403).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  });

describe("ErrorAlertsRoutes", () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    fastify = Fastify();
    await fastify.register(new ErrorAlertsRoutes().getRoutes, {
      prefix: "/api/alerts",
    });
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthMustBeAdmin as jest.Mock).mockResolvedValue(undefined);
    (ErrorAlertsGetStatus as jest.Mock).mockResolvedValue({
      notificationsEnabled: true,
      evaluations: {},
    });
    (AlertHistoryList as jest.Mock).mockResolvedValue({ events: [], hasMore: false });
    (NotificationSendTest as jest.Mock).mockResolvedValue({ sent: true });
  });

  describe("GET /api/alerts/status", () => {
    it("returns 403 and skips the status lookup for non-admins", async () => {
      deny(AuthMustBeAdmin as jest.Mock);

      const res = await fastify.inject({
        method: "GET",
        url: "/api/alerts/status",
      });

      expect(res.statusCode).toBe(403);
      expect(ErrorAlertsGetStatus).not.toHaveBeenCalled();
    });

    it("returns the alert status for admins", async () => {
      const status = {
        notificationsEnabled: false,
        evaluations: { rule1: { at: "2026-10-24T00:00:00.000Z" } },
      };
      (ErrorAlertsGetStatus as jest.Mock).mockResolvedValue(status);

      const res = await fastify.inject({
        method: "GET",
        url: "/api/alerts/status",
      });

      expect(res.statusCode).toBe(200);
      expect(AuthMustBeAdmin).toHaveBeenCalled();
      expect(res.json()).toEqual(status);
    });
  });

  describe("GET /api/alerts/history", () => {
    it("forwards the filters and pagination to the history query", async () => {
      const page = {
        events: [{ id: "e1", status: "fired" }],
        hasMore: true,
      };
      (AlertHistoryList as jest.Mock).mockResolvedValue(page);

      const res = await fastify.inject({
        method: "GET",
        url:
          "/api/alerts/history?ruleId=r1&serviceName=svc-a&status=fired" +
          "&from=2026-11-01T00:00:00.000Z&to=2026-11-20T00:00:00.000Z&limit=10&offset=20",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(page);
      expect(AlertHistoryList).toHaveBeenCalledWith({
        ruleId: "r1",
        serviceName: "svc-a",
        status: "fired",
        from: "2026-11-01T00:00:00.000Z",
        to: "2026-11-20T00:00:00.000Z",
        limit: 10,
        offset: 20,
      });
    });

    it("uses the default limit and offset when none are provided", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/alerts/history",
      });

      expect(res.statusCode).toBe(200);
      expect(AlertHistoryList).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100, offset: 0 }),
      );
    });

    it("rejects an unknown status", async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/api/alerts/history?status=exploded",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("status must be one of");
      expect(AlertHistoryList).not.toHaveBeenCalled();
    });

    it("rejects invalid dates", async () => {
      const badFrom = await fastify.inject({
        method: "GET",
        url: "/api/alerts/history?from=not-a-date",
      });
      expect(badFrom.statusCode).toBe(400);
      expect(badFrom.json().error).toContain("from");

      const badTo = await fastify.inject({
        method: "GET",
        url: "/api/alerts/history?to=not-a-date",
      });
      expect(badTo.statusCode).toBe(400);
      expect(badTo.json().error).toContain("to");
    });

    it("rejects out of range limits and offsets", async () => {
      for (const limit of ["0", "501", "abc", "-1"]) {
        const res = await fastify.inject({
          method: "GET",
          url: `/api/alerts/history?limit=${limit}`,
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain("limit");
      }

      for (const offset of ["-1", "abc"]) {
        const res = await fastify.inject({
          method: "GET",
          url: `/api/alerts/history?offset=${offset}`,
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain("offset");
      }
      expect(AlertHistoryList).not.toHaveBeenCalled();
    });

    it("requires admin rights", async () => {
      deny(AuthMustBeAdmin as jest.Mock);

      const res = await fastify.inject({
        method: "GET",
        url: "/api/alerts/history",
      });

      expect(res.statusCode).toBe(403);
      expect(AlertHistoryList).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/alerts/test", () => {
    it("sends a test notification with the default severity", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/alerts/test",
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(NotificationSendTest).toHaveBeenCalledWith("info");
      expect(res.json()).toEqual({ sent: true, severity: "info" });
    });

    it("honours the requested severity and reports delivery errors", async () => {
      (NotificationSendTest as jest.Mock).mockResolvedValue({
        sent: false,
        error: "notifications disabled",
      });

      const res = await fastify.inject({
        method: "POST",
        url: "/api/alerts/test",
        payload: { severity: "critical" },
      });

      expect(res.statusCode).toBe(200);
      expect(NotificationSendTest).toHaveBeenCalledWith("critical");
      expect(res.json()).toEqual({
        sent: false,
        severity: "critical",
        error: "notifications disabled",
      });
    });

    it("rejects an unknown severity", async () => {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/alerts/test",
        payload: { severity: "panic" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("severity must be one of");
      expect(NotificationSendTest).not.toHaveBeenCalled();
    });

    it("requires admin rights", async () => {
      deny(AuthMustBeAdmin as jest.Mock);

      const res = await fastify.inject({
        method: "POST",
        url: "/api/alerts/test",
        payload: {},
      });

      expect(res.statusCode).toBe(403);
      expect(NotificationSendTest).not.toHaveBeenCalled();
    });
  });
});
