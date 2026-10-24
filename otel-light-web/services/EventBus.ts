import mitt from "mitt";
export const EventBus = mitt();

export enum EventTypes {
  ITEMS_UPDATED = "ITEMS_UPDATED",
  SOURCES_UPDATED = "SOURCES_UPDATED",
  AUTH_UPDATED = "AUTH_UPDATED",
  ALERT_MESSAGE = "ALERT_MESSAGE",
}

/**
 * Human-readable text for an error alert. Never uses a whole object as text
 * (which renders as "[object Object]").
 */
export function ErrorAlertText(error: any): string {
  const response = error?.response;
  const data = response?.data;
  if (data) {
    if (typeof data === "string") {
      return data;
    }
    if (typeof data.error === "string" && data.error) {
      return data.error;
    }
    if (typeof data.message === "string" && data.message) {
      return data.message;
    }
    try {
      const json = JSON.stringify(data);
      if (json && json !== "{}") {
        return json;
      }
    } catch {
      // Non-serializable payload: fall through to the status/message.
    }
  }
  if (response?.status) {
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    return `HTTP ${response.status}${statusText}`;
  }
  if (typeof error?.message === "string" && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  if (typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }
  return "Unknown error";
}

export function handleError(error: any): void {
  console.error(error);
  EventBus.emit(EventTypes.ALERT_MESSAGE, {
    type: "error",
    text: ErrorAlertText(error),
  });
}
