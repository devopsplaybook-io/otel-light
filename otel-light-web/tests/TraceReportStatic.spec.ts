import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/TraceGroupLineChart.vue", () => ({
  default: { name: "TraceGroupLineChart", render: () => null },
}));

import { createApp, h } from "vue";
import TraceReportStatic from "../components/TraceReportStatic.vue";

const mountedApps: Array<{ app: any; container: HTMLElement }> = [];

function mountReport(props: Record<string, unknown>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onDrilldown = vi.fn();
  const app = createApp({
    render: () => h(TraceReportStatic, { ...props, onDrilldown }),
  });
  app.component("TraceGroupLineChart", { render: () => null });
  app.mount(container);  mountedApps.push({ app, container });
  return { container, onDrilldown };
}

describe("TraceReportStatic", () => {
  afterEach(() => {
    while (mountedApps.length) {
      const { app, container } = mountedApps.pop()!;
      app.unmount();
      container.remove();
    }
  });

  it("shows the pending state and no groups before the report exists", () => {
    const { container } = mountReport({
      title: "Longest Traces",
      generatedAt: null,
      series: [{ serviceName: "svc", name: "op" }],
    });
    expect(container.textContent).toContain("Generating…");
    expect(container.querySelector(".report-groups")).toBeNull();
  });

  it("lists the top groups in series order with clickable rows", () => {
    const series = [
      { serviceName: "svc", name: "GET /cart" },
      { serviceName: "svc", name: "GET /checkout" },
      { serviceName: "", name: "cron" },
    ];
    const { container, onDrilldown } = mountReport({
      title: "Longest Traces",
      generatedAt: "2026-11-18T00:00:00.000Z",
      periodDays: 30,
      topN: 30,
      bucketNs: 60_000_000_000,
      series,
    });

    const rows = Array.from(container.querySelectorAll(".report-group-row"));
    expect(rows.map((row) => row.textContent?.trim())).toEqual([
      "svc: GET /cart",
      "svc: GET /checkout",
      "cron",
    ]);

    (rows[1] as HTMLElement).click();
    expect(onDrilldown).toHaveBeenCalledWith({
      key: "svc||GET /checkout||1",
      serviceName: "svc",
      name: "GET /checkout",
      label: "svc: GET /checkout",
    });
  });

  it("explains an empty report", () => {
    const { container } = mountReport({
      title: "Longest Traces",
      generatedAt: "2026-11-18T00:00:00.000Z",
      series: [],
    });
    expect(container.textContent).toContain("No data yet");
    expect(container.querySelector(".report-groups")).toBeNull();
  });
});
