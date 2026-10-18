import { NotificationsClient } from "@devopsplaybook.io/common-utils";
import { Config } from "./Config";
import { OTelLogger } from "./OTelContext";

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
 * Send an error-threshold alert for a breached alert rule.
 *
 * @param serviceLabel The service name, or "all services" for global rules
 * @param count The number of error logs counted in the period
 * @param threshold The configured threshold that was exceeded
 * @param periodHours The lookback period of the rule in hours
 * @returns Whether a notification was actually sent (false when the
 *   integration is disabled or the send failed)
 */
export async function NotificationSendErrorAlert(
  serviceLabel: string,
  count: number,
  threshold: number,
  periodHours: number,
): Promise<boolean> {
  if (!notificationClient || !notificationClient.isEnabled()) {
    return false;
  }

  const title = `Error threshold breached: ${serviceLabel}`;
  const body =
    `${count} error logs in the last ${periodHours}h for ${serviceLabel}, ` +
    `above the configured threshold of ${threshold}.`;

  const response = await notificationClient.warning(title, body, "otel-light");
  if (response) {
    logger.info(`Error alert notification sent successfully (${serviceLabel})`);
  }
  return Boolean(response);
}
