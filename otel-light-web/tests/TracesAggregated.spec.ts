import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~~/services/AnalyticsQueue", () => ({ analyticsGet: vi.fn() }));
vi.mock("~/components/SearchOptions.vue", () => ({
  default: { name: "SearchOptions", render: () => null },
}));

import { createApp } from "vue";
import AggregatedPage from "../pages/traces/stats/aggregated.vue";
import { analyticsGet } from "~~/services/AnalyticsQueue";
import {
  TRACES_AGGREGATED_DEFAULT_SORT,
  TracesAggregatedSort,
} from "../services/TracesAggregated";

const mockedGet = vi.mocked(analyticsGet);

const groups = [
  { serviceName: "svc", serviceVersion: "1.0.0", name: "op-a", traceCount: 5, nbErrors: 1, avgDuration: 1000, p90: 4000, p95: 5000 },
  { serviceName: "svc", serviceVersion: "1.0.0", name: "op-b", traceCount: 9, nbErrors: 0, avgDuration: 500, p90: 2000, p95: 3000 },
  { serviceName: "svc", serviceVersion: "1.0.0", name: "op-c", traceCount: 2, nbErrors: 2, avgDuration: null, p90: null, p95: null },
];

describe("TracesAggregatedSort", () => {
  it("defaults to traceCount descending", () => {
    expect(TRACES_AGGREGATED_DEFAULT_SORT).toEqual({
      key: "traceCount",
      dir: "desc",
    });
    expect(
      TracesAggregatedSort(groups, "traceCount", "desc").map((g) => g.name)
    ).toEqual(["op-b", "op-a", "op-c"]);
  });

  it("sorts ascending and descending on a numeric key", () => {
    expect(TracesAggregatedSort(groups, "p90", "asc").map((g) => g.name)).toEqual([
      "op-b",
      "op-a",
      "op-c",
    ]);
    expect(TracesAggregatedSort(groups, "p90", "desc").map((g) => g.name)).toEqual([
      "op-a",
      "op-b",
      "op-c",
    ]);
  });

  it("always puts missing values last, whatever the direction", () => {
    expect(TracesAggregatedSort(groups, "avgDuration", "asc")[2].name).toBe(
      "op-c"
    );
    expect(TracesAggregatedSort(groups, "avgDuration", "desc")[2].name).toBe(
      "op-c"
    );
  });

  it("breaks value ties on the service/version/name identity", () => {
    const tied = [
      { serviceName: "b", serviceVersion: "", name: "x", traceCount: 1 },
      { serviceName: "a", serviceVersion: "", name: "z", traceCount: 1 },
      { serviceName: "a", serviceVersion: "", name: "y", traceCount: 1 },
    ];
    expect(
      TracesAggregatedSort(tied, "traceCount", "desc").map((g) => g.name)
    ).toEqual(["y", "z", "x"]);
  });

  it("does not mutate its input and tolerates a missing list", () => {
    const input = [...groups];
    TracesAggregatedSort(input, "traceCount", "asc");
    expect(input).toEqual(groups);
    expect(TracesAggregatedSort(undefined as any, "traceCount", "desc")).toEqual(
      []
    );
  });
});

const mountedApps: Array<{ app: any; container: HTMLElement }> = [];

function mountPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp(AggregatedPage);
  const empty = { render: () => null };
  app.component("TabNavigation", empty);
  app.component("LazyTrace", empty);
  app.component("LazyTraceSpan", empty);
  const push = vi.fn();
  app.config.globalProperties.$router = { push };
  app.config.globalProperties.$route = {
    query: { keywords: "cart", from: "3600", to: "0" },
  };
  const vm = app.mount(container) as any;
  mountedApps.push({ app, container });
  return { container, vm, push };
}

function summaryResponse(serverGroups: any[]) {
  return { data: { compressed: false, groups: serverGroups } };
}

function rowTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".trace-group-summary"))
    .filter((el) => !el.classList.contains("trace-group-header"))
    .map((el) => el.textContent);
}

describe("Aggregated traces page", () => {
  const authStore = {
    ensureAuthenticated: vi.fn().mockResolvedValue(true),
    hasLogsScope: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    (globalThis as any).AuthenticationStore = () => authStore;
    (globalThis as any).useRouter = () => ({ push: vi.fn() });
  });

  afterEach(() => {
    while (mountedApps.length) {
      const { app, container } = mountedApps.pop()!;
      app.unmount();
      container.remove();
    }
    vi.restoreAllMocks();
  });

  it("calls the summary endpoint with a bounded timeout", async () => {
    mockedGet.mockResolvedValue(summaryResponse([]));
    mountPage();
    await vi.waitFor(() => expect(mockedGet).toHaveBeenCalled());
    const [url, options] = mockedGet.mock.calls[0];
    expect(String(url)).toContain("/analytics/traces/summary");
    expect(options).toMatchObject({ timeout: 20000 });
  });

  it("renders a skeleton while loading, then the rows sorted by traces", async () => {
    mockedGet.mockResolvedValue(summaryResponse(groups));
    const { container, vm } = mountPage();
    expect(container.querySelector(".aggregated-loading")).not.toBeNull();
    expect(
      container.querySelector(".aggregated-loading")?.getAttribute("aria-busy")
    ).toBe("true");

    await vi.waitFor(() => expect(rowTexts(container)).toHaveLength(3));
    expect(vm.loading).toBe(false);
    const texts = rowTexts(container);
    expect(texts[0]).toContain("op-b");
    expect(texts[1]).toContain("op-a");
    expect(texts[2]).toContain("op-c");
  });

  it("shows an explicit error with a retry that refetches", async () => {
    mockedGet
      .mockRejectedValueOnce(new Error("backend unavailable"))
      .mockResolvedValueOnce(summaryResponse(groups));
    const { container } = mountPage();

    await vi.waitFor(() => {
      expect(container.querySelector(".aggregated-error")).not.toBeNull();
    });
    const banner = container.querySelector(".aggregated-error")!;
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.textContent).toContain("backend unavailable");
    expect(rowTexts(container)).toHaveLength(0);

    const retry = Array.from(banner.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Retry")
    )!;
    retry.click();
    await vi.waitFor(() => expect(rowTexts(container)).toHaveLength(3));
    expect(container.querySelector(".aggregated-error")).toBeNull();
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("sorts through the column headers and exposes aria-sort", async () => {
    mockedGet.mockResolvedValue(summaryResponse(groups));
    const { container } = mountPage();
    await vi.waitFor(() => expect(rowTexts(container)).toHaveLength(3));

    const p90Header = Array.from(
      container.querySelectorAll('b[role="columnheader"]')
    ).find((el) => el.textContent?.includes("P90"))!;
    expect(p90Header.getAttribute("aria-sort")).toBe("none");
    const button = p90Header.querySelector("button")!;

    button.click();
    await vi.waitFor(() =>
      expect(p90Header.getAttribute("aria-sort")).toBe("descending")
    );
    expect(rowTexts(container)[0]).toContain("op-a");
    expect(rowTexts(container)[2]).toContain("op-c");

    button.click();
    await vi.waitFor(() =>
      expect(p90Header.getAttribute("aria-sort")).toBe("ascending")
    );
    expect(rowTexts(container)[0]).toContain("op-b");
    expect(rowTexts(container)[2]).toContain("op-c");
  });

  it("opens the errors of a group with errorsOnly=true", async () => {
    mockedGet.mockResolvedValue(summaryResponse(groups));
    const { container, push } = mountPage();
    await vi.waitFor(() => expect(rowTexts(container)).toHaveLength(3));

    const badge = container.querySelector(".error-badge") as HTMLElement;
    expect(badge).not.toBeNull();
    badge.click();

    expect(push).toHaveBeenCalledWith({
      path: "/traces",
      query: {
        keywords: "cart",
        from: "3600",
        to: "0",
        serviceName: "svc",
        serviceVersion: "1.0.0",
        name: "op-a",
        errorsOnly: "true",
      },
    });
  });
});
