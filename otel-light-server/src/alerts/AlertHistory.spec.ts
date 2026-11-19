jest.mock("../OTelContext", () => {
  const span = {
    end: jest.fn(),
    setStatus: jest.fn(),
    addEvent: jest.fn(),
    setAttribute: jest.fn(),
    setAttributes: jest.fn(),
  };
  const moduleLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const tracer = { startSpan: () => span };
  const logger = {
    createModuleLogger: () => moduleLogger,
    initOTel: jest.fn(),
  };
  return {
    OTelTracer: () => tracer,
    OTelLogger: () => logger,
    OTelMeter: () => undefined,
    OTelSetTracer: jest.fn(),
    OTelSetMeter: jest.fn(),
    OTelRequestSpan: () => span,
  };
});

jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsQuerySQL: jest.fn(),
  DbUtilsExecSQL: jest.fn(),
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

import { DbUtilsExecSQL, DbUtilsQuerySQL } from "../utils-std-ts/DbUtils";
import {
  AlertHistoryClampLimit,
  AlertHistoryInsert,
  AlertHistoryList,
  AlertHistoryPrune,
} from "./AlertHistory";

const queryMock = DbUtilsQuerySQL as jest.Mock;
const execMock = DbUtilsExecSQL as jest.Mock;

const eventRow = (overrides: Record<string, unknown> = {}) => ({
  id: "e1",
  ruleId: "r1",
  ruleName: "svc-a: ERROR+FATAL logs > 10",
  ruleType: "log-count",
  serviceName: "svc-a",
  status: "fired",
  severity: "warning",
  observedValue: 12,
  thresholdValue: 10,
  message: "12 ERROR+FATAL logs",
  signalType: "logs",
  signalPath: "/logs",
  signalQuery: "from=3600&serviceName=svc-a",
  eventTime: "2026-11-19T10:00:00.000Z",
  notifiedAt: null,
  error: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  execMock.mockResolvedValue(1);
});

describe("AlertHistoryInsert", () => {
  it("inserts all event fields", async () => {
    await AlertHistoryInsert({
      ruleId: "r1",
      ruleName: "label",
      ruleType: "log-count",
      serviceName: "svc-a",
      status: "fired",
      severity: "warning",
      observedValue: 12,
      thresholdValue: 10,
      message: "message",
      signalType: "logs",
      signalPath: "/logs",
      signalQuery: "from=3600",
      eventTime: "2026-11-19T10:00:00.000Z",
      notifiedAt: "2026-11-19T10:00:01.000Z",
      error: null,
    });

    expect(execMock).toHaveBeenCalledTimes(1);
    const [sql, params] = execMock.mock.calls[0].slice(1);
    expect(sql).toContain("INTO alert_events");
    expect(params).toHaveLength(16);
    expect(params[0]).toBeTruthy();
    expect(params.slice(1, 7)).toEqual([
      "r1",
      "label",
      "log-count",
      "svc-a",
      "fired",
      "warning",
    ]);
    expect(params[7]).toBe(12);
    expect(params[8]).toBe(10);
    expect(params[13]).toBe("2026-11-19T10:00:00.000Z");
  });

  it("never throws when persistence fails", async () => {
    execMock.mockRejectedValue(new Error("db down"));
    await expect(
      AlertHistoryInsert({
        ruleId: "r1",
        ruleName: "label",
        ruleType: "log-count",
        serviceName: "",
        status: "error",
        severity: "warning",
        message: "message",
        signalType: "logs",
        signalPath: "/logs",
        signalQuery: "",
        eventTime: "2026-11-19T10:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("AlertHistoryList", () => {
  it("maps rows and applies every filter", async () => {
    queryMock.mockResolvedValue([eventRow()]);

    const page = await AlertHistoryList({
      ruleId: "r1",
      serviceName: "svc-a",
      status: "fired",
      from: "2026-11-19T00:00:00.000Z",
      to: "2026-11-20T00:00:00.000Z",
      limit: 10,
      offset: 20,
    });

    expect(page.hasMore).toBe(false);
    expect(page.events).toEqual([
      {
        ...eventRow(),
        observedValue: 12,
        thresholdValue: 10,
        notifiedAt: null,
        error: null,
      },
    ]);
    const [sql, params] = queryMock.mock.calls[0].slice(1);
    expect(sql).toContain("WHERE");
    expect(sql).toContain("ruleId = ?");
    expect(sql).toContain("serviceName = ?");
    expect(sql).toContain("status = ?");
    expect(sql).toContain("eventTime >= ?");
    expect(sql).toContain("eventTime <= ?");
    expect(sql).toContain("ORDER BY eventTime DESC, id DESC");
    expect(sql).toContain("LIMIT ? OFFSET ?");
    expect(params).toEqual([
      "r1",
      "svc-a",
      "fired",
      "2026-11-19T00:00:00.000Z",
      "2026-11-20T00:00:00.000Z",
      11,
      20,
    ]);
  });

  it("reports hasMore and truncates to the limit", async () => {
    queryMock.mockResolvedValue([eventRow({ id: "e1" }), eventRow({ id: "e2" })]);

    const page = await AlertHistoryList({ limit: 1 });

    expect(page.events).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    const [sql] = queryMock.mock.calls[0].slice(1);
    expect(sql).not.toContain("WHERE");
  });

  it("clamps the limit", () => {
    expect(AlertHistoryClampLimit(0)).toBe(1);
    expect(AlertHistoryClampLimit(9999)).toBe(500);
    expect(AlertHistoryClampLimit("abc")).toBe(100);
    expect(AlertHistoryClampLimit(25.7)).toBe(25);
  });
});

describe("AlertHistoryPrune", () => {
  it("deletes older events", async () => {
    await AlertHistoryPrune("2026-08-21T00:00:00.000Z");
    expect(execMock).toHaveBeenCalledTimes(1);
    const [sql, params] = execMock.mock.calls[0].slice(1);
    expect(sql).toContain("DELETE FROM alert_events");
    expect(params).toEqual(["2026-08-21T00:00:00.000Z"]);
  });
});
