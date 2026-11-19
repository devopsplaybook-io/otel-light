export interface CleanupRuleForm {
  signalType?: string;
  periodValue?: number | string;
  periodUnit?: string;
  pattern?: string;
  serviceName?: string;
}

// Settings category where the maintenance run writes its per-rule summary.
export const CLEANUP_RUN_STATUS_CATEGORY = "signal-cleanup-rules-status";

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
  // "" means "all services"; a whitespace-only value is invalid (mirrors the
  // server's serviceName check).
  if (
    rule.serviceName !== undefined &&
    rule.serviceName !== null &&
    String(rule.serviceName) !== "" &&
    !String(rule.serviceName).trim()
  ) {
    issues.push("serviceName must be a non-empty string");
  }
  return issues;
}

// Must match MaintenanceCleanupRuleKey in otel-light-server/src/Maintenance.ts
// exactly: the run summary is joined with the rule forms by this identity.
export function cleanupRuleKey(rule: CleanupRuleForm): string {
  return JSON.stringify([
    String(rule?.signalType ?? ""),
    String(rule?.pattern ?? ""),
    String(rule?.serviceName ?? "").trim(),
  ]);
}

// Returns a fixed copy of the rule (never mutates the input). The operator
// still has to Save: the fix only makes the form valid.
export function cleanupRuleFix(rule: CleanupRuleForm): CleanupRuleForm {
  const fixed: CleanupRuleForm = { ...rule };
  if (!fixed.signalType) {
    fixed.signalType = "logs";
  }
  const periodValue = Number(fixed.periodValue);
  if (!Number.isFinite(periodValue) || periodValue <= 0) {
    fixed.periodValue = 30;
    fixed.periodUnit = "days";
  }
  if (!fixed.pattern || !String(fixed.pattern).trim()) {
    fixed.pattern = "*";
  }
  if (fixed.serviceName && !String(fixed.serviceName).trim()) {
    fixed.serviceName = "";
  }
  return fixed;
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
