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
  NotificationSendErrorAlert,
  NotificationSendRecommendation,
} from "./NotificationService";

describe("NotificationService", () => {
  let clientStub: { isEnabled: jest.Mock; info: jest.Mock; warning: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    clientStub = {
      isEnabled: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
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

  describe("NotificationSendErrorAlert", () => {
    it("sends a warning notification and reports success", async () => {
      clientStub.isEnabled.mockReturnValue(true);
      clientStub.warning.mockResolvedValue({ id: "n1" });

      const sent = await NotificationSendErrorAlert("svc-a", 12, 10, 4);

      expect(sent).toBe(true);
      expect(clientStub.warning).toHaveBeenCalledTimes(1);
      const [title, body, source] = clientStub.warning.mock.calls[0];
      expect(title).toContain("svc-a");
      expect(body).toContain("12 error logs in the last 4h");
      expect(body).toContain("threshold of 10");
      expect(source).toBe("otel-light");
    });

    it("returns false and sends nothing when the integration is disabled", async () => {
      clientStub.isEnabled.mockReturnValue(false);

      const sent = await NotificationSendErrorAlert("svc-a", 12, 10, 4);

      expect(sent).toBe(false);
      expect(clientStub.warning).not.toHaveBeenCalled();
    });

    it("returns false when the send fails", async () => {
      clientStub.isEnabled.mockReturnValue(true);
      clientStub.warning.mockResolvedValue(null);

      const sent = await NotificationSendErrorAlert("svc-a", 12, 10, 4);

      expect(sent).toBe(false);
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
