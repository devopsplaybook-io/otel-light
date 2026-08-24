import axios, { AxiosInstance } from "axios";

/**
 * Severity levels for notifications.
 */
export type NotificationSeverity = "info" | "warning" | "error" | "success";

/**
 * Configuration interface for the notification client.
 */
export interface NotificationConfig {
  /** API endpoint URL (e.g., "https://notifications.didierhoarau.cloud/api/notifications") */
  apiEndpoint: string;
  /** API token for authentication */
  apiToken: string;
}

/**
 * Payload for creating a notification.
 */
export interface NotificationPayload {
  /** Notification title */
  title: string;
  /** Notification body/content */
  body?: string;
  /** Source identifier (defaults to "api") */
  source?: string;
  /** Severity level (defaults to "info") */
  severity?: NotificationSeverity;
  /** Additional data as JSON string */
  data?: string;
}

/**
 * Response from the notifications API.
 */
export interface NotificationResponse {
  id: string;
  title: string;
  body: string;
  source: string;
  severity: string;
  data: string;
  createdAt: string;
}

/**
 * Client for sending notifications to the notifications service.
 */
export class NotificationClient {
  private client: AxiosInstance;
  private enabled: boolean;

  constructor(config: NotificationConfig) {
    this.enabled = !!(config.apiEndpoint && config.apiToken);

    this.client = axios.create({
      baseURL: config.apiEndpoint,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiToken}`,
      },
      timeout: 10000,
    });
  }

  /**
   * Check if the notification client is properly configured.
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Send a notification.
   *
   * @param payload The notification payload
   * @returns The created notification or null if disabled/failed
   */
  public async send(
    payload: NotificationPayload,
  ): Promise<NotificationResponse | null> {
    if (!this.enabled) {
      console.warn("NotificationClient: not configured, skipping notification");
      return null;
    }

    try {
      const response = await this.client.post<NotificationResponse>("/", {
        title: payload.title,
        body: payload.body || "",
        source: payload.source || "api",
        severity: payload.severity || "info",
        data: payload.data || "{}",
      });
      return response.data;
    } catch (error) {
      console.error("NotificationClient: failed to send notification", error);
      return null;
    }
  }

  /**
   * Send an info notification.
   */
  public async info(
    title: string,
    body?: string,
    source?: string,
  ): Promise<NotificationResponse | null> {
    return this.send({ title, body, source, severity: "info" });
  }

  /**
   * Send a success notification.
   */
  public async success(
    title: string,
    body?: string,
    source?: string,
  ): Promise<NotificationResponse | null> {
    return this.send({ title, body, source, severity: "success" });
  }

  /**
   * Send a warning notification.
   */
  public async warning(
    title: string,
    body?: string,
    source?: string,
  ): Promise<NotificationResponse | null> {
    return this.send({ title, body, source, severity: "warning" });
  }

  /**
   * Send an error notification.
   */
  public async error(
    title: string,
    body?: string,
    source?: string,
  ): Promise<NotificationResponse | null> {
    return this.send({ title, body, source, severity: "error" });
  }
}
