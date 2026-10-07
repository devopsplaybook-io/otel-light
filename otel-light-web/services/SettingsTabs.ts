import { AuthenticationStore } from "~~/stores/AuthenticationStore";

/**
 * Tabs shared by all the settings pages, listed in display order.
 * The `show` callbacks drive the tab-level permission filtering done by
 * TabNavigation.vue: the profile tab is available to everyone while the
 * admin tabs stay hidden for non-admin users.
 */
export const SettingsTabs = [
  { id: "profile", label: "Profile", to: "/settings/profile", exact: true },
  {
    id: "maintenance",
    label: "Maintenance",
    to: "/settings/maintenance",
    show: () => AuthenticationStore().isAdmin,
  },
  {
    id: "users",
    label: "Users",
    to: "/settings/users",
    show: () => AuthenticationStore().isAdmin,
  },
];
