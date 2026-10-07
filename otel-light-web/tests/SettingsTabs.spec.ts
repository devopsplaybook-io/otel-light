import { describe, expect, it } from "vitest";
import {
  resolveSettingsRedirect,
  SettingsTabs,
  visibleSettingsTabs,
} from "../services/SettingsTabs";

describe("SettingsTabs", () => {
  it("lists Profile first, then the admin tabs in order", () => {
    expect(SettingsTabs.map((tab) => tab.id)).toEqual([
      "profile",
      "maintenance",
      "users",
    ]);
    expect(SettingsTabs[0].to).toBe("/settings/profile");
  });

  it("shows only the Profile tab to non-admins", () => {
    expect(visibleSettingsTabs(false).map((tab) => tab.id)).toEqual([
      "profile",
    ]);
  });

  it("shows every tab to admins", () => {
    expect(visibleSettingsTabs(true).map((tab) => tab.id)).toEqual([
      "profile",
      "maintenance",
      "users",
    ]);
  });
});

describe("resolveSettingsRedirect", () => {
  it("redirects unauthenticated visitors away from admin tabs", () => {
    expect(
      resolveSettingsRedirect("/settings/maintenance", {
        isAuthenticated: false,
        isAdmin: false,
      }),
    ).toBe("/settings/profile");
    expect(
      resolveSettingsRedirect("/settings/users", {
        isAuthenticated: false,
        isAdmin: false,
      }),
    ).toBe("/settings/profile");
  });

  it("redirects non-admin users away from admin tabs", () => {
    expect(
      resolveSettingsRedirect("/settings/maintenance", {
        isAuthenticated: true,
        isAdmin: false,
      }),
    ).toBe("/settings/profile");
    expect(
      resolveSettingsRedirect("/settings/users", {
        isAuthenticated: true,
        isAdmin: false,
      }),
    ).toBe("/settings/profile");
  });

  it("lets admins open the admin tabs", () => {
    expect(
      resolveSettingsRedirect("/settings/maintenance", {
        isAuthenticated: true,
        isAdmin: true,
      }),
    ).toBeNull();
    expect(
      resolveSettingsRedirect("/settings/users", {
        isAuthenticated: true,
        isAdmin: true,
      }),
    ).toBeNull();
  });

  it("never redirects for the Profile tab, the settings index or unknown paths", () => {
    expect(
      resolveSettingsRedirect("/settings/profile", {
        isAuthenticated: false,
        isAdmin: false,
      }),
    ).toBeNull();
    expect(
      resolveSettingsRedirect("/settings", {
        isAuthenticated: false,
        isAdmin: false,
      }),
    ).toBeNull();
    expect(
      resolveSettingsRedirect("/traces", {
        isAuthenticated: true,
        isAdmin: true,
      }),
    ).toBeNull();
  });
});
