import { createApp } from "vue";
import { describe, expect, it } from "vitest";
import TraceSpan from "../components/TraceSpan.vue";

function renderSpanWithStatus(code: number): boolean {
  const container = document.createElement("div");
  const app = createApp(TraceSpan, {
    trace: { serviceName: "svc", serviceVersion: "1.0.0" },
    traceSpans: [
      {
        spanId: "span-1",
        parentSpanId: null,
        name: "GET /",
        serviceName: "svc",
        serviceVersion: "1.0.0",
        startTime: 1_000,
        endTime: 2_000,
        statusCode: code,
        attributes: [],
        rawSpan: { status: { code } },
      },
    ],
  });
  app.mount(container);
  const spanBar = container.querySelector(".span-bar-container");
  const isError = spanBar?.classList.contains("span-error") ?? false;
  app.unmount();
  return isError;
}

describe("TraceSpan status rendering", () => {
  it("does not style UNSET (0) spans as errors", () => {
    expect(renderSpanWithStatus(0)).toBe(false);
  });

  it("does not style OK (1) spans as errors", () => {
    expect(renderSpanWithStatus(1)).toBe(false);
  });

  it("styles ERROR (2) spans as errors", () => {
    expect(renderSpanWithStatus(2)).toBe(true);
  });
});
