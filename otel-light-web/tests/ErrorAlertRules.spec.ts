import { describe, expect, it } from "vitest";
import {
  errorAlertRuleIssues,
  validateErrorAlertRules,
} from "../services/ErrorAlertRules";

describe("errorAlertRuleIssues", () => {
  it("reports no issues for a valid rule", () => {
    expect(
      errorAlertRuleIssues({
        id: "6a2f2e7e-1f6b-4b7e-8de5-3f9f9c8f1f01",
        serviceName: "",
        threshold: 10,
        periodValue: 24,
        periodUnit: "hours",
        enabled: true,
      }),
    ).toEqual([]);
  });

  it("reports a negative threshold", () => {
    expect(
      errorAlertRuleIssues({ threshold: -1, periodValue: 1 }),
    ).toEqual(["threshold must be a number >= 0"]);
  });

  it("reports a non-numeric or missing threshold", () => {
    expect(
      errorAlertRuleIssues({ threshold: "", periodValue: 1 }),
    ).toEqual(["threshold must be a number >= 0"]);
    expect(
      errorAlertRuleIssues({ threshold: Number.NaN, periodValue: 1 }),
    ).toEqual(["threshold must be a number >= 0"]);
    expect(
      errorAlertRuleIssues({ periodValue: 1 }),
    ).toEqual(["threshold must be a number >= 0"]);
  });

  it("allows a threshold of zero (any error)", () => {
    expect(
      errorAlertRuleIssues({ threshold: 0, periodValue: 1 }),
    ).toEqual([]);
  });

  it("reports a non-positive period", () => {
    expect(errorAlertRuleIssues({ threshold: 1, periodValue: 0 })).toEqual([
      "period must be a positive number",
    ]);
    expect(errorAlertRuleIssues({ threshold: 1, periodValue: -5 })).toEqual([
      "period must be a positive number",
    ]);
  });

  it("reports all issues of a broken rule together", () => {
    expect(errorAlertRuleIssues({ threshold: -1, periodValue: 0 })).toEqual([
      "threshold must be a number >= 0",
      "period must be a positive number",
    ]);
  });
});

describe("validateErrorAlertRules", () => {
  it("returns no messages when all rules are valid", () => {
    expect(
      validateErrorAlertRules([
        { threshold: 5, periodValue: 2, periodUnit: "days" },
        { threshold: 0, periodValue: 6, periodUnit: "hours" },
      ]),
    ).toEqual([]);
  });

  it("prefixes each issue with the 1-based rule number", () => {
    expect(
      validateErrorAlertRules([
        { threshold: -1, periodValue: 1 },
        { threshold: 1, periodValue: 0 },
      ]),
    ).toEqual([
      "Rule 1: threshold must be a number >= 0",
      "Rule 2: period must be a positive number",
    ]);
  });

  it("handles a missing rules list", () => {
    expect(validateErrorAlertRules(undefined as unknown as [])).toEqual([]);
  });
});
