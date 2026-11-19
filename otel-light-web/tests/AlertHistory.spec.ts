import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick } from "vue";
import AlertHistoryTable from "../components/AlertHistoryTable.vue";
import {
  alertEventStatusLabel,
  alertEventValueText,
  alertHistoryEventTime,
  alertHistoryLinkTarget,
  type AlertHistoryEvent,
} from "../services/AlertHistory";

const event = (overrides: Partial<AlertHistoryEvent> = {}): AlertHistoryEvent => ({
  id: "e1",
  ruleId: "rule-1",
  ruleName: "CPU usage",
  ruleType: "metric-threshold",
  serviceName: "svc-a",
  status: "fired",
  severity: "warning",
  observedValue: 91.5,
  thresholdValue: 90,
  message: "avg of cpu.usage is 91.5",
  signalType: "metrics",
  signalPath: "/metrics",
  signalQuery: "from=3600&serviceName=svc-a&keywords=cpu.usage",
  eventTime: "2026-11-19T10:00:00.000Z",
  notifiedAt: null,
  error: null,
  ...overrides,
});

const mountedApps: Array<{ app: ReturnType<typeof createApp>; container: HTMLElement }> = [];

async function mountTable(props: Record<string, unknown>): Promise<HTMLElement> {
  const app = createApp({ render: () => h(AlertHistoryTable, props) });
  app.component("NuxtLink", {
    props: { to: { type: String, required: true } },
    setup(linkProps, { slots }) {
      return () => h("a", { href: linkProps.to }, slots.default?.());
    },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  app.mount(container);
  mountedApps.push({ app, container });
  await nextTick();
  return container;
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

describe("alert history helpers", () => {
  it("labels every event status", () => {
    expect(alertEventStatusLabel("fired")).toBe("Fired");
    expect(alertEventStatusLabel("notified")).toBe("Notified");
    expect(alertEventStatusLabel("resolved")).toBe("Resolved");
    expect(alertEventStatusLabel("suppressed")).toBe("Suppressed");
    expect(alertEventStatusLabel("error")).toBe("Error");
    expect(alertEventStatusLabel("unknown")).toBe("unknown");
  });

  it("formats the observed value against the threshold", () => {
    expect(alertEventValueText(event())).toBe("91.5 / threshold 90");
    expect(alertEventValueText(event({ thresholdValue: null }))).toBe("91.5");
    expect(alertEventValueText(event({ observedValue: null }))).toBe("—");
  });

  it("builds the signal link from the server-provided query", () => {
    expect(alertHistoryLinkTarget(event())).toBe(
      "/metrics?from=3600&serviceName=svc-a&keywords=cpu.usage",
    );
    expect(
      alertHistoryLinkTarget(
        event({ signalPath: "/traces", signalQuery: "from=86400&errorsOnly=true" }),
      ),
    ).toBe("/traces?from=86400&errorsOnly=true");
    expect(
      alertHistoryLinkTarget(event({ signalPath: "", signalType: "logs", signalQuery: "" })),
    ).toBe("/logs");
  });

  it("falls back to the raw event time when it cannot be parsed", () => {
    expect(alertHistoryEventTime(event({ eventTime: "not-a-date" }))).toBe(
      "not-a-date",
    );
  });
});

describe("AlertHistoryTable", () => {
  it("renders one row per event with status, details and a signal link", async () => {
    const container = await mountTable({
      events: [
        event(),
        event({
          id: "e2",
          ruleId: "rule-2",
          ruleName: "Heartbeat",
          status: "suppressed",
          serviceName: "",
          message: "No logs received",
        }),
        event({ id: "e3", ruleId: "rule-3", status: "error", error: "notifications disabled" }),
      ],
      hasMore: false,
    });

    const rows = container.querySelectorAll(".alert-history-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Fired");
    expect(rows[0].textContent).toContain("CPU usage");
    expect(rows[0].textContent).toContain("svc-a");
    expect(rows[1].textContent).toContain("Suppressed");
    expect(rows[1].textContent).toContain("All services");
    expect(rows[2].textContent).toContain("notifications disabled");

    const link = rows[0].querySelector(".alert-history-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "/metrics?from=3600&serviceName=svc-a&keywords=cpu.usage",
    );
    expect(container.querySelector(".alert-history-load-more")).toBeNull();
  });

  it("shows an empty state without events", async () => {
    const container = await mountTable({ events: [], hasMore: false });
    expect(container.querySelector(".alert-history-empty")?.textContent).toContain(
      "No alert events",
    );
  });

  it("emits loadMore from the load more button", async () => {
    let loads = 0;
    const container = await mountTable({
      events: [event()],
      hasMore: true,
      onLoadMore: () => {
        loads += 1;
      },
    });

    (container.querySelector(".alert-history-load-more") as HTMLButtonElement).click();
    await nextTick();
    expect(loads).toBe(1);
  });
});
