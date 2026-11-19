jest.mock("./OTelContext", () => {
  const moduleLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const logger = {
    createModuleLogger: () => moduleLogger,
    initOTel: jest.fn(),
  };
  return {
    OTelTracer: () => ({ startSpan: () => ({ end: jest.fn() }) }),
    OTelLogger: () => logger,
    OTelMeter: () => undefined,
    OTelSetTracer: jest.fn(),
    OTelSetMeter: jest.fn(),
    OTelRequestSpan: () => ({ end: jest.fn() }),
  };
});

jest.mock("@devopsplaybook.io/common-utils", () => ({
  ...jest.requireActual("@devopsplaybook.io/common-utils"),
  NotificationsClient: jest.fn(),
}));

import { NotificationsClient } from "@devopsplaybook.io/common-utils";
import {
  NotificationInit,
  NotificationIsEnabled,
  NotificationSendAlertGroup,
  NotificationSendRecoveryGroup,
  NotificationSendRecommendation,
  NotificationSendTest,
} from "./NotificationService";

describe("NotificationService", () => {
  let clientStub: {
    isEnabled: jest.Mock;
    info: jest.Mock;
    warning: jest.Mock;
    error: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    clientStub = {
      isEnabled: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
    };
    (NotificationsClient as jest.Mock).mockImplementation(() => clientStub);
    NotificationInit({} as Parameters<typeof NotificationInit>[0]);
  });

  describe("NotificationIsEnabled", () => {
    it("reflects the client state", () => {
      clientStub.isEnabled.mockReturnValue(true);
      expect(NotificationIsEnabled()).toBe(true);
      clientStub.isEnabled.mockReturnValue(false);
      expect(NotificationIsEnabled()).toBe(false);
    });
  });

  describe("NotificationSendAlertGroup", () => {
    it("sends a warning notification and lists the breached rules", async () => {
      clientStub.isEnabled.mockReturnValue(true);
      clientStub.warning.mockResolvedValue({ id: "n1" });

      const result = await NotificationSendAlertGroup("svc-a", [
        { message: "Error logs above threshold", severity: "warning" },
        { message: "Latency above threshold", severity: "info" },
      ]);

      expect(result).toEqual({ sent: true });
      expect(clientStub.warning).toHaveBeenCalledTimes(1);
      const [title, body, source] = clientStub.warning.mock.calls[0];
      expect(title).toBe("Alert: svc-a");
      expect(body).toBe(
        "- Error logs above threshold\n- Latency above threshold",
      );
      expect(source).toBe("otel-light");
    });

    it("routes a critical group through the error channel", async () => {
      clientStub.isEnabled.mockReturnValue(true);
      clientStub.error.mockResolvedValue({ id: "n1" });

      await NotificationSendAlertGroup("svc-a", [
        { message: "info rule", severity: "info" },
        { message: "critical rule", severity: "critical" },
      ]);

      expect(clientStub.error).toHaveBeenCalledTimes(1);
      expect(clientStub.warning).not.toHaveBeenCalled();
      expect(clientStub.info).not.toHaveBeenCalled();
    });

    it("routes an info-only group through the info channel", async () => {
      clientStub.isEnabled.mockReturnValue(true);
      clientStub.info.mockResolvedValue({ id: "n1" });

      await NotificationSendAlertGroup("All services", [
        { message: "heartbeat lost", severity: "info" },
      ]);

      expect(clientStub.info).toHaveBeenCalledTimes(1);
      expect(clientStub.warning).not.toHaveBeenCalled();
      expect(clientStub.error).not.toHaveBeenCalled();
    });

    it("reports a disabled integration", async () => {
      clientStub.isEnabled.mockReturnValue(false);

      const result = await NotificationSendAlertGroup("svc-a", [
        { message: "rule", severity: "warning" },
      ]);

      expect(result).toEqual({ sent: false, error: "notifications disabled" });
      expect(clientStub.warning).not.toHaveBeenCalled();
    });

    it("reports a failed send", async () => {
      clientStub.isEnabled.mockReturnValue(true);
      clientStub.warning.mockResolvedValue(null);

      const result = await NotificationSendAlertGroup("svc-a", [
        { message: "rule", severity: "warning" },
      ]);

      expect(result).toEqual({ sent: false, error: "notification send failed" });
    });
  });

  describe("NotificationSendRecoveryGroup", () => {
    it("sends a recovery notification with the recovered items", async () => {
      clientStub.isEnabled.mockReturnValue(true);
      clientStub.info.mockResolvedValue({ id: "n1" });

      const result = await NotificationSendRecoveryGroup("svc-a", [
        { message: "Recovered: rule r1", severity: "info" },
      ]);

      expect(result).toEqual({ sent: true });
      const [title, body] = clientStub.info.mock.calls[0];
      expect(title).toBe("Alert recovered: svc-a");
      expect(body).toBe("- Recovered: rule r1");
    });
  });

  describe("NotificationSendTest", () => {
    it("maps the requested severity to the notification channel", async () => {
      clientStub.isEnabled.mockReturnValue(true);
      clientStub.info.mockResolvedValue({ id: "n1" });
      clientStub.warning.mockResolvedValue({ id: "n2" });
      clientStub.error.mockResolvedValue({ id: "n3" });

      await NotificationSendTest("info");
      await NotificationSendTest("warning");
      await NotificationSendTest("critical");

      expect(clientStub.info).toHaveBeenCalledTimes(1);
      expect(clientStub.warning).toHaveBeenCalledTimes(1);
      expect(clientStub.error).toHaveBeenCalledTimes(1);
      const [title, body] = clientStub.warning.mock.calls[0];
      expect(title).toContain("Test notification");
      expect(body).toContain("warning test notification");
    });

    it("reports a disabled integration instead of throwing", async () => {
      clientStub.isEnabled.mockReturnValue(false);

      const result = await NotificationSendTest("info");

      expect(result).toEqual({ sent: false, error: "notifications disabled" });
    });
  });

  describe("NotificationSendRecommendation", () => {
    it("sends the analysis and recommendations", async () => {
      clientStub.isEnabled.mockReturnValue(true);
      clientStub.info.mockResolvedValue({ id: "n1" });

      await NotificationSendRecommendation(24, "analysis text", "do this");

      expect(clientStub.info).toHaveBeenCalledTimes(1);
      const [title, body] = clientStub.info.mock.calls[0];
      expect(title).toContain("24h");
      expect(body).toContain("## Analysis\nanalysis text");
      expect(body).toContain("## Recommendations\ndo this");
    });

    it("appends the per-service error digest when provided", async () => {
      clientStub.isEnabled.mockReturnValue(true);
      clientStub.info.mockResolvedValue({ id: "n1" });

      await NotificationSendRecommendation(24, "a", "r", [
        { serviceName: "svc-a", total: 120, errors: 3 },
        { serviceName: "svc-b", total: 45, errors: 0 },
      ]);

      const body = clientStub.info.mock.calls[0][1];
      expect(body).toContain("## Daily error digest");
      expect(body).toContain("- svc-a: 120 logs, 3 errors");
      expect(body).toContain("- svc-b: 45 logs, 0 errors");
      // The digest comes after the recommendations section.
      expect(body.indexOf("## Daily error digest")).toBeGreaterThan(
        body.indexOf("## Recommendations"),
      );
    });

    it("sends no digest section without per-service stats", async () => {
      clientStub.isEnabled.mockReturnValue(true);
      clientStub.info.mockResolvedValue({ id: "n1" });

      await NotificationSendRecommendation(24, "a", "r");

      expect(clientStub.info.mock.calls[0][1]).not.toContain("Daily error digest");
    });

    it("sends nothing when the integration is disabled", async () => {
      clientStub.isEnabled.mockReturnValue(false);

      await NotificationSendRecommendation(24, "a", "r");

      expect(clientStub.info).not.toHaveBeenCalled();
    });
  });
});
