import type { AlertEventStatus } from "./AlertRules";

export interface AlertHistoryEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: string;
  serviceName: string;
  status: AlertEventStatus;
  severity: string;
  observedValue: number | null;
  thresholdValue: number | null;
  message: string;
  signalType: string;
  signalPath: string;
  signalQuery: string;
  eventTime: string;
  notifiedAt: string | null;
  error: string | null;
}

export interface AlertHistoryPage {
  events: AlertHistoryEvent[];
  hasMore: boolean;
}

const STATUS_LABELS: Record<AlertEventStatus, string> = {
  fired: "Fired",
  notified: "Notified",
  resolved: "Resolved",
  suppressed: "Suppressed",
  error: "Error",
};

export function alertEventStatusLabel(status: string): string {
  return STATUS_LABELS[status as AlertEventStatus] || status || "Unknown";
}

export function alertEventValueText(event: AlertHistoryEvent): string {
  if (event.observedValue === null || event.observedValue === undefined) {
    return "—";
  }
  if (event.thresholdValue === null || event.thresholdValue === undefined) {
    return String(event.observedValue);
  }
  return `${event.observedValue} / threshold ${event.thresholdValue}`;
}

// Each history entry links to the search page filtered like the rule that
// fired: the signal query is produced by the server (period, service, metric
// keywords, errorsOnly) and follows the same `from` = seconds-ago convention
// accepted by SearchOptions.
export function alertHistoryLinkTarget(event: AlertHistoryEvent): string {
  const path = event.signalPath || `/${event.signalType || "logs"}`;
  return event.signalQuery ? `${path}?${event.signalQuery}` : path;
}

export function alertHistoryEventTime(event: AlertHistoryEvent): string {
  const parsed = new Date(event.eventTime);
  return Number.isNaN(parsed.getTime())
    ? event.eventTime
    : parsed.toLocaleString();
}
