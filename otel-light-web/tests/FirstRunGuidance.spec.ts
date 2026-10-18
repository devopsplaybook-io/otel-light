import { afterEach, describe, expect, it } from "vitest";
import { createApp, h } from "vue";
import FirstRunGuidance from "../components/FirstRunGuidance.vue";

const mountedApps: Array<{
  app: ReturnType<typeof createApp>;
  container: HTMLElement;
}> = [];

function mount(): HTMLElement {
  const app = createApp({ render: () => h(FirstRunGuidance) });
  const container = document.createElement("div");
  document.body.appendChild(container);
  app.mount(container);
  mountedApps.push({ app, container });
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

describe("FirstRunGuidance", () => {
  it("renders the three ingestion endpoints derived from the page origin", () => {
    const container = mount();
    const text = container.textContent || "";
    const origin = window.location.origin;
    expect(text).toContain(`POST ${origin}/v1/traces`);
    expect(text).toContain(`POST ${origin}/v1/metrics`);
    expect(text).toContain(`POST ${origin}/v1/logs`);
  });

  it("mentions the ingestion authorization header without rendering a token", () => {
    const container = mount();
    const text = container.textContent || "";
    expect(text).toContain("OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER");
    expect(text).toContain("Authorization: Bearer");
  });

  it("includes a copy-paste curl example with a minimal OTLP logs payload", () => {
    const container = mount();
    const code = container.querySelector(".first-run-snippet code");
    expect(code).toBeTruthy();
    const snippet = code?.textContent || "";
    expect(snippet).toContain("curl");
    expect(snippet).toContain("/v1/logs");
    expect(snippet).toContain("resourceLogs");
    expect(snippet).toContain("service.name");
    expect(snippet).toContain("logRecords");
  });
});
