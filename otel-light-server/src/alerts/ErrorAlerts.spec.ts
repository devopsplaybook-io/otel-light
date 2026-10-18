jest.mock("../OTelContext", () => {
  const span = {
    end: jest.fn(),
    setStatus: jest.fn(),
    addEvent: jest.fn(),
    setAttribute: jest.fn(),
    setAttributes: jest.fn(),
  };
  const moduleLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const tracer = { startSpan: () => span };
  const logger = {
    createModuleLogger: () => moduleLogger,
    initOTel: jest.fn(),
  };
  return {
    OTelTracer: () => tracer,
    OTelLogger: () => logger,
    OTelMeter: () => undefined,
    OTelSetTracer: jest.fn(),
    OTelSetMeter: jest.fn(),
    OTelRequestSpan: () => span,
  };
});

jest.mock("../NotificationService", () => ({
  NotificationIsEnabled: jest.fn(),
  NotificationSendErrorAlert: jest.fn(),
  NotificationSendRecommendation: jest.fn(),
}));

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsQuerySQL: jest.fn(),
  DbUtilsExecSQL: jest.fn(),
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

import {
  NotificationIsEnabled,
  NotificationSendErrorAlert,
} from "../NotificationService";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
} from "../utils-std-ts/DbUtils";
import {
  ErrorAlertsEvaluate,
  ErrorAlertsGetStatus,
} from "./ErrorAlerts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

describe("ErrorAlerts", () => {
  const OUTCOME_KEY_PREFIX = "error-alert-outcome-";

  let rulesInSettings: Loose[];
  let errorCount: number;
  let previousOutcomes: Record<string, Loose>;
  let outcomeUpserts: Record<string, Loose>;

  const lastUpsertFor = (ruleId: string): Loose | undefined =>
    outcomeUpserts[OUTCOME_KEY_PREFIX + ruleId];

  const countQueryCalls = (): Loose[] =>
    (DbUtilsQuerySQL as jest.Mock).mock.calls.filter(
      (call: Loose[]) =>
        String(call[1]).includes("COUNT(*)") && String(call[1]).includes("FROM logs"),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    rulesInSettings = [];
    errorCount = 0;
    previousOutcomes = {};
    outcomeUpserts = {};

    (DbUtilsQuerySQL as jest.Mock).mockImplementation(
      async (_span: unknown, sql: string, params: Loose[]) => {
        if (String(sql).includes("FROM settings")) {
          return [
            {
              category: "error-alert-rules",
              content: JSON.stringify({ alertRules: rulesInSettings }),
            },
          ];
        }
        if (String(sql).includes("COUNT(*)") && String(sql).includes("FROM logs")) {
          return [{ count: errorCount }];
        }
        if (String(sql).includes("FROM maintenance_state WHERE stateKey = ?")) {
          // The upsert mock records into outcomeUpserts, so subsequent reads
          // see the outcomes written by earlier evaluations.
          const outcome = outcomeUpserts[params[0]] ?? previousOutcomes[params[0]];
          return outcome ? [{ stateValue: JSON.stringify(outcome) }] : [];
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    );
    (DbUtilsExecSQL as jest.Mock).mockImplementation(
      async (_span: unknown, _sql: string, params: Loose[]) => {
        outcomeUpserts[params[0]] = JSON.parse(params[1]);
        return 1;
      },
    );
    (NotificationIsEnabled as jest.Mock).mockReturnValue(true);
    (NotificationSendErrorAlert as jest.Mock).mockResolvedValue(true);
  });

  it("notifies and records a breached outcome when count > threshold", async () => {
    rulesInSettings = [
      { id: "r1", serviceName: "svc-a", threshold: 5, periodHours: 2, enabled: true },
    ];
    errorCount = 7;

    await ErrorAlertsEvaluate();

    expect(NotificationSendErrorAlert).toHaveBeenCalledTimes(1);
    expect(NotificationSendErrorAlert).toHaveBeenCalledWith("svc-a", 7, 5, 2);
    const outcome = lastUpsertFor("r1");
    expect(outcome).toMatchObject({
      count: 7,
      threshold: 5,
      breached: true,
      notified: true,
    });
    expect(outcome.at).toBeTruthy();
  });

  it("does not breach when count equals the threshold", async () => {
    rulesInSettings = [
      { id: "r1", serviceName: "", threshold: 5, periodHours: 2, enabled: true },
    ];
    errorCount = 5;

    await ErrorAlertsEvaluate();

    expect(NotificationSendErrorAlert).not.toHaveBeenCalled();
    expect(lastUpsertFor("r1")).toMatchObject({
      count: 5,
      threshold: 5,
      breached: false,
      notified: false,
    });
  });

  it("passes the serviceName filter to the count query and omits it for global rules", async () => {
    rulesInSettings = [
      { id: "r1", serviceName: "svc-a", threshold: 0, periodHours: 1, enabled: true },
      { id: "r2", threshold: 0, periodHours: 1, enabled: true },
    ];
    errorCount = 3;

    await ErrorAlertsEvaluate();

    const calls = countQueryCalls();
    expect(calls.length).toBe(2);
    expect(calls[0][2].length).toBe(3);
    expect(calls[0][2][2]).toBe("svc-a");
    expect(String(calls[0][1])).toContain("serviceName = ?");
    expect(calls[1][2].length).toBe(2);
    expect(String(calls[1][1])).not.toContain("serviceName");
  });

  it("skips disabled rules without querying or recording an outcome", async () => {
    rulesInSettings = [
      { id: "r1", serviceName: "", threshold: 0, periodHours: 1, enabled: false },
    ];
    errorCount = 10;

    await ErrorAlertsEvaluate();

    expect(countQueryCalls().length).toBe(0);
    expect(NotificationSendErrorAlert).not.toHaveBeenCalled();
    expect(Object.keys(outcomeUpserts).length).toBe(0);
  });

  it("records an outcome error for an invalid rule instead of skipping silently", async () => {
    rulesInSettings = [
      { id: "r1", serviceName: "", threshold: -1, periodHours: 1, enabled: true },
      { id: "r2", serviceName: "", threshold: 0, periodHours: 0, enabled: true },
    ];

    await ErrorAlertsEvaluate();

    expect(countQueryCalls().length).toBe(0);
    expect(lastUpsertFor("r1").error).toContain("threshold");
    expect(lastUpsertFor("r2").error).toContain("periodHours");
  });

  it("does not re-send while a breach persists and re-arms after a quiet evaluation", async () => {
    rulesInSettings = [
      { id: "r1", serviceName: "", threshold: 5, periodHours: 1, enabled: true },
    ];
    previousOutcomes[OUTCOME_KEY_PREFIX + "r1"] = {
      at: "2026-10-17T00:00:00.000Z",
      count: 9,
      threshold: 5,
      breached: true,
      notified: true,
    };
    errorCount = 12;

    await ErrorAlertsEvaluate();
    expect(NotificationSendErrorAlert).not.toHaveBeenCalled();
    expect(lastUpsertFor("r1")).toMatchObject({ breached: true, notified: true });

    // A later under-threshold evaluation re-arms the rule.
    (NotificationSendErrorAlert as jest.Mock).mockClear();
    errorCount = 1;
    await ErrorAlertsEvaluate();
    expect(lastUpsertFor("r1")).toMatchObject({ breached: false });

    // Breach again: a new episode sends a new notification.
    (NotificationSendErrorAlert as jest.Mock).mockClear();
    errorCount = 20;
    await ErrorAlertsEvaluate();
    expect(NotificationSendErrorAlert).toHaveBeenCalledTimes(1);
  });

  it("sends when the previous breach was never notified (e.g. integration was disabled)", async () => {
    rulesInSettings = [
      { id: "r1", serviceName: "", threshold: 5, periodHours: 1, enabled: true },
    ];
    previousOutcomes[OUTCOME_KEY_PREFIX + "r1"] = {
      at: "2026-10-17T00:00:00.000Z",
      count: 9,
      threshold: 5,
      breached: true,
      notified: false,
      error: "notifications disabled",
    };
    errorCount = 12;

    await ErrorAlertsEvaluate();

    expect(NotificationSendErrorAlert).toHaveBeenCalledTimes(1);
    expect(lastUpsertFor("r1")).toMatchObject({ breached: true, notified: true });
  });

  it("records breached:false with notified:false when the notifications integration is disabled", async () => {
    (NotificationIsEnabled as jest.Mock).mockReturnValue(false);
    rulesInSettings = [
      { id: "r1", serviceName: "", threshold: 5, periodHours: 1, enabled: true },
    ];
    errorCount = 12;

    await ErrorAlertsEvaluate();

    expect(NotificationSendErrorAlert).not.toHaveBeenCalled();
    expect(lastUpsertFor("r1")).toMatchObject({
      count: 12,
      breached: true,
      notified: false,
      error: "notifications disabled",
    });
  });

  it("records the send failure as an outcome error", async () => {
    (NotificationSendErrorAlert as jest.Mock).mockResolvedValue(false);
    rulesInSettings = [
      { id: "r1", serviceName: "", threshold: 5, periodHours: 1, enabled: true },
    ];
    errorCount = 12;

    await ErrorAlertsEvaluate();

    expect(lastUpsertFor("r1")).toMatchObject({
      breached: true,
      notified: false,
      error: "notification send failed",
    });
  });

  it("returns the status payload with evaluations keyed by rule id", async () => {
    (DbUtilsQuerySQL as jest.Mock).mockImplementation(
      async (_span: unknown, sql: string) => {
        if (String(sql).includes("LIKE")) {
          return [
            {
              stateKey: OUTCOME_KEY_PREFIX + "r1",
              stateValue: JSON.stringify({
                at: "2026-10-17T00:00:00.000Z",
                count: 7,
                threshold: 5,
                breached: true,
                notified: true,
              }),
            },
          ];
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    );

    const status = await ErrorAlertsGetStatus();

    expect(status.notificationsEnabled).toBe(true);
    expect(status.evaluations.r1).toMatchObject({
      count: 7,
      breached: true,
      notified: true,
    });
  });
});
