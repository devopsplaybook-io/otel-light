import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~~/services/AnalyticsQueue", () => ({
  analyticsFetch: vi.fn().mockResolvedValue({ ok: false }),
}));

import { createApp, h, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import SearchOptions from "../components/SearchOptions.vue";

const mountedApps: Array<{ app: any; container: HTMLElement }> = [];

function mountOptions(query: Record<string, string>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onFilterChanged = vi.fn();
  const replace = vi.fn().mockResolvedValue(undefined);
  const page = ref<any>(null);
  const app = createApp({
    render: () =>
      h(SearchOptions, { type: "traces", onFilterChanged, ref: page }),
  });
  app.config.globalProperties.$route = { query };
  app.config.globalProperties.$router = { replace };
  const pinia = createPinia();
  app.use(pinia);
  setActivePinia(pinia);
  app.mount(container);
  mountedApps.push({ app, container });
  return { container, onFilterChanged, replace, vm: page };
}

function emittedQuery(onFilterChanged: any, call = -1) {
  const calls = onFilterChanged.mock.calls;
  const index = call < 0 ? calls.length - 1 : call;
  return new URLSearchParams(calls[index][0].queryString);
}

describe("SearchOptions name round-trip", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    while (mountedApps.length) {
      const { app, container } = mountedApps.pop()!;
      app.unmount();
      container.remove();
    }
  });

  it("reads the exact name from the URL into the query and the chip", () => {
    const { container, onFilterChanged, replace, vm } = mountOptions({
      keywords: "cart",
      name: "GET /cart",
      from: "3600",
      to: "0",
      serviceName: "svc",
    });

    expect(vm.value.name).toBe("GET /cart");
    expect(emittedQuery(onFilterChanged).get("name")).toBe("GET /cart");
    expect(emittedQuery(onFilterChanged).get("keywords")).toBe("cart");
    expect(replace.mock.calls[0][0].query.name).toBe("GET /cart");

    const chip = container.querySelector(".search-chip");
    expect(chip?.textContent).toContain("name:");
    expect(chip?.textContent).toContain("GET /cart");
  });

  it("removes the name from the filters and the URL when the chip is cleared", async () => {
    const { container, onFilterChanged, replace, vm } = mountOptions({
      name: "GET /cart",
      from: "3600",
    });

    (container.querySelector(".search-chip-clear") as HTMLElement).click();
    await vm.value.$nextTick();

    expect(vm.value.name).toBe("");
    expect(container.querySelector(".search-chip")).toBeNull();
    expect(emittedQuery(onFilterChanged).has("name")).toBe(false);
    expect(replace.mock.calls[replace.mock.calls.length - 1][0].query.name).toBe(
      undefined
    );
  });

  it("clears the drilldown name when the user edits the keywords", () => {
    vi.useFakeTimers();
    const { container, onFilterChanged, vm } = mountOptions({
      name: "GET /cart",
      from: "3600",
    });
    const before = onFilterChanged.mock.calls.length;

    const input = container.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = "checkout";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(vm.value.name).toBe("");
    vi.advanceTimersByTime(600);
    expect(onFilterChanged.mock.calls.length).toBe(before + 1);
    expect(emittedQuery(onFilterChanged).get("keywords")).toBe("checkout");
    expect(emittedQuery(onFilterChanged).has("name")).toBe(false);
  });

  it("does not render a name chip without a name", () => {
    const { container } = mountOptions({ from: "3600" });
    expect(container.querySelector(".search-chip")).toBeNull();
  });
});
