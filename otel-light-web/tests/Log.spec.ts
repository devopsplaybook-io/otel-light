import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~~/services/AnalyticsQueue", () => ({ analyticsGet: vi.fn() }));
vi.mock("~/services/Utils", () => ({ UtilsDecompressJson: vi.fn() }));

import Log from "../components/Log.vue";
import { analyticsGet } from "~~/services/AnalyticsQueue";
import { UtilsDecompressJson } from "~/services/Utils";

const mockedGet = vi.mocked(analyticsGet);
const mockedDecompress = vi.mocked(UtilsDecompressJson);

describe("Log trace lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses top-level trace/span IDs and stores the fetched trace logs", async () => {
    const trace = { traceId: "trace-1", serviceName: "svc" };
    const spans = [{ spanId: "span-1", name: "GET /" }];
    const traceLogs = [{ spanId: "span-1", logText: "inside span" }];

    mockedDecompress.mockResolvedValue([trace] as any);
    mockedGet
      .mockResolvedValueOnce({ data: { traces: "compressed-traces" } })
      .mockResolvedValueOnce({ data: { spans } })
      .mockResolvedValueOnce({ data: { logs: traceLogs } });

    const context: any = {
      // Deliberately no `attributes`: only the top-level IDs are used.
      log: {
        traceId: "trace-1",
        spanId: "span-1",
        logText: "hello",
        time: 1_000_000_000,
      },
      $refs: { logDialog: { showModal: vi.fn(), close: vi.fn() } },
      isShowDialog: false,
      trace: { stale: true },
      traceSpans: [{ stale: true }],
      traceLogs: [{ stale: true }],
      logSpanId: null,
      traceId: null,
    };

    await Log.methods.showLogDialog.call(context);

    expect(mockedGet).toHaveBeenCalledTimes(3);
    expect(mockedGet.mock.calls[0][0]).toBe(
      "/api/analytics/traces?traceId=trace-1",
    );
    expect(mockedGet.mock.calls[1][0]).toBe(
      "/api/analytics/traces/trace-1/spans",
    );
    expect(mockedGet.mock.calls[2][0]).toBe(
      "/api/analytics/traces/trace-1/logs",
    );
    expect(context.trace).toEqual(trace);
    expect(context.traceSpans).toEqual(spans);
    expect(context.logSpanId).toBe("span-1");
    expect(context.traceLogs).toEqual(traceLogs);
  });

  it("encodes a trace id with special characters in every requested URL", async () => {
    const specialId = "a&b#c/d %";
    const encodedId = "a%26b%23c%2Fd%20%25";
    const trace = { traceId: specialId, serviceName: "svc" };

    mockedDecompress.mockResolvedValue([trace] as any);
    mockedGet
      .mockResolvedValueOnce({ data: { traces: "compressed-traces" } })
      .mockResolvedValueOnce({ data: { spans: [] } })
      .mockResolvedValueOnce({ data: { logs: [] } });

    const context: any = {
      log: { traceId: specialId, spanId: null, logText: "hello", time: 1 },
      $refs: { logDialog: { showModal: vi.fn(), close: vi.fn() } },
      isShowDialog: false,
      trace: null,
      traceSpans: [],
      traceLogs: [],
      logSpanId: null,
      traceId: null,
    };

    await Log.methods.showLogDialog.call(context);

    expect(mockedGet.mock.calls[0][0]).toBe(
      `/api/analytics/traces?traceId=${encodedId}`,
    );
    expect(mockedGet.mock.calls[1][0]).toBe(
      `/api/analytics/traces/${encodedId}/spans`,
    );
    expect(mockedGet.mock.calls[2][0]).toBe(
      `/api/analytics/traces/${encodedId}/logs`,
    );
  });

  it("does not query when the log has no top-level trace ID", async () => {
    const context: any = {
      log: { traceId: null, spanId: null, logText: "hello", time: 1 },
      $refs: { logDialog: { showModal: vi.fn(), close: vi.fn() } },
      isShowDialog: false,
      trace: { stale: true },
      traceSpans: [{ stale: true }],
      traceLogs: [{ stale: true }],
      logSpanId: "stale",
      traceId: "stale",
    };

    await Log.methods.showLogDialog.call(context);

    expect(mockedGet).not.toHaveBeenCalled();
    expect(context.trace).toBeNull();
    expect(context.traceSpans).toEqual([]);
    expect(context.traceLogs).toEqual([]);
    expect(context.logSpanId).toBeNull();
  });
});
