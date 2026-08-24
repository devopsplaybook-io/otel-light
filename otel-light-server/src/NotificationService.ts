import { NotificationClient } from "./NotificationClient";
import { Config } from "./Config";
import { OTelLogger } from "./OTelContext";

const logger = OTelLogger().createModuleLogger("notification-service");

let notificationClient: NotificationClient | null = null;

/**
 * Initialize the notification service.
 */
export function NotificationInit(config: Config): void {
  if (config.NOTIFICATIONS_API && config.NOTIFICATIONS_TOKEN) {
    notificationClient = new NotificationClient({
      apiEndpoint: config.NOTIFICATIONS_API,
      apiToken: config.NOTIFICATIONS_TOKEN,
    });
    logger.info("Notification service initialized");
  } else {
    logger.info(
      "Notification service disabled (NOTIFICATIONS_API or NOTIFICATIONS_TOKEN not set)",
    );
  }
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
  if (!notificationClient) {
    return;
  }

  // Truncate analysis and recommendations to fit in notification body
  const maxBodyLength = 500;
  const truncatedAnalysis =
    analysis.length > maxBodyLength
      ? analysis.substring(0, maxBodyLength) + "..."
      : analysis;
  const truncatedRecommendations =
    recommendations.length > maxBodyLength
      ? recommendations.substring(0, maxBodyLength) + "..."
      : recommendations;

  const title = `LLM Recommendation generated (${periodHours}h analysis)`;
  const body = `## Analysis\n${truncatedAnalysis}\n\n## Recommendations\n${truncatedRecommendations}`;

  try {
    await notificationClient.info(title, body, "otel-light");
    logger.info("LLM recommendation notification sent successfully");
  } catch (err) {
    logger.error("Failed to send LLM recommendation notification", err);
  }
}
