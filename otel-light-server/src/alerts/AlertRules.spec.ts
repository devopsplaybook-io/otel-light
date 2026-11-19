import {
  AlertMaintenanceWindowActive,
  AlertMaintenanceWindowIssues,
  AlertRuleIssues,
  AlertRuleLabel,
  AlertRuleNormalize,
  AlertServiceLabel,
  AlertSignalLink,
  ValidateAlertRulesContent,
} from "./AlertRules";

const legacyRule = (overrides: Record<string, unknown> = {}) => ({
  id: "legacy-1",
  serviceName: "svc-a",
  threshold: 10,
  periodHours: 24,
  enabled: true,
  ...overrides,
});

describe("AlertRuleNormalize", () => {
  it("normalizes a legacy rule to a log-count rule with ERROR and FATAL", () => {
    const rule = AlertRuleNormalize(legacyRule());
    expect(rule).toMatchObject({
      id: "legacy-1",
      type: "log-count",
      serviceName: "svc-a",
      enabled: true,
      periodHours: 24,
      threshold: 10,
      severities: ["ERROR", "FATAL"],
      severity: "warning",
      repeatIntervalMinutes: 0,
      notifyOnRecovery: true,
    });
  });

  it("normalizes an explicit log-count rule with custom severities", () => {
    const rule = AlertRuleNormalize({
      ...legacyRule(),
      type: "log-count",
      severities: ["fatal", "CRITICAL"],
    });
    expect(rule.type).toBe("log-count");
    expect((rule as { severities: string[] }).severities).toEqual(["FATAL"]);
  });

  it("normalizes an unknown or empty severities list back to ERROR and FATAL", () => {
    const rule = AlertRuleNormalize({
      ...legacyRule(),
      type: "log-count",
      severities: ["NOT_A_SEVERITY"],
    });
    expect((rule as { severities: string[] }).severities).toEqual([
      "ERROR",
      "FATAL",
    ]);
  });

  it("normalizes every rule type with its defaults", () => {
    const metric = AlertRuleNormalize({
      ...legacyRule(),
      type: "metric-threshold",
      metricName: "http.server.duration",
      threshold: 250,
    });
    expect(metric).toMatchObject({
      type: "metric-threshold",
      metricName: "http.server.duration",
      aggregation: "last",
      comparison: ">",
      threshold: 250,
      severity: "warning",
    });

    const traces = AlertRuleNormalize({
      ...legacyRule(),
      type: "trace-errors",
      threshold: 5,
    });
    expect(traces).toMatchObject({ type: "trace-errors", mode: "error-rate" });

    const heartbeat = AlertRuleNormalize({
      ...legacyRule(),
      type: "heartbeat",
    });
    expect(heartbeat).toMatchObject({
      type: "heartbeat",
      signalType: "metrics",
      metricName: "",
    });
  });
});

describe("AlertRuleIssues", () => {
  it("accepts a legacy rule unchanged", () => {
    expect(AlertRuleIssues(legacyRule())).toEqual([]);
  });

  it("accepts one valid rule of each type", () => {
    expect(
      AlertRuleIssues({
        ...legacyRule(),
        type: "metric-threshold",
        metricName: "m",
        aggregation: "avg",
        comparison: ">=",
        threshold: 1,
        severity: "critical",
        repeatIntervalMinutes: 15,
        notifyOnRecovery: false,
      }),
    ).toEqual([]);
    expect(
      AlertRuleIssues({
        ...legacyRule(),
        type: "trace-errors",
        mode: "error-count",
        threshold: 3,
      }),
    ).toEqual([]);
    expect(
      AlertRuleIssues({
        ...legacyRule(),
        type: "heartbeat",
        signalType: "metrics",
        metricName: "synthetic.probe",
      }),
    ).toEqual([]);
  });

  it("rejects an unknown type and type-specific field problems", () => {
    expect(AlertRuleIssues({ ...legacyRule(), type: "unknown" })).toContain(
      "type must be one of: log-count, metric-threshold, trace-errors, heartbeat",
    );
    expect(
      AlertRuleIssues({ ...legacyRule(), type: "metric-threshold", threshold: 1 }),
    ).toContain("metricName must be a non-empty string");
    expect(
      AlertRuleIssues({
        ...legacyRule(),
        type: "metric-threshold",
        metricName: "m",
        aggregation: "median",
        threshold: 1,
      }),
    ).toContain("aggregation must be one of: last, avg, max, min");
    expect(
      AlertRuleIssues({
        ...legacyRule(),
        type: "metric-threshold",
        metricName: "m",
        comparison: "!=",
        threshold: 1,
      }),
    ).toContain("comparison must be one of: >, >=, <, <=");
    expect(
      AlertRuleIssues({ ...legacyRule(), type: "trace-errors", mode: "rate", threshold: 1 }),
    ).toContain("mode must be one of: error-count, error-rate");
    expect(
      AlertRuleIssues({ ...legacyRule(), type: "trace-errors", threshold: 101 }),
    ).toContain("threshold must be between 0 and 100 for error-rate rules");
    expect(
      AlertRuleIssues({ ...legacyRule(), type: "heartbeat", serviceName: "" }),
    ).toContain("serviceName is required for heartbeat rules");
    expect(
      AlertRuleIssues({
        ...legacyRule(),
        type: "heartbeat",
        signalType: "events",
      }),
    ).toContain("signalType must be one of: logs, traces, metrics");
  });

  it("rejects invalid common fields and severities", () => {
    expect(AlertRuleIssues(legacyRule({ threshold: -1 }))).toContain(
      "threshold must be a number >= 0",
    );
    expect(AlertRuleIssues(legacyRule({ threshold: "" }))).toContain(
      "threshold must be a number >= 0",
    );
    expect(AlertRuleIssues(legacyRule({ periodHours: 0 }))).toContain(
      "periodHours must be a positive number",
    );
    expect(AlertRuleIssues(legacyRule({ enabled: "yes" }))).toContain(
      "enabled must be a boolean",
    );
    expect(AlertRuleIssues(legacyRule({ id: "" }))).toContain(
      "id must be a non-empty string",
    );
    expect(AlertRuleIssues(legacyRule({ severity: "loud" }))).toContain(
      "severity must be one of: info, warning, critical",
    );
    expect(
      AlertRuleIssues(legacyRule({ repeatIntervalMinutes: -5 })),
    ).toContain("repeatIntervalMinutes must be a number >= 0");
    expect(AlertRuleIssues(legacyRule({ severities: [] }))).toContain(
      "severities must be a non-empty array",
    );
    expect(AlertRuleIssues(legacyRule({ severities: ["LOUD"] }))).toContain(
      "severities must only contain: TRACE, DEBUG, INFO, WARN, ERROR, FATAL",
    );
    expect(AlertRuleIssues(null)).toEqual(["rule must be an object"]);
  });
});

describe("ValidateAlertRulesContent", () => {
  it("accepts legacy content without maintenance windows", () => {
    expect(
      ValidateAlertRulesContent({ alertRules: [legacyRule()] }),
    ).toEqual([]);
  });

  it("rejects a missing rules array", () => {
    expect(ValidateAlertRulesContent(null)).toEqual([
      "alertRules must be an array of alert rules",
    ]);
    expect(ValidateAlertRulesContent({})).toEqual([
      "alertRules must be an array of alert rules",
    ]);
  });

  it("prefixes issues with the rule number", () => {
    expect(
      ValidateAlertRulesContent({
        alertRules: [legacyRule(), legacyRule({ threshold: -1 })],
      }),
    ).toEqual(["Rule 2: threshold must be a number >= 0"]);
  });

  it("validates maintenance windows", () => {
    expect(
      ValidateAlertRulesContent({
        alertRules: [],
        maintenanceWindows: [
          {
            id: "w1",
            ruleId: "",
            serviceName: "",
            start: "2026-11-19T00:00:00.000Z",
            end: "2026-11-19T02:00:00.000Z",
            enabled: true,
          },
        ],
      }),
    ).toEqual([]);

    expect(
      ValidateAlertRulesContent({
        alertRules: [],
        maintenanceWindows: [
          {
            id: "w1",
            start: "2026-11-19T02:00:00.000Z",
            end: "2026-11-19T01:00:00.000Z",
          },
        ],
      }),
    ).toEqual(["Maintenance window 1: start must be before end"]);

    expect(
      ValidateAlertRulesContent({
        alertRules: [],
        maintenanceWindows: [{ id: "w1", start: "nope", end: "nope" }],
      }),
    ).toEqual([
      "Maintenance window 1: start must be a valid ISO date",
      "Maintenance window 1: end must be a valid ISO date",
    ]);
    expect(AlertMaintenanceWindowIssues({ id: "w", start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" })).toEqual([]);
  });
});

describe("AlertMaintenanceWindowActive", () => {
  const rule = AlertRuleNormalize(legacyRule());
  const nowMs = Date.parse("2026-11-19T12:00:00.000Z");
  const window = (overrides: Record<string, unknown> = {}) => ({
    id: "w1",
    ruleId: "",
    serviceName: "",
    start: "2026-11-19T11:00:00.000Z",
    end: "2026-11-19T13:00:00.000Z",
    enabled: true,
    ...overrides,
  });

  it("matches a global active window", () => {
    expect(AlertMaintenanceWindowActive([window()], rule, nowMs)).toBe(true);
  });

  it("ignores inactive, expired, rule-scoped and other-service windows", () => {
    expect(
      AlertMaintenanceWindowActive([window({ enabled: false })], rule, nowMs),
    ).toBe(false);
    expect(
      AlertMaintenanceWindowActive(
        [window({ start: "2026-11-19T08:00:00.000Z", end: "2026-11-19T09:00:00.000Z" })],
        rule,
        nowMs,
      ),
    ).toBe(false);
    expect(
      AlertMaintenanceWindowActive([window({ ruleId: "other" })], rule, nowMs),
    ).toBe(false);
    expect(
      AlertMaintenanceWindowActive(
        [window({ serviceName: "svc-b" })],
        rule,
        nowMs,
      ),
    ).toBe(false);
    expect(
      AlertMaintenanceWindowActive(
        [window({ ruleId: "legacy-1", serviceName: "svc-a" })],
        rule,
        nowMs,
      ),
    ).toBe(true);
  });

  it("does not mute an all-services rule with a service-scoped window", () => {
    const globalRule = AlertRuleNormalize(legacyRule({ serviceName: "" }));
    expect(
      AlertMaintenanceWindowActive(
        [window({ serviceName: "svc-a" })],
        globalRule,
        nowMs,
      ),
    ).toBe(false);
  });
});

describe("labels and signal links", () => {
  it("uses the description as label when set", () => {
    const rule = AlertRuleNormalize(
      legacyRule({ description: "Custom label", type: "heartbeat" }),
    );
    expect(AlertRuleLabel(rule)).toBe("Custom label");
    expect(AlertServiceLabel(rule)).toBe("svc-a");
  });

  it("derives labels from the rule fields", () => {
    expect(AlertRuleLabel(AlertRuleNormalize(legacyRule()))).toBe(
      "svc-a: ERROR+FATAL logs > 10",
    );
    expect(
      AlertRuleLabel(
        AlertRuleNormalize({
          ...legacyRule(),
          serviceName: "",
          type: "metric-threshold",
          metricName: "m",
          threshold: 1,
        }),
      ),
    ).toBe("All services: m last > 1");
    expect(
      AlertRuleLabel(
        AlertRuleNormalize({
          ...legacyRule(),
          type: "trace-errors",
          mode: "error-count",
          threshold: 2,
        }),
      ),
    ).toBe("svc-a: trace errors > 2");
    expect(
      AlertRuleLabel(
        AlertRuleNormalize({ ...legacyRule(), type: "heartbeat", metricName: "probe" }),
      ),
    ).toBe("svc-a: no metrics (probe)");
  });

  it("builds log links with a single severity filter only", () => {
    expect(AlertSignalLink(AlertRuleNormalize(legacyRule()))).toEqual({
      signalType: "logs",
      signalPath: "/logs",
      signalQuery: "from=86400&serviceName=svc-a",
    });
    expect(
      AlertSignalLink(
        AlertRuleNormalize(
          legacyRule({ severities: ["FATAL"], periodHours: 0.5 }),
        ),
      ),
    ).toEqual({
      signalType: "logs",
      signalPath: "/logs",
      signalQuery: "from=1800&serviceName=svc-a&severity=FATAL",
    });
  });

  it("builds metric, trace and heartbeat links", () => {
    expect(
      AlertSignalLink(
        AlertRuleNormalize({
          ...legacyRule(),
          type: "metric-threshold",
          metricName: "cpu.usage",
        }),
      ),
    ).toEqual({
      signalType: "metrics",
      signalPath: "/metrics",
      signalQuery: "from=86400&serviceName=svc-a&keywords=cpu.usage",
    });
    expect(
      AlertSignalLink(
        AlertRuleNormalize({ ...legacyRule(), type: "trace-errors", threshold: 1 }),
      ),
    ).toEqual({
      signalType: "traces",
      signalPath: "/traces",
      signalQuery: "from=86400&serviceName=svc-a&errorsOnly=true",
    });
    expect(
      AlertSignalLink(
        AlertRuleNormalize({
          ...legacyRule(),
          type: "heartbeat",
          signalType: "metrics",
          metricName: "probe",
        }),
      ),
    ).toEqual({
      signalType: "metrics",
      signalPath: "/metrics",
      signalQuery: "from=86400&serviceName=svc-a&keywords=probe",
    });
    expect(
      AlertSignalLink(
        AlertRuleNormalize({
          ...legacyRule(),
          type: "heartbeat",
          signalType: "logs",
          metricName: "",
        }),
      ),
    ).toEqual({
      signalType: "logs",
      signalPath: "/logs",
      signalQuery: "from=86400&serviceName=svc-a",
    });
  });
});
