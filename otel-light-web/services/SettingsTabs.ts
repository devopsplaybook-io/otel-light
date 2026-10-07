export interface SettingsTab {
  id: string;
  label: string;
  to: string;
  exact?: boolean;
  adminOnly?: boolean;
}

/**
 * Tabs shared by all the settings pages, listed in display order.
 * The profile tab is available to everyone while the admin tabs stay hidden
 * for non-admin users (see `visibleSettingsTabs` and `resolveSettingsRedirect`,
 * used by the settings layout page to render the tab bar and guard access).
 */
export const SettingsTabs: SettingsTab[] = [
  { id: "profile", label: "Profile", to: "/settings/profile", exact: true },
  {
    id: "maintenance",
    label: "Maintenance",
    to: "/settings/maintenance",
    adminOnly: true,
  },
  {
    id: "users",
    label: "Users",
    to: "/settings/users",
    adminOnly: true,
  },
];

export function visibleSettingsTabs(isAdmin: boolean): SettingsTab[] {
  return SettingsTabs.filter((tab) => !tab.adminOnly || isAdmin);
}

export function resolveSettingsRedirect(
  path: string,
  state: { isAuthenticated: boolean; isAdmin: boolean },
): string | null {
  const tab = SettingsTabs.find((t) => t.to === path);
  if (!tab) return null;
  if (tab.adminOnly && !(state.isAuthenticated && state.isAdmin)) {
    return "/settings/profile";
  }
  return null;
}
