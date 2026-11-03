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

function mountTraceSpan(props: Record<string, unknown>) {
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
        attributes: [],
        rawSpan: {},
      },
    ],
    ...props,
  });
  const vm = app.mount(container) as any;
  return { app, container, vm };
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

describe("TraceSpan defensive attribute and log formatting", () => {
  it("formats every OTLP AnyValue shape, including falsy values", () => {
    const { app, vm } = mountTraceSpan({});
    expect(vm.formatAttributeValue({ value: { stringValue: "abc" } })).toBe(
      "abc",
    );
    expect(vm.formatAttributeValue({ value: { intValue: 0 } })).toBe("0");
    expect(vm.formatAttributeValue({ value: { doubleValue: 1.5 } })).toBe("1.5");
    expect(vm.formatAttributeValue({ value: { boolValue: false } })).toBe(
      "false",
    );
    expect(
      vm.formatAttributeValue({ value: { arrayValue: { values: [] } } }),
    ).toBe(JSON.stringify({ values: [] }));
    expect(vm.formatAttributeValue({ value: {} })).toBe("");
    expect(vm.formatAttributeValue({})).toBe("");
    expect(vm.formatAttributeValue(null)).toBe("");
    app.unmount();
  });

  it("returns empty attribute/event lists when rawSpan lacks them", () => {
    const { app, vm } = mountTraceSpan({});
    const span = vm.sortedTraceSpans[0];
    span.rawSpan = { spanId: "span-1" };
    expect(vm.getSpanAttributes(span)).toEqual([]);
    expect(vm.getSpanEvents(span)).toEqual([]);
    app.unmount();
  });

  it("renders a span without attributes or events without throwing", async () => {
    const { app, container, vm } = mountTraceSpan({});
    const span = vm.sortedTraceSpans[0];
    span.rawSpan = { spanId: "span-1", traceId: "trace-1", focus: "x" };
    vm.spanSelected = span;
    await vm.$nextTick();
    expect(container.textContent).toContain("trace.id: trace-1");
    app.unmount();
  });

  it("formats events with missing attributes", () => {
    const { app, vm } = mountTraceSpan({});
    expect(vm.getSpanEventText({ name: "exception" })).toBe("exception\n");
    expect(
      vm.getSpanEventText({
        name: "log",
        attributes: [
          { key: "code", value: { intValue: 0 } },
          { key: "ok", value: { boolValue: false } },
        ],
      }),
    ).toBe("log\n  code: 0\n  ok: false\n");
    expect(vm.getSpanEventText(null)).toBe("\n");
    app.unmount();
  });

  it("returns empty log text when traceLogs is null", () => {
    const { app, vm } = mountTraceSpan({});
    expect(vm.getSpanLogText(vm.sortedTraceSpans[0])).toBe("");
    app.unmount();
  });

  it("formats matching logs and skips null/foreign entries", () => {
    const { app, vm } = mountTraceSpan({
      traceLogs: [
        null,
        { spanId: "other", time: 1_000_000, logText: "foreign" },
        {
          spanId: "span-1",
          time: 1_000_000_000,
          logText: "hello",
        },
        { spanId: "span-1", logText: undefined },
      ],
    });
    const text = vm.getSpanLogText(vm.sortedTraceSpans[0]);
    expect(text).toContain(new Date(1000).toISOString() + ": hello");
    expect(text).toContain("unknown time: ");
    expect(text).not.toContain("foreign");
    app.unmount();
  });
});
