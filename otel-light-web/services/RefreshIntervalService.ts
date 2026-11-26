export const RefreshIntervalOptions = [
  { value: "0", label: "No auto-refresh" },
  { value: "5000", label: "5 seconds" },
  { value: "10000", label: "10 seconds" },
  { value: "30000", label: "30 seconds" },
  { value: "60000", label: "1 minute" },
];

/**
 * Metrics refresh is deliberately slower than traces/logs: a metrics page
 * can hold dozens of charts, and each chart runs its own range query, so a
 * fast shared interval overloads the server (502s from the reverse proxy).
 * Five minutes keeps large dashboards responsive without hammering the API;
 * the per-card refresh button and the stale indicator remain available.
 */
export const MetricsRefreshIntervalOptions = [
  { value: "0", label: "No auto-refresh" },
  { value: "30000", label: "30 seconds" },
  { value: "60000", label: "1 minute" },
  { value: "300000", label: "5 minutes" },
  { value: "900000", label: "15 minutes" },
  { value: "1800000", label: "30 minutes" },
];

export class RefreshIntervalService {
  static KEY = "REFRESH_INTERVAL";
  static METRICS_KEY = "REFRESH_INTERVAL_METRICS";

  static get(): string {
    return localStorage.getItem(RefreshIntervalService.KEY) || "10000";
  }

  static set(value: string) {
    localStorage.setItem(RefreshIntervalService.KEY, value);
  }

  static getMetrics(): string {
    return (
      localStorage.getItem(RefreshIntervalService.METRICS_KEY) || "300000"
    );
  }

  static setMetrics(value: string) {
    localStorage.setItem(RefreshIntervalService.METRICS_KEY, value);
  }
}
