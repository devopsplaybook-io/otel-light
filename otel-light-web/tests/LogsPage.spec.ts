import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~~/services/AnalyticsQueue", () => ({ analyticsGet: vi.fn() }));
vi.mock("~/components/SearchOptions.vue", () => ({
  default: { name: "SearchOptions", render: () => null },
}));
vi.mock("~/components/Loading.vue", () => ({
  default: { name: "Loading", render: () => null },
}));
vi.mock("~/components/FirstRunGuidance.vue", () => ({
  default: { name: "FirstRunGuidance", render: () => null },
}));
vi.mock("~~/services/Clipboard", () => ({
  ClipboardWriteText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~~/services/EventBus", () => ({
  handleError: vi.fn(),
  EventBus: { emit: vi.fn() },
  EventTypes: { ALERT_MESSAGE: "alert-message" },
}));

import { createApp } from "vue";
import LogsPage from "../pages/logs/index.vue";
import { ClipboardWriteText } from "~~/services/Clipboard";
import { EventBus } from "~~/services/EventBus";

const mountedApps: Array<{ app: any; container: HTMLElement }> = [];

function mountPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp(LogsPage);
  const empty = { render: () => null };
  app.component("LazyLog", empty);
  const vm = app.mount(container) as any;
  mountedApps.push({ app, container });
  return vm;
}

describe("Logs page copy link action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).AuthenticationStore = () => ({
      ensureAuthenticated: vi.fn().mockResolvedValue(true),
    });
    (globalThis as any).useRouter = () => ({ push: vi.fn() });
    (globalThis as any).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    window.history.replaceState({}, "", "/logs?keywords=error");
  });

  afterEach(() => {
    while (mountedApps.length) {
      const { app, container } = mountedApps.pop()!;
      app.unmount();
      container.remove();
    }
    vi.restoreAllMocks();
  });

  it("copies the current filtered URL and reports it", async () => {
    const vm = mountPage();

    await vm.copyFilterLink();

    expect(ClipboardWriteText).toHaveBeenCalledWith(window.location.href);
    expect(EventBus.emit).toHaveBeenCalledWith("alert-message", {
      type: "info",
      text: "Link copied",
    });
    expect(vm.copiedLink).toBe(true);
  });
});
