export class RefreshIntervalService {
  static KEY = "REFRESH_INTERVAL";

  static get(): string {
    return localStorage.getItem(RefreshIntervalService.KEY) || "10000";
  }

  static set(value: string) {
    localStorage.setItem(RefreshIntervalService.KEY, value);
  }
}
