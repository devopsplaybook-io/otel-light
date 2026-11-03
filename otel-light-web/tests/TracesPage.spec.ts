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

import { createApp } from "vue";
import TracesPage from "../pages/traces/index.vue";
import { analyticsGet } from "~~/services/AnalyticsQueue";

const mockedGet = vi.mocked(analyticsGet);

const mountedApps: Array<{ app: any; container: HTMLElement }> = [];

function mountPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp(TracesPage);
  const empty = { render: () => null };
  app.component("TabNavigation", empty);
  app.component("LazyTrace", empty);
  app.component("LazyTraceSpan", empty);
  const vm = app.mount(container) as any;
  mountedApps.push({ app, container });
  return { app, container, vm };
}

describe("Traces page detail loading", () => {
  const authStore = {
    ensureAuthenticated: vi.fn().mockResolvedValue(true),
    hasLogsScope: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    (globalThis as any).AuthenticationStore = () => authStore;
    (globalThis as any).useRouter = () => ({ push: vi.fn() });
    (globalThis as any).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    while (mountedApps.length) {
      const { app, container } = mountedApps.pop()!;
      app.unmount();
      container.remove();
    }
    vi.restoreAllMocks();
  });

  it("shows a readable error state instead of throwing on a failed fetch", async () => {
    mockedGet.mockRejectedValue(new Error("backend unavailable"));
    const { container, vm } = mountPage();
    vm.traces = [
      {
        traceId: "trace-1",
        name: "GET /",
        serviceName: "svc",
        startTime: 1,
        endTime: 2,
        spanCount: 1,
        nbErrors: 0,
      },
    ];

    await vm.toggleTrace("trace-1");
    await vm.$nextTick();

    expect(vm.traceErrors["trace-1"]).toBe("backend unavailable");
    expect(vm.traceSpans["trace-1"]).toBeUndefined();
    expect(vm.traceLogs["trace-1"]).toBeUndefined();
    expect(container.textContent).toContain(
      "Could not load trace details: backend unavailable",
    );
  });

  it("reports a malformed spans response as an error state", async () => {
    mockedGet.mockResolvedValue({ data: {} });
    const { vm } = mountPage();
    vm.traces = [
      {
        traceId: "trace-2",
        name: "GET /",
        serviceName: "svc",
        startTime: 1,
        endTime: 2,
        spanCount: 1,
        nbErrors: 0,
      },
    ];

    await vm.toggleTrace("trace-2");

    expect(vm.traceErrors["trace-2"]).toBe("Malformed spans response");
  });

  it("clears the error on collapse and stores results on a successful retry", async () => {
    const spans = [{ spanId: "span-1", name: "GET /" }];
    const logs = [{ spanId: "span-1", logText: "hello" }];
    const { vm } = mountPage();
    vm.traceErrors["trace-3"] = "old error";
    mockedGet
      .mockResolvedValueOnce({ data: { spans } })
      .mockResolvedValueOnce({ data: { logs } });

    await vm.toggleTrace("trace-3");

    expect(vm.traceErrors["trace-3"]).toBeUndefined();
    expect(vm.traceSpans["trace-3"]).toEqual(spans);
    expect(vm.traceLogs["trace-3"]).toEqual(logs);

    await vm.toggleTrace("trace-3");
    expect(vm.traceSpans["trace-3"]).toBeUndefined();
    expect(vm.traceLogs["trace-3"]).toBeUndefined();
  });
});
