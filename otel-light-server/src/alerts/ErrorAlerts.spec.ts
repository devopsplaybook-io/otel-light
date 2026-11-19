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
  NotificationSendAlertGroup: jest.fn(),
  NotificationSendRecoveryGroup: jest.fn(),
  NotificationSendRecommendation: jest.fn(),
}));

jest.mock("./AlertEvaluators", () => ({
  AlertRuleEvaluate: jest.fn(),
}));

jest.mock("./AlertHistory", () => ({
  AlertHistoryInsert: jest.fn(),
  AlertHistoryList: jest.fn(),
  AlertHistoryPrune: jest.fn(),
}));

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsQuerySQL: jest.fn(),
  DbUtilsExecSQL: jest.fn(),
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

import {
  NotificationIsEnabled,
  NotificationSendAlertGroup,
  NotificationSendRecoveryGroup,
} from "../NotificationService";
import { AlertRuleEvaluate } from "./AlertEvaluators";
import { AlertHistoryInsert, AlertHistoryPrune } from "./AlertHistory";
import { DbUtilsExecSQL, DbUtilsQuerySQL } from "../utils-std-ts/DbUtils";
import { ErrorAlertsEvaluate, ErrorAlertsGetStatus } from "./ErrorAlerts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const OUTCOME_KEY_PREFIX = "error-alert-outcome-";
const evaluateMock = AlertRuleEvaluate as jest.Mock;
const insertMock = AlertHistoryInsert as jest.Mock;
const pruneMock = AlertHistoryPrune as jest.Mock;
const queryMock = DbUtilsQuerySQL as jest.Mock;
const execMock = DbUtilsExecSQL as jest.Mock;

let rules: Loose[];
let windows: Loose[];
let states: Map<string, Loose>;
let legacyOutcomes: Map<string, Loose>;

const outcomeFor = (ruleId: string): Loose =>
  legacyOutcomes.get(OUTCOME_KEY_PREFIX + ruleId);

const eventsWithStatus = (status: string): Loose[] =>
  insertMock.mock.calls
    .map((call) => call[0])
    .filter((event: Loose) => event.status === status);

const breachedResult = (rule: Loose) => ({
  value: Number(rule.threshold) + 2,
  threshold: Number(rule.threshold),
  breached: true,
  signalType: "logs",
  signalPath: "/logs",
  signalQuery: "from=3600&serviceName=svc-a",
  message: `Breach for ${rule.id}`,
});

const healthyResult = (rule: Loose) => ({
  value: 0,
  threshold: Number(rule.threshold),
  breached: false,
  signalType: "logs",
  signalPath: "/logs",
  signalQuery: "from=3600&serviceName=svc-a",
  message: `Healthy for ${rule.id}`,
});

beforeEach(() => {
  jest.clearAllMocks();
  rules = [];
  windows = [];
  states = new Map();
  legacyOutcomes = new Map();

  queryMock.mockImplementation(async (_span: unknown, sql: string) => {
    if (String(sql).includes("FROM settings")) {
      return [
        {
          category: "error-alert-rules",
          content: JSON.stringify({ alertRules: rules, maintenanceWindows: windows }),
        },
      ];
    }
    if (String(sql).includes("FROM alert_rule_state")) {
      return Array.from(states.entries()).map(([ruleId, state]) => ({
        ruleId,
        stateValue: JSON.stringify(state),
      }));
    }
    if (String(sql).includes("FROM maintenance_state WHERE stateKey LIKE")) {
      return Array.from(legacyOutcomes.entries()).map(([key, outcome]) => ({
        stateKey: key,
        stateValue: JSON.stringify(outcome),
      }));
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  execMock.mockImplementation(
    async (_span: unknown, sql: string, params: Loose[]) => {
      if (String(sql).includes("INTO alert_rule_state")) {
        states.set(params[0], JSON.parse(params[1]));
        return 1;
      }
      if (String(sql).includes("INTO maintenance_state")) {
        legacyOutcomes.set(params[0], JSON.parse(params[1]));
        return 1;
      }
      if (String(sql).includes("DELETE FROM alert_rule_state")) {
        if (String(sql).includes("NOT IN")) {
          for (const ruleId of Array.from(states.keys())) {
            if (!params.includes(ruleId)) {
              states.delete(ruleId);
            }
          }
        } else {
          states.clear();
        }
        return 1;
      }
      if (String(sql).includes("DELETE FROM maintenance_state")) {
        legacyOutcomes.delete(params[0]);
        return 1;
      }
      throw new Error(`Unexpected exec: ${sql}`);
    },
  );

  (NotificationIsEnabled as jest.Mock).mockReturnValue(true);
  (NotificationSendAlertGroup as jest.Mock).mockResolvedValue({ sent: true });
  (NotificationSendRecoveryGroup as jest.Mock).mockResolvedValue({ sent: true });
  insertMock.mockResolvedValue(undefined);
  pruneMock.mockResolvedValue(undefined);
  evaluateMock.mockImplementation(async (_span: unknown, rule: Loose) =>
    breachedResult(rule),
  );
});

const logRule = (overrides: Record<string, unknown> = {}) => ({
  id: "r1",
  serviceName: "svc-a",
  threshold: 5,
  periodHours: 1,
  enabled: true,
  ...overrides,
});

describe("ErrorAlerts lifecycle", () => {
  it("notifies on the healthy to breached transition and records fired and notified", async () => {
    rules = [logRule()];

    await ErrorAlertsEvaluate();

    expect(NotificationSendAlertGroup).toHaveBeenCalledTimes(1);
    const [label, items] = (NotificationSendAlertGroup as jest.Mock).mock.calls[0];
    expect(label).toBe("svc-a");
    expect(items).toEqual([
      { message: "Breach for r1", severity: "warning" },
    ]);
    expect(eventsWithStatus("fired")).toHaveLength(1);
    expect(eventsWithStatus("notified")).toHaveLength(1);
    expect(outcomeFor("r1")).toMatchObject({
      breached: true,
      notified: true,
      count: 7,
      threshold: 5,
    });
    expect(states.get("r1")).toMatchObject({
      breached: true,
      notified: true,
      breachStartedAt: expect.any(String),
      lastNotifiedAt: expect.any(String),
    });
  });

  it("does not re-send a persisting breach, then repeats when the interval is due", async () => {
    rules = [logRule({ repeatIntervalMinutes: 30 })];
    const recent = new Date(Date.now() - 60_000).toISOString();
    states.set("r1", {
      at: recent,
      ruleType: "log-count",
      value: 7,
      threshold: 5,
      breached: true,
      notified: true,
      notifiedAt: recent,
      breachStartedAt: recent,
      lastNotifiedAt: recent,
      lastError: null,
      suppressed: false,
    });

    await ErrorAlertsEvaluate();
    expect(NotificationSendAlertGroup).not.toHaveBeenCalled();
    expect(eventsWithStatus("fired")).toHaveLength(0);

    const old = new Date(Date.now() - 3_600_000).toISOString();
    states.set("r1", {
      ...states.get("r1"),
      at: old,
      notifiedAt: old,
      breachStartedAt: old,
      lastNotifiedAt: old,
    });

    await ErrorAlertsEvaluate();
    expect(NotificationSendAlertGroup).toHaveBeenCalledTimes(1);
    expect(eventsWithStatus("notified")).toHaveLength(1);
  });

  it("retries when a persisting breach was never notified", async () => {
    rules = [logRule()];
    const previous = new Date(Date.now() - 60_000).toISOString();
    legacyOutcomes.set(OUTCOME_KEY_PREFIX + "r1", {
      at: previous,
      count: 9,
      threshold: 5,
      breached: true,
      notified: false,
      error: "notifications disabled",
    });

    await ErrorAlertsEvaluate();

    expect(NotificationSendAlertGroup).toHaveBeenCalledTimes(1);
    expect(outcomeFor("r1").notified).toBe(true);
  });

  it("sends a recovery notification when a notified episode clears", async () => {
    rules = [logRule()];
    const previous = new Date(Date.now() - 60_000).toISOString();
    states.set("r1", {
      at: previous,
      ruleType: "log-count",
      value: 7,
      threshold: 5,
      breached: true,
      notified: true,
      notifiedAt: previous,
      breachStartedAt: previous,
      lastNotifiedAt: previous,
      lastError: null,
      suppressed: false,
    });
    evaluateMock.mockImplementation(async (_span: unknown, rule: Loose) =>
      healthyResult(rule),
    );

    await ErrorAlertsEvaluate();

    expect(NotificationSendRecoveryGroup).toHaveBeenCalledTimes(1);
    expect(eventsWithStatus("resolved")).toHaveLength(1);
    expect(states.get("r1")).toMatchObject({
      breached: false,
      notified: false,
      breachStartedAt: null,
    });
  });

  it("does not send a recovery for an episode that was never notified or opts out", async () => {
    rules = [logRule()];
    const previous = new Date(Date.now() - 60_000).toISOString();
    states.set("r1", {
      at: previous,
      ruleType: "log-count",
      value: 7,
      threshold: 5,
      breached: true,
      notified: false,
      notifiedAt: null,
      breachStartedAt: previous,
      lastNotifiedAt: null,
      lastError: null,
      suppressed: false,
    });
    evaluateMock.mockImplementation(async (_span: unknown, rule: Loose) =>
      healthyResult(rule),
    );

    await ErrorAlertsEvaluate();
    expect(NotificationSendRecoveryGroup).not.toHaveBeenCalled();

    rules = [logRule({ notifyOnRecovery: false })];
    states.set("r1", {
      ...states.get("r1"),
      breached: true,
      notified: true,
      lastNotifiedAt: previous,
    });
    await ErrorAlertsEvaluate();
    expect(NotificationSendRecoveryGroup).not.toHaveBeenCalled();
    expect(eventsWithStatus("resolved").length).toBe(2);
  });

  it("records breaches without notifying when the integration is disabled", async () => {
    (NotificationIsEnabled as jest.Mock).mockReturnValue(false);
    rules = [logRule()];

    await ErrorAlertsEvaluate();

    expect(NotificationSendAlertGroup).not.toHaveBeenCalled();
    expect(outcomeFor("r1")).toMatchObject({
      breached: true,
      notified: false,
      error: "notifications disabled",
    });
    expect(eventsWithStatus("error")).toHaveLength(1);
  });

  it("records a failed send as an outcome error and keeps the breach eligible", async () => {
    (NotificationSendAlertGroup as jest.Mock).mockResolvedValue({
      sent: false,
      error: "notification send failed",
    });
    rules = [logRule()];

    await ErrorAlertsEvaluate();

    expect(outcomeFor("r1")).toMatchObject({
      breached: true,
      notified: false,
      error: "notification send failed",
    });
    expect(eventsWithStatus("error")).toHaveLength(1);
  });

  it("suppresses notifications inside a maintenance window but still evaluates", async () => {
    rules = [logRule()];
    windows = [
      {
        id: "w1",
        ruleId: "",
        serviceName: "svc-a",
        start: new Date(Date.now() - 3_600_000).toISOString(),
        end: new Date(Date.now() + 3_600_000).toISOString(),
        enabled: true,
      },
    ];

    await ErrorAlertsEvaluate();

    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(NotificationSendAlertGroup).not.toHaveBeenCalled();
    expect(eventsWithStatus("suppressed")).toHaveLength(1);
    expect(states.get("r1")).toMatchObject({
      breached: true,
      notified: false,
      suppressed: true,
      value: 7,
    });
    expect(outcomeFor("r1")).toMatchObject({
      breached: true,
      notified: false,
    });
  });

  it("groups the notifications of several rules of the same service", async () => {
    rules = [
      logRule({ id: "r1", serviceName: "svc-a" }),
      logRule({ id: "r2", serviceName: "svc-a", severity: "critical" }),
      logRule({ id: "r3", serviceName: "" }),
    ];

    await ErrorAlertsEvaluate();

    expect(NotificationSendAlertGroup).toHaveBeenCalledTimes(2);
    const groups = (NotificationSendAlertGroup as jest.Mock).mock.calls.map(
      (call) => ({ label: call[0], items: call[1] }),
    );
    expect(groups.find((group) => group.label === "svc-a")?.items).toHaveLength(2);
    expect(groups.find((group) => group.label === "All services")?.items).toHaveLength(1);
  });

  it("records an error event for an invalid rule without evaluating it", async () => {
    rules = [logRule({ threshold: -1 })];

    await ErrorAlertsEvaluate();

    expect(evaluateMock).not.toHaveBeenCalled();
    expect(outcomeFor("r1").error).toContain("threshold");
    expect(eventsWithStatus("error")).toHaveLength(1);
    expect(eventsWithStatus("error")[0].error).toContain("threshold");
  });

  it("skips disabled rules without evaluating or recording an outcome", async () => {
    rules = [logRule({ enabled: false })];

    await ErrorAlertsEvaluate();

    expect(evaluateMock).not.toHaveBeenCalled();
    expect(outcomeFor("r1")).toBeUndefined();
    expect(states.has("r1")).toBe(false);
  });

  it("normalizes legacy rules to log-count with ERROR and FATAL", async () => {
    rules = [{ id: "legacy", serviceName: "", threshold: 1, periodHours: 2, enabled: true }];

    await ErrorAlertsEvaluate();

    const evaluatedRule = evaluateMock.mock.calls[0][1];
    expect(evaluatedRule).toMatchObject({
      type: "log-count",
      severities: ["ERROR", "FATAL"],
      severity: "warning",
      repeatIntervalMinutes: 0,
    });
  });

  it("prunes the state of deleted rules and removes old history", async () => {
    states.set("gone", {
      at: new Date().toISOString(),
      ruleType: "log-count",
      value: 1,
      threshold: 0,
      breached: false,
      notified: false,
      notifiedAt: null,
      breachStartedAt: null,
      lastNotifiedAt: null,
      lastError: null,
      suppressed: false,
    });
    legacyOutcomes.set(OUTCOME_KEY_PREFIX + "gone", { at: "x", breached: false });
    rules = [logRule()];

    await ErrorAlertsEvaluate();

    expect(states.has("gone")).toBe(false);
    expect(legacyOutcomes.has(OUTCOME_KEY_PREFIX + "gone")).toBe(false);
    expect(states.has("r1")).toBe(true);
  });
});

describe("ErrorAlertsGetStatus", () => {
  it("returns full state first and legacy outcomes as fallback", async () => {
    legacyOutcomes.set(OUTCOME_KEY_PREFIX + "legacy-only", {
      at: "2026-11-18T00:00:00.000Z",
      count: 3,
      threshold: 1,
      breached: true,
      notified: false,
    });
    states.set("r1", {
      at: "2026-11-19T00:00:00.000Z",
      ruleType: "metric-threshold",
      value: 12.5,
      threshold: 10,
      breached: true,
      notified: true,
      notifiedAt: "2026-11-19T00:00:01.000Z",
      breachStartedAt: "2026-11-19T00:00:00.000Z",
      lastNotifiedAt: "2026-11-19T00:00:01.000Z",
      lastError: null,
      suppressed: false,
    });
    legacyOutcomes.set(OUTCOME_KEY_PREFIX + "r1", { at: "old", breached: false });

    const status = await ErrorAlertsGetStatus();

    expect(status.notificationsEnabled).toBe(true);
    expect(status.evaluations["legacy-only"]).toMatchObject({ count: 3 });
    expect(status.evaluations.r1).toMatchObject({
      ruleType: "metric-threshold",
      value: 12.5,
      threshold: 10,
      breached: true,
      notified: true,
      suppressed: false,
      notifiedAt: "2026-11-19T00:00:01.000Z",
    });
  });
});
