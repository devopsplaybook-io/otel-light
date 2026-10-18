export interface ErrorAlertRuleForm {
  id?: string;
  serviceName?: string;
  threshold?: number | string;
  periodValue?: number | string;
  periodUnit?: string;
  enabled?: boolean;
}

// Validation semantics match the server-side PUT check
// (SettingsRoutes.validateErrorAlertRules) and the engine's checks
// (ErrorAlerts.ts ruleInvalidReason): a rule reported here could not run.
export function errorAlertRuleIssues(rule: ErrorAlertRuleForm): string[] {
  const issues: string[] = [];
  // An empty string must not be silently coerced to 0 ("any error").
  const threshold = Number(rule.threshold);
  if (
    rule.threshold === "" ||
    rule.threshold === null ||
    rule.threshold === undefined ||
    !Number.isFinite(threshold) ||
    threshold < 0
  ) {
    issues.push("threshold must be a number >= 0");
  }
  const periodValue = Number(rule.periodValue);
  if (!Number.isFinite(periodValue) || periodValue <= 0) {
    issues.push("period must be a positive number");
  }
  return issues;
}

export function validateErrorAlertRules(
  rules: ErrorAlertRuleForm[],
): string[] {
  const messages: string[] = [];
  (rules || []).forEach((rule, idx) => {
    for (const issue of errorAlertRuleIssues(rule)) {
      messages.push(`Rule ${idx + 1}: ${issue}`);
    }
  });
  return messages;
}
