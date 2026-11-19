import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, ref, type Ref } from "vue";
import AlertRuleEditor from "../components/AlertRuleEditor.vue";
import { newAlertRuleForm } from "../services/AlertRules";

const mountedApps: Array<{ app: ReturnType<typeof createApp>; container: HTMLElement }> = [];

let currentRule: Ref<Record<string, unknown>>;

async function mountEditor(props: Record<string, unknown>): Promise<HTMLElement> {
  currentRule = ref(props.rule as Record<string, unknown>);
  const app = createApp({
    render: () =>
      h(AlertRuleEditor, {
        ...props,
        rule: currentRule.value,
        "onUpdate:rule": (value: Record<string, unknown>) => {
          currentRule.value = value;
        },
      }),
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

const rule = (overrides: Record<string, unknown> = {}) => ({
  ...newAlertRuleForm("log-count"),
  id: "rule-1",
  ...overrides,
});

const inputEvent = (element: Element, value: string) => {
  (element as HTMLInputElement).value = value;
  element.dispatchEvent(new Event("input"));
};

describe("AlertRuleEditor", () => {
  it("renders the common fields and the log-count fields", async () => {
    const container = await mountEditor({
      rule: rule(),
      services: ["svc-a", "svc-b"],
      issues: [],
      outcome: { at: "2026-11-19T10:00:00.000Z", value: 12, threshold: 10, breached: true, notified: true },
    });

    expect(
      (container.querySelector(".alert-rule-type") as HTMLSelectElement).value,
    ).toBe("log-count");
    expect(
      (container.querySelector(".alert-rule-service") as HTMLSelectElement).value,
    ).toBe("");
    expect(container.querySelectorAll(".alert-rule-service option")).toHaveLength(3);
    expect(container.querySelector(".alert-rule-threshold")).not.toBeNull();
    expect(container.querySelectorAll(".alert-rule-severities input")).toHaveLength(6);
    expect(container.querySelector(".alert-rule-outcome")?.textContent).toContain(
      "alert sent",
    );
  });

  it("emits update:rule snapshots when the user edits the rule", async () => {
    const container = await mountEditor({ rule: rule(), services: [] });

    inputEvent(container.querySelector(".alert-rule-threshold") as Element, "3");
    inputEvent(container.querySelector(".alert-rule-description") as Element, "cpu");
    const errorSeverity = Array.from(
      container.querySelectorAll<HTMLInputElement>(".alert-rule-severities input"),
    ).find((input) => input.value === "ERROR") as HTMLInputElement;
    errorSeverity.checked = false;
    errorSeverity.dispatchEvent(new Event("change"));
    await nextTick();

    expect(currentRule.value.threshold).toBe(3);
    expect(currentRule.value.description).toBe("cpu");
    expect(currentRule.value.severities).toEqual(["FATAL"]);
  });

  it("shows the metric fields for metric-threshold rules", async () => {
    const container = await mountEditor({
      rule: rule({ type: "metric-threshold", metricName: "cpu.usage" }),
      services: [],
    });

    expect(
      (container.querySelector(".alert-rule-metric-name") as HTMLInputElement).value,
    ).toBe("cpu.usage");
    expect(container.querySelector(".alert-rule-aggregation")).not.toBeNull();
    expect(container.querySelector(".alert-rule-comparison")).not.toBeNull();
    expect(container.querySelector(".alert-rule-severities")).toBeNull();

    const aggregation = container.querySelector(
      ".alert-rule-aggregation",
    ) as HTMLSelectElement;
    aggregation.value = "max";
    aggregation.dispatchEvent(new Event("change"));
    await nextTick();
    expect(currentRule.value.aggregation).toBe("max");
  });

  it("shows trace and heartbeat fields and renders validation issues", async () => {
    const traceContainer = await mountEditor({
      rule: rule({ type: "trace-errors" }),
      services: [],
      issues: ["threshold must be between 0 and 100 for error-rate rules"],
    });
    expect(traceContainer.querySelector(".alert-rule-mode")).not.toBeNull();
    expect(
      traceContainer.querySelector(".alert-rule-invalid")?.textContent,
    ).toContain("threshold must be between 0 and 100");

    const container = await mountEditor({
      rule: rule({ type: "heartbeat", serviceName: "", signalType: "metrics" }),
      services: [],
    });
    expect(container.querySelector(".alert-rule-signal-type")).not.toBeNull();
    expect(container.querySelector(".alert-rule-metric-name")).not.toBeNull();

    currentRule.value = { ...currentRule.value, signalType: "logs" };
    await nextTick();
    expect(container.querySelector(".alert-rule-metric-name")).toBeNull();
  });

  it("emits remove from the delete button", async () => {
    let removed = 0;
    const container = await mountEditor({
      rule: rule(),
      services: [],
      onRemove: () => {
        removed += 1;
      },
    });

    (container.querySelector(".alert-rule-button") as HTMLButtonElement).click();
    await nextTick();
    expect(removed).toBe(1);
  });
});
