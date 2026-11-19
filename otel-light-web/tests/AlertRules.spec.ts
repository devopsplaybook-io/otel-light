import { describe, expect, it } from "vitest";
import {
  AlertRuleFromForm,
  AlertRuleToForm,
  MaintenanceWindowFromForm,
  MaintenanceWindowToForm,
  alertDateToInputValue,
  alertInputValueToIso,
  alertOutcomeText,
  alertRuleIssues,
  alertRuleTypeLabel,
  maintenanceWindowIssues,
  newAlertRuleForm,
  newMaintenanceWindowForm,
  validateAlertingContent,
  validateAlertRules,
} from "../services/AlertRules";

const baseRule = (overrides: Record<string, unknown> = {}) => ({
  ...newAlertRuleForm("log-count"),
  id: "rule-1",
  ...overrides,
});

describe("newAlertRuleForm", () => {
  it("provides a complete default for every rule type", () => {
    expect(newAlertRuleForm("log-count")).toMatchObject({
      type: "log-count",
      threshold: 10,
      severities: ["ERROR", "FATAL"],
      periodValue: 24,
      periodUnit: "hours",
      severity: "warning",
      repeatIntervalMinutes: 0,
      notifyOnRecovery: true,
      enabled: true,
    });
    expect(newAlertRuleForm("metric-threshold")).toMatchObject({
      type: "metric-threshold",
      aggregation: "last",
      comparison: ">",
    });
    expect(newAlertRuleForm("trace-errors")).toMatchObject({
      type: "trace-errors",
      mode: "error-rate",
      threshold: 10,
    });
    expect(newAlertRuleForm("heartbeat")).toMatchObject({
      type: "heartbeat",
      signalType: "metrics",
    });
  });
});

describe("AlertRuleToForm", () => {
  it("normalizes a legacy rule without a type", () => {
    expect(
      AlertRuleToForm({
        id: "legacy",
        serviceName: "svc-a",
        threshold: 5,
        periodHours: 24,
        enabled: true,
      }),
    ).toMatchObject({
      id: "legacy",
      type: "log-count",
      serviceName: "svc-a",
      threshold: 5,
      periodValue: 1,
      periodUnit: "days",
      severities: ["ERROR", "FATAL"],
      severity: "warning",
      repeatIntervalMinutes: 0,
      notifyOnRecovery: true,
    });
  });

  it("keeps hours when the period is not a whole number of days", () => {
    const form = AlertRuleToForm({ id: "x", type: "metric-threshold", periodHours: 6 });
    expect(form.periodValue).toBe(6);
    expect(form.periodUnit).toBe("hours");
  });
});

describe("AlertRuleFromForm", () => {
  it("converts the log-count form to the API payload", () => {
    expect(
      AlertRuleFromForm(
        baseRule({
          periodValue: 2,
          periodUnit: "days",
          threshold: 3,
          severities: ["fatal", "CRITICAL"],
          repeatIntervalMinutes: 30,
          description: "  errors  ",
        }),
      ),
    ).toEqual({
      id: "rule-1",
      type: "log-count",
      description: "errors",
      serviceName: "",
      enabled: true,
      periodHours: 48,
      severity: "warning",
      repeatIntervalMinutes: 30,
      notifyOnRecovery: true,
      threshold: 3,
      severities: ["FATAL"],
    });
  });

  it("keeps the type-specific fields of every rule type", () => {
    expect(
      AlertRuleFromForm(
        baseRule({
          type: "metric-threshold",
          metricName: "cpu.usage",
          aggregation: "avg",
          comparison: ">=",
          threshold: 90,
        }),
      ),
    ).toMatchObject({
      type: "metric-threshold",
      metricName: "cpu.usage",
      aggregation: "avg",
      comparison: ">=",
      threshold: 90,
    });
    expect(
      AlertRuleFromForm(
        baseRule({ type: "trace-errors", mode: "error-count", threshold: 2 }),
      ),
    ).toMatchObject({ type: "trace-errors", mode: "error-count", threshold: 2 });
    expect(
      AlertRuleFromForm(
        baseRule({
          type: "heartbeat",
          signalType: "logs",
          serviceName: "svc-a",
        }),
      ),
    ).toMatchObject({ type: "heartbeat", signalType: "logs", serviceName: "svc-a" });
  });
});

describe("alertRuleIssues", () => {
  it("accepts valid rules of every type", () => {
    expect(alertRuleIssues(baseRule())).toEqual([]);
    expect(
      alertRuleIssues(
        baseRule({
          type: "metric-threshold",
          metricName: "cpu.usage",
          aggregation: "max",
          comparison: "<",
          threshold: 5,
        }),
      ),
    ).toEqual([]);
    expect(
      alertRuleIssues(baseRule({ type: "trace-errors", threshold: 100 })),
    ).toEqual([]);
    expect(
      alertRuleIssues(
        baseRule({ type: "heartbeat", serviceName: "svc-a", signalType: "traces" }),
      ),
    ).toEqual([]);
  });

  it("rejects a non-positive period and a negative threshold", () => {
    expect(alertRuleIssues(baseRule({ periodValue: 0 }))).toEqual([
      "period must be a positive number",
    ]);
    expect(alertRuleIssues(baseRule({ threshold: -1 }))).toEqual([
      "threshold must be a number >= 0",
    ]);
  });

  it("rejects missing or invalid per-type fields", () => {
    expect(
      alertRuleIssues(baseRule({ type: "heartbeat", serviceName: "" })),
    ).toContain("serviceName is required for heartbeat rules");
    expect(
      alertRuleIssues(baseRule({ type: "metric-threshold", metricName: "" })),
    ).toContain("metricName must be a non-empty string");
    expect(
      alertRuleIssues(baseRule({ type: "trace-errors", threshold: 150 })),
    ).toContain("threshold must be between 0 and 100 for error-rate rules");
    expect(alertRuleIssues(baseRule({ severities: [] }))).toContain(
      "severities must be a non-empty array",
    );
    expect(alertRuleIssues(baseRule({ severity: "loud" }))).toContain(
      "severity must be one of: info, warning, critical",
    );
    expect(
      alertRuleIssues(baseRule({ repeatIntervalMinutes: -5 })),
    ).toContain("repeatIntervalMinutes must be a number >= 0");
  });
});

describe("validateAlertRules", () => {
  it("prefixes each issue with the 1-based rule number", () => {
    expect(
      validateAlertRules([
        baseRule({ threshold: -1 }),
        baseRule({ id: "rule-2", periodValue: 0 }),
      ]),
    ).toEqual([
      "Rule 1: threshold must be a number >= 0",
      "Rule 2: period must be a positive number",
    ]);
  });

  it("handles a missing rules list", () => {
    expect(validateAlertRules(undefined)).toEqual([]);
  });
});

describe("maintenance windows", () => {
  it("creates a valid default window", () => {
    const window = newMaintenanceWindowForm();
    expect(window.enabled).toBe(true);
    expect(window.ruleId).toBe("");
    expect(window.serviceName).toBe("");
    expect(
      Date.parse(alertInputValueToIso(window.end)) >
        Date.parse(alertInputValueToIso(window.start)),
    ).toBe(true);
  });

  it("round-trips through the form converters", () => {
    const start = new Date(2026, 10, 19, 9, 0);
    const end = new Date(2026, 10, 19, 10, 30);
    const api = MaintenanceWindowFromForm({
      id: "w1",
      ruleId: "rule-1",
      serviceName: "svc-a",
      start: alertDateToInputValue(start.toISOString()),
      end: alertDateToInputValue(end.toISOString()),
      enabled: false,
    });
    expect(api).toEqual({
      id: "w1",
      ruleId: "rule-1",
      serviceName: "svc-a",
      start: start.toISOString(),
      end: end.toISOString(),
      enabled: false,
    });
    expectedForm(api);
  });

  it("reports invalid dates and an inverted range", () => {
    expect(
      maintenanceWindowIssues({
        id: "w1",
        start: "nope",
        end: "2026-11-19T10:00",
      }),
    ).toEqual(["start must be a valid date"]);
    expect(
      maintenanceWindowIssues({
        id: "w1",
        start: "2026-11-19T10:00",
        end: "2026-11-19T09:00",
      }),
    ).toEqual(["start must be before end"]);
  });

  it("prefixes window issues in the combined validation", () => {
    expect(
      validateAlertingContent({
        alertRules: [baseRule()],
        maintenanceWindows: [
          { id: "", start: "2026-11-19T10:00", end: "2026-11-19T09:00" },
        ],
      }),
    ).toEqual([
      "Maintenance window 1: id must be a non-empty string",
      "Maintenance window 1: start must be before end",
    ]);
  });

  it("rejects a missing rules array", () => {
    expect(
      validateAlertingContent(undefined as unknown as Parameters<
        typeof validateAlertingContent
      >[0]),
    ).toEqual(["alertRules must be an array of alert rules"]);
  });
});

function expectedForm(api: Record<string, unknown>) {
  expect(MaintenanceWindowToForm(api)).toMatchObject({
    id: "w1",
    ruleId: "rule-1",
    serviceName: "svc-a",
    enabled: false,
  });
  expect(alertInputValueToIso("2026-11-19T09:00")).toBe(
    new Date(2026, 10, 19, 9, 0).toISOString(),
  );
}

describe("alertOutcomeText", () => {
  const at = "2026-11-19T10:00:00.000Z";

  it("describes the lifecycle states", () => {
    expect(alertOutcomeText(null)).toBe("Not evaluated yet");
    expect(
      alertOutcomeText({ at, error: "threshold must be a number >= 0" }),
    ).toContain("failed: threshold must be a number >= 0");
    expect(
      alertOutcomeText({
        at,
        value: 12,
        threshold: 10,
        breached: true,
        notified: true,
      }),
    ).toContain("alert sent");
    expect(
      alertOutcomeText({
        at,
        value: 12,
        threshold: 10,
        breached: true,
        notified: false,
        suppressed: true,
      }),
    ).toContain("suppressed by a maintenance window");
    expect(
      alertOutcomeText({
        at,
        value: 3,
        threshold: 10,
        breached: false,
      }),
    ).toContain("OK");
  });

  it("labels every rule type", () => {
    expect(alertRuleTypeLabel("log-count")).toBe("Log count");
    expect(alertRuleTypeLabel("metric-threshold")).toBe("Metric threshold");
    expect(alertRuleTypeLabel("trace-errors")).toBe("Trace errors");
    expect(alertRuleTypeLabel("heartbeat")).toBe("Heartbeat");
  });
});
