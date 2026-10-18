import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesService } from "../services/PreferencesService";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe("isDark", () => {
  it("returns true when UI_THEME is dark", () => {
    localStorage.setItem("UI_THEME", "dark");
    expect(PreferencesService.isDark()).toBe(true);
  });

  it("returns false when UI_THEME is light", () => {
    localStorage.setItem("UI_THEME", "light");
    expect(PreferencesService.isDark()).toBe(false);
  });

  it("falls back to prefers-color-scheme when UI_THEME is unset", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    expect(PreferencesService.isDark()).toBe(true);
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    expect(PreferencesService.isDark()).toBe(false);
  });
});

describe("toggleTheme", () => {
  it("flips the vm flag, persists UI_THEME and applies data-theme", () => {
    const vm = { isDark: false };
    PreferencesService.toggleTheme(vm);
    expect(vm.isDark).toBe(true);
    expect(localStorage.getItem("UI_THEME")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    PreferencesService.toggleTheme(vm);
    expect(vm.isDark).toBe(false);
    expect(localStorage.getItem("UI_THEME")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

describe("applyTheme", () => {
  it("resolves the theme from the system preference when unset and persists it", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    PreferencesService.applyTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("UI_THEME")).toBe("dark");
  });
});
