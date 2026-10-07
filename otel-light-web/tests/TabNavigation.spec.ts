import { afterEach, describe, expect, it } from "vitest";
import { createApp, h } from "vue";
import { createMemoryHistory, createRouter, RouterLink } from "vue-router";
import TabNavigation from "../components/TabNavigation.vue";

const mountedApps: Array<{ app: ReturnType<typeof createApp>; container: HTMLElement }> = [];

async function mountTabs(
  tabs: Array<Record<string, unknown>>,
  initialPath: string,
): Promise<HTMLElement> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/:pathMatch(.*)*", component: { render: () => null } },
    ],
  });
  const app = createApp({ render: () => h(TabNavigation, { tabs }) });
  app.component("NuxtLink", RouterLink);
  app.use(router);
  const container = document.createElement("div");
  document.body.appendChild(container);
  await router.push(initialPath);
  await router.isReady();
  app.mount(container);
  mountedApps.push({ app, container });
  return container;
}

function tabLinks(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll(".tab-navigation .tab"));
}

function activeTabLabels(container: HTMLElement): string[] {
  return tabLinks(container)
    .filter((el) => el.classList.contains("active"))
    .map((el) => el.textContent?.trim());
}

afterEach(() => {
  while (mountedApps.length) {
    const { app, container } = mountedApps.pop() as {
      app: ReturnType<typeof createApp>;
      container: HTMLElement;
    };
    app.unmount();
    container.remove();
  }
});

describe("TabNavigation", () => {
  it("renders one link per tab, in order, with the tab label", async () => {
    const container = await mountTabs(
      [
        { id: "profile", label: "Profile", to: "/settings/profile", exact: true },
        { id: "maintenance", label: "Maintenance", to: "/settings/maintenance" },
        { id: "users", label: "Users", to: "/settings/users" },
      ],
      "/settings/profile",
    );

    const links = tabLinks(container);
    expect(links).toHaveLength(3);
    expect(links.map((el) => el.textContent?.trim())).toEqual([
      "Profile",
      "Maintenance",
      "Users",
    ]);
    expect(links[0].getAttribute("href")).toBe("/settings/profile");
    expect(activeTabLabels(container)).toEqual(["Profile"]);
  });

  it("marks the current tab as active and honors exact matching", async () => {
    const container = await mountTabs(
      [
        { id: "list", label: "Traces", to: "/traces", exact: true },
        { id: "longest", label: "Longest", to: "/traces/stats/longest" },
        { id: "aggregated", label: "Aggregated", to: "/traces/stats/aggregated" },
      ],
      "/traces/stats/longest",
    );

    // `exact: true` prevents the list tab from matching the stats sub-route.
    expect(activeTabLabels(container)).toEqual(["Longest"]);
  });

  it("activates a non-exact tab for its sub-routes", async () => {
    const container = await mountTabs(
      [
        { id: "list", label: "Traces", to: "/traces", exact: true },
        { id: "stats", label: "Stats", to: "/traces/stats" },
      ],
      "/traces/stats/aggregated",
    );

    expect(activeTabLabels(container)).toEqual(["Stats"]);
  });

  it("renders the tabs it receives verbatim, without filtering", async () => {
    // The tab visibility/permission filtering is owned by the callers
    // (e.g. visibleSettingsTabs): the component must stay purely
    // presentational, so `show` flags must not hide anything here.
    const container = await mountTabs(
      [
        { id: "always", label: "Always", to: "/a" },
        { id: "hidden", label: "Hidden", to: "/b", show: false },
      ],
      "/a",
    );

    const links = tabLinks(container);
    expect(links).toHaveLength(2);
    expect(links.map((el) => el.textContent?.trim())).toEqual([
      "Always",
      "Hidden",
    ]);
  });
});
