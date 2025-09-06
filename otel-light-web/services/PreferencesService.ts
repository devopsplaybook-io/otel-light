const TIME_WINDOW_KEYS = {
  traces: "DEFAULT_TIME_WINDOW_TRACES",
  metrics: "DEFAULT_TIME_WINDOW_METRICS",
  logs: "DEFAULT_TIME_WINDOW_LOGS",
};

export const TimeWindowOptions = [
  { label: "now", value: 0 },
  { label: "5 min ago", value: 5 * 60 },
  { label: "10 min ago", value: 10 * 60 },
  { label: "30 min ago", value: 30 * 60 },
  { label: "1 h ago", value: 1 * 60 * 60 },
  { label: "2 h ago", value: 2 * 60 * 60 },
  { label: "6 h ago", value: 6 * 60 * 60 },
  { label: "12 h ago", value: 12 * 60 * 60 },
  { label: "1 day ago", value: 24 * 60 * 60 },
  { label: "2 days ago", value: 2 * 24 * 60 * 60 },
  { label: "5 days ago", value: 5 * 24 * 60 * 60 },
  { label: "10 days ago", value: 10 * 24 * 60 * 60 },
  { label: "30 days ago", value: 30 * 24 * 60 * 60 },
  { label: "90 days ago", value: 90 * 24 * 60 * 60 },
  { label: "180 days ago", value: 180 * 24 * 60 * 60 },
  { label: "1 year ago", value: 365 * 24 * 60 * 60 },
  { label: "all", value: 99999 * 24 * 60 * 60 },
];

export function getDefaultTimeWindow(type: "traces" | "metrics" | "logs") {
  const key = TIME_WINDOW_KEYS[type];
  const val = localStorage.getItem(key);
  return val ? Number(val) : 30 * 60; // default 30 min
}

export function setDefaultTimeWindow(
  type: "traces" | "metrics" | "logs",
  value: number
) {
  const key = TIME_WINDOW_KEYS[type];
  localStorage.setItem(key, String(value));
}

export const PreferencesService = {
  //
  toggleTheme(vm: any) {
    vm.isDark = !vm.isDark;
    localStorage.setItem("UI_THEME", vm.isDark ? "dark" : "light");
    this.applyTheme();
  },

  applyTheme() {
    const storedTheme = localStorage.getItem("UI_THEME");
    let isDark = false;
    if (storedTheme === "dark" || storedTheme === "light") {
      isDark = storedTheme === "dark";
    } else {
      isDark =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    document.documentElement.setAttribute(
      "data-theme",
      isDark ? "dark" : "light"
    );
    localStorage.setItem("UI_THEME", isDark ? "dark" : "light");
  },

  getMetricAutoLoadSettings(): { [key: string]: boolean } {
    const stored = localStorage.getItem("METRICS_AUTO_LOAD");
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.warn("Failed to parse metrics auto-load settings:", e);
      }
    }
    return {};
  },

  setMetricAutoLoad(metricKey: string, autoLoad: boolean) {
    const settings = this.getMetricAutoLoadSettings();
    settings[metricKey] = autoLoad;
    localStorage.setItem("METRICS_AUTO_LOAD", JSON.stringify(settings));
  },

  getMetricAutoLoad(metricKey: string): boolean {
    const settings = this.getMetricAutoLoadSettings();
    return settings[metricKey] !== false;
  },
};
