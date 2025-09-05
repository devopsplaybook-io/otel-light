export const PreferencesService = {
  //
  toggleTheme(vm: any) {
    vm.isDark = !vm.isDark;
    localStorage.setItem("UI_THEME", vm.isDark ? "dark" : "light");
    this.applyTheme();
  },
  //
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
  //
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
  //
  setMetricAutoLoad(metricKey: string, autoLoad: boolean) {
    const settings = this.getMetricAutoLoadSettings();
    settings[metricKey] = autoLoad;
    localStorage.setItem("METRICS_AUTO_LOAD", JSON.stringify(settings));
  },
  //
  getMetricAutoLoad(metricKey: string): boolean {
    const settings = this.getMetricAutoLoadSettings();
    return settings[metricKey] !== false;
  },
};
