import { NotificationsClient } from "@devopsplaybook.io/common-utils";
import { Config } from "./Config";
import { OTelLogger } from "./OTelContext";
import { AlertSeverity } from "./alerts/AlertRules";

const logger = OTelLogger().createModuleLogger("notification-service");

let notificationClient: NotificationsClient | null = null;

/**
 * Initialize the notification service.
 *
 * The shared client logs the integration status (enabled or disabled) once
 * at construction and never throws on partially configured settings.
 */
export function NotificationInit(config: Config): void {
  notificationClient = new NotificationsClient({
    apiEndpoint: config.NOTIFICATIONS_API,
    apiToken: config.NOTIFICATIONS_TOKEN,
    logger,
  });
}

/**
 * Whether the notifications integration is configured and usable. Used by the
 * UI (via /api/alerts/status) to show the integration as disabled instead of
 * failing silently.
 */
export function NotificationIsEnabled(): boolean {
  return Boolean(notificationClient && notificationClient.isEnabled());
}

export interface AlertNotificationItem {
  message: string;
  severity: AlertSeverity;
}

export interface AlertNotificationResult {
  sent: boolean;
  error?: string;
}

/**
 * Send a notification with the LLM recommendation after regeneration.
 *
 * @param periodHours The period in hours that the recommendation covers
 * @param analysis The analysis section of the recommendation
 * @param recommendations The recommendations section
 * @param perServiceLogs Optional per-service log totals/errors appended as a
 *   digest, so a quiet day is confirmed and not only the breaches reported.
 */
export async function NotificationSendRecommendation(
  periodHours: number,
  analysis: string,
  recommendations: string,
  perServiceLogs?: { serviceName: string; total: number; errors: number }[],
): Promise<void> {
  if (!notificationClient || !notificationClient.isEnabled()) {
    return;
  }

  const title = `LLM Recommendation generated (${periodHours}h analysis)`;
  let body = `## Analysis\n${analysis}\n\n## Recommendations\n${recommendations}`;
  if (perServiceLogs && perServiceLogs.length > 0) {
    const digest = perServiceLogs
      .map(
        (service) =>
          `- ${service.serviceName}: ${service.total} logs, ${service.errors} errors`,
      )
      .join("\n");
    body += `\n\n## Daily error digest\n${digest}`;
  }

  const response = await notificationClient.info(title, body, "otel-light");
  if (response) {
    logger.info("LLM recommendation notification sent successfully");
  }
}

/**
 * Send one grouped alert notification. Items are grouped by service by the
 * alert engine; the highest severity of the group selects the notification
 * method (critical -> error, warning -> warning, info -> info).
 */
export async function NotificationSendAlertGroup(
  groupLabel: string,
  items: AlertNotificationItem[],
): Promise<AlertNotificationResult> {
  const title = `Alert: ${groupLabel}`;
  const body = items.map((item) => `- ${item.message}`).join("\n");
  return AlertNotificationSend(NotificationSeverityMax(items), title, body, groupLabel);
}

/**
 * Send one grouped recovery notification (same routing as breaches).
 */
export async function NotificationSendRecoveryGroup(
  groupLabel: string,
  items: AlertNotificationItem[],
): Promise<AlertNotificationResult> {
  const title = `Alert recovered: ${groupLabel}`;
  const body = items.map((item) => `- ${item.message}`).join("\n");
  return AlertNotificationSend(NotificationSeverityMax(items), title, body, groupLabel);
}

/**
 * Sample notification used by the settings "send test notification" action.
 */
export async function NotificationSendTest(
  severity: AlertSeverity,
): Promise<AlertNotificationResult> {
  return AlertNotificationSend(
    severity,
    "Test notification from OTel Light",
    `This is a ${severity} test notification. Alert rules deliver grouped breach and recovery notifications through this channel.`,
  );
}

// Private Functions

function NotificationSeverityMax(items: AlertNotificationItem[]): AlertSeverity {
  const rank: Record<AlertSeverity, number> = {
    info: 0,
    warning: 1,
    critical: 2,
  };
  let max: AlertSeverity = "info";
  for (const item of items || []) {
    if ((rank[item.severity] ?? 0) > rank[max]) {
      max = item.severity;
    }
  }
  return max;
}

async function AlertNotificationSend(
  severity: AlertSeverity,
  title: string,
  body: string,
  context?: string,
): Promise<AlertNotificationResult> {
  if (!notificationClient || !notificationClient.isEnabled()) {
    return { sent: false, error: "notifications disabled" };
  }
  // The notification client exposes info/success/warning/error only: the
  // rule-level "critical" maps to "error" and the webhook contract keeps the
  // existing info|warning|error severities.
  const response =
    severity === "critical"
      ? await notificationClient.error(title, body, "otel-light")
      : severity === "warning"
        ? await notificationClient.warning(title, body, "otel-light")
        : await notificationClient.info(title, body, "otel-light");
  if (response) {
    logger.info(
      `Alert notification sent successfully${context ? ` (${context})` : ""}`,
    );
    return { sent: true };
  }
  return { sent: false, error: "notification send failed" };
}
