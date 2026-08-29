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
 * Send a notification with the LLM recommendation after regeneration.
 *
 * @param periodHours The period in hours that the recommendation covers
 * @param analysis The analysis section of the recommendation
 * @param recommendations The recommendations section
 */
export async function NotificationSendRecommendation(
  periodHours: number,
  analysis: string,
  recommendations: string,
): Promise<void> {
  if (!notificationClient || !notificationClient.isEnabled()) {
    return;
  }

  const title = `LLM Recommendation generated (${periodHours}h analysis)`;
  const body = `## Analysis\n${analysis}\n\n## Recommendations\n${recommendations}`;

  const response = await notificationClient.info(title, body, "otel-light");
  if (response) {
    logger.info("LLM recommendation notification sent successfully");
  }
}
