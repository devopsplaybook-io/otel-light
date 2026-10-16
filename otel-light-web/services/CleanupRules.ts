export interface CleanupRuleForm {
  signalType?: string;
  periodValue?: number | string;
  periodUnit?: string;
  pattern?: string;
  serviceName?: string;
}

// Validation semantics match the server-side PUT check
// (SettingsRoutes.validateSignalCleanupRules) and the engine's skip
// conditions (Maintenance.ts ApplyCleanupRule): a rule reported here would
// be silently skipped by the maintenance run.
export function cleanupRuleIssues(rule: CleanupRuleForm): string[] {
  const issues: string[] = [];
  if (!rule.signalType) {
    issues.push("signal type must be selected");
  }
  const periodValue = Number(rule.periodValue);
  if (!Number.isFinite(periodValue) || periodValue <= 0) {
    issues.push("period must be a positive number");
  }
  if (!rule.pattern || !String(rule.pattern).trim()) {
    issues.push("pattern must be a non-empty string");
  }
  return issues;
}

export function validateCleanupRules(rules: CleanupRuleForm[]): string[] {
  const messages: string[] = [];
  (rules || []).forEach((rule, idx) => {
    for (const issue of cleanupRuleIssues(rule)) {
      messages.push(`Rule ${idx + 1}: ${issue}`);
    }
  });
  return messages;
}
