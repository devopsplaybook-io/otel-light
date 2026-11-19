import { describe, expect, it } from "vitest";
import {
  cleanupRuleFix,
  cleanupRuleIssues,
  cleanupRuleKey,
  validateCleanupRules,
} from "../services/CleanupRules";

describe("cleanupRuleIssues", () => {
  it("reports no issues for a valid rule", () => {
    expect(
      cleanupRuleIssues({
        signalType: "logs",
        periodValue: 30,
        periodUnit: "days",
        pattern: "*",
        serviceName: "",
      }),
    ).toEqual([]);
  });

  it("reports a missing signal type", () => {
    expect(
      cleanupRuleIssues({ signalType: "", periodValue: 1, pattern: "x" }),
    ).toEqual(["signal type must be selected"]);
  });

  it("reports a non-positive period", () => {
    expect(
      cleanupRuleIssues({ signalType: "logs", periodValue: 0, pattern: "x" }),
    ).toEqual(["period must be a positive number"]);
    expect(
      cleanupRuleIssues({ signalType: "logs", periodValue: -5, pattern: "x" }),
    ).toEqual(["period must be a positive number"]);
  });

  it("reports a non-numeric or empty period", () => {
    expect(
      cleanupRuleIssues({ signalType: "logs", periodValue: "", pattern: "x" }),
    ).toEqual(["period must be a positive number"]);
    expect(
      cleanupRuleIssues({
        signalType: "logs",
        periodValue: Number.NaN,
        pattern: "x",
      }),
    ).toEqual(["period must be a positive number"]);
  });

  it("reports a blank pattern", () => {
    expect(
      cleanupRuleIssues({ signalType: "logs", periodValue: 1, pattern: "  " }),
    ).toEqual(["pattern must be a non-empty string"]);
    expect(
      cleanupRuleIssues({ signalType: "logs", periodValue: 1, pattern: "" }),
    ).toEqual(["pattern must be a non-empty string"]);
  });

  it("reports a whitespace-only service name but accepts all services", () => {
    expect(
      cleanupRuleIssues({
        signalType: "logs",
        periodValue: 1,
        pattern: "x",
        serviceName: "  ",
      }),
    ).toEqual(["serviceName must be a non-empty string"]);
    expect(
      cleanupRuleIssues({
        signalType: "logs",
        periodValue: 1,
        pattern: "x",
        serviceName: "",
      }),
    ).toEqual([]);
  });

  it("reports all issues of a broken rule together", () => {
    expect(cleanupRuleIssues({ signalType: "", periodValue: 0, pattern: "" }))
      .toEqual([
        "signal type must be selected",
        "period must be a positive number",
        "pattern must be a non-empty string",
      ]);
  });
});

describe("validateCleanupRules", () => {
  it("returns no messages when all rules are valid", () => {
    expect(
      validateCleanupRules([
        { signalType: "traces", periodValue: 2, periodUnit: "days", pattern: "a" },
        { signalType: "logs", periodValue: 3, periodUnit: "hours", pattern: "b" },
      ]),
    ).toEqual([]);
  });

  it("prefixes each issue with the 1-based rule number", () => {
    expect(
      validateCleanupRules([
        { signalType: "traces", periodValue: 0, pattern: "a" },
        { signalType: "", periodValue: 1, pattern: "" },
      ]),
    ).toEqual([
      "Rule 1: period must be a positive number",
      "Rule 2: signal type must be selected",
      "Rule 2: pattern must be a non-empty string",
    ]);
  });

  it("handles a missing rules list", () => {
    expect(validateCleanupRules(undefined as unknown as [])).toEqual([]);
  });
});

describe("cleanupRuleKey", () => {
  it("is stable regardless of the period", () => {
    expect(
      cleanupRuleKey({ signalType: "logs", pattern: "*", periodValue: 1 }),
    ).toBe(
      cleanupRuleKey({ signalType: "logs", pattern: "*", periodValue: 30 }),
    );
  });

  it("differs by signal, pattern or service", () => {
    const base = { signalType: "logs", pattern: "a", serviceName: "svc" };
    expect(cleanupRuleKey(base)).not.toBe(
      cleanupRuleKey({ ...base, signalType: "traces" }),
    );
    expect(cleanupRuleKey(base)).not.toBe(
      cleanupRuleKey({ ...base, pattern: "b" }),
    );
    expect(cleanupRuleKey(base)).not.toBe(
      cleanupRuleKey({ ...base, serviceName: "other" }),
    );
  });

  it("trims the service name and normalizes missing values", () => {
    expect(cleanupRuleKey({ serviceName: " svc " } as any)).toBe(
      cleanupRuleKey({ serviceName: "svc" } as any),
    );
    expect(cleanupRuleKey({} as any)).toBe(JSON.stringify(["", "", ""]));
  });
});

describe("cleanupRuleFix", () => {
  it("fixes each invalid part of a rule", () => {
    expect(
      cleanupRuleFix({
        signalType: "",
        periodValue: 0,
        periodUnit: "hours",
        pattern: "   ",
        serviceName: "  ",
      }),
    ).toEqual({
      signalType: "logs",
      periodValue: 30,
      periodUnit: "days",
      pattern: "*",
      serviceName: "",
    });
  });

  it("fixes a non-numeric period", () => {
    const fixed = cleanupRuleFix({
      signalType: "metrics",
      periodValue: "abc",
      periodUnit: "days",
      pattern: "x",
      serviceName: "",
    });
    expect(fixed.periodValue).toBe(30);
    expect(fixed.periodUnit).toBe("days");
  });

  it("leaves a valid rule unchanged and never mutates the input", () => {
    const rule = {
      signalType: "traces",
      periodValue: 2,
      periodUnit: "days",
      pattern: "error",
      serviceName: "svc",
    };
    const before = { ...rule };
    const fixed = cleanupRuleFix(rule);
    expect(fixed).toEqual(rule);
    expect(rule).toEqual(before);
    expect(fixed).not.toBe(rule);
  });
});
