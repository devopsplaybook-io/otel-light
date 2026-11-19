jest.mock("./OTelContext", () => {
  const span = {
    end: jest.fn(),
    setStatus: jest.fn(),
    addEvent: jest.fn(),
  };
  const moduleLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    OTelLogger: () => ({ createModuleLogger: () => moduleLogger }),
    OTelTracer: () => ({ startSpan: () => span }),
    OTelMeter: () => ({ createObservableGauge: jest.fn() }),
  };
});

jest.mock("./utils-std-ts/DbUtils", () => ({
  DbUtilsExecSQL: jest.fn(),
  DbUtilsQuerySQL: jest.fn(),
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

jest.mock("./SignalRollups", () => ({
  SignalRollupsEnsureInitialized: jest.fn(),
  SignalRollupsReconcile: jest.fn(),
  SignalRollupsRecordMetricNameDeletion: jest.fn(),
  SignalRollupsRecordSignalDeletion: jest.fn(),
}));

import {
  CLEANUP_RUN_STATUS_CATEGORY,
  MaintenanceApplyRetentionRules,
  MaintenanceCleanupRuleKey,
  MaintenanceRollupReconcileDue,
} from "./Maintenance";
import { DbUtilsExecSQL, DbUtilsQuerySQL } from "./utils-std-ts/DbUtils";
import { SignalRollupsRecordSignalDeletion } from "./SignalRollups";

describe("MaintenanceRollupReconcileDue (M4)", () => {
  const now = Date.parse("2026-11-03T00:00:00.000Z");

  it("is due when no previous run is recorded", () => {
    expect(MaintenanceRollupReconcileDue(null, now)).toBe(true);
  });

  it("is due when the stored timestamp is invalid", () => {
    expect(MaintenanceRollupReconcileDue("not-a-date", now)).toBe(true);
  });

  it("is not due before the 24 h interval", () => {
    const lastRun = new Date(now - 23 * 3_600_000).toISOString();
    expect(MaintenanceRollupReconcileDue(lastRun, now)).toBe(false);
  });

  it("is due at/after the 24 h interval", () => {
    const lastRun = new Date(now - 25 * 3_600_000).toISOString();
    expect(MaintenanceRollupReconcileDue(lastRun, now)).toBe(true);
  });

  it("is not due for a future timestamp (clock skew)", () => {
    const lastRun = new Date(now + 3_600_000).toISOString();
    expect(MaintenanceRollupReconcileDue(lastRun, now)).toBe(false);
  });

  it("honours a custom interval", () => {
    const lastRun = new Date(now - 2 * 3_600_000).toISOString();
    expect(MaintenanceRollupReconcileDue(lastRun, now, 1)).toBe(true);
    expect(MaintenanceRollupReconcileDue(lastRun, now, 3)).toBe(false);
  });
});

describe("MaintenanceCleanupRuleKey", () => {
  it("is stable for the same rule regardless of the period", () => {
    expect(
      MaintenanceCleanupRuleKey({ signalType: "logs", pattern: "*", periodHours: 1 }),
    ).toBe(
      MaintenanceCleanupRuleKey({ signalType: "logs", pattern: "*", periodHours: 48 }),
    );
  });

  it("differs by signal, pattern or service", () => {
    const base = { signalType: "logs", pattern: "a", serviceName: "svc" };
    expect(MaintenanceCleanupRuleKey(base)).not.toBe(
      MaintenanceCleanupRuleKey({ ...base, signalType: "traces" }),
    );
    expect(MaintenanceCleanupRuleKey(base)).not.toBe(
      MaintenanceCleanupRuleKey({ ...base, pattern: "b" }),
    );
    expect(MaintenanceCleanupRuleKey(base)).not.toBe(
      MaintenanceCleanupRuleKey({ ...base, serviceName: "other" }),
    );
  });

  it("trims the service name and normalizes missing values", () => {
    expect(MaintenanceCleanupRuleKey({ serviceName: " svc " })).toBe(
      MaintenanceCleanupRuleKey({ serviceName: "svc" }),
    );
    expect(MaintenanceCleanupRuleKey({})).toBe(
      JSON.stringify(["", "", ""]),
    );
  });
});

describe("MaintenanceApplyRetentionRules", () => {
  const execMock = DbUtilsExecSQL as jest.Mock;
  const queryMock = DbUtilsQuerySQL as jest.Mock;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const span: any = { end: jest.fn(), setStatus: jest.fn() };

  beforeEach(() => {
    execMock.mockReset();
    queryMock.mockReset();
    execMock.mockResolvedValue(undefined);
  });

  function settingsRow(deleteRules: unknown[]) {
    return [
      {
        category: "signal-cleanup-rules",
        content: JSON.stringify({ deleteRules }),
      },
    ];
  }

  function mockQueries(deleteRules: unknown[], deltaRows: unknown[] = []) {
    queryMock.mockImplementation(
      async (_span: unknown, sql: string, params: unknown[]) => {
        if (params?.[0] === "signal-cleanup-rules") {
          return settingsRow(deleteRules);
        }
        if (sql.includes("GROUP BY serviceName, serviceVersion")) {
          return deltaRows;
        }
        return [];
      },
    );
  }

  function statusWrite() {
    const call = execMock.mock.calls.find(
      ([, , params]) => params?.[0] === CLEANUP_RUN_STATUS_CATEGORY,
    );
    expect(call).toBeDefined();
    return JSON.parse(call[2][1]);
  }

  it("records a run even when no settings row exists", async () => {
    queryMock.mockResolvedValue([]);

    await MaintenanceApplyRetentionRules(span);

    const payload = statusWrite();
    expect(payload.rules).toEqual([]);
    expect(Number.isFinite(Date.parse(payload.runAt))).toBe(true);
  });

  it("reports deleted rows and skips invalid rules without a delete", async () => {
    mockQueries(
      [
        { signalType: "logs", pattern: "cleanme", periodHours: 24 },
        { signalType: "logs", pattern: "cleanme-too", periodHours: 0 },
      ],
      [{ serviceName: "svc", serviceVersion: "1.0", cnt: 2 }],
    );
    execMock.mockImplementation(async (_span: unknown, sql: string) => {
      if (sql.startsWith("DELETE FROM")) {
        return 2;
      }
      return undefined;
    });

    await MaintenanceApplyRetentionRules(span);

    const payload = statusWrite();
    expect(payload.rules).toHaveLength(2);
    expect(payload.rules[0]).toMatchObject({
      signalType: "logs",
      pattern: "cleanme",
      status: "deleted",
      deletedRows: 2,
      message: null,
    });
    expect(payload.rules[1]).toMatchObject({
      status: "skipped",
      deletedRows: 0,
      message: "periodHours must be a positive number",
    });
    const deleteCalls = execMock.mock.calls.filter(([, sql]) =>
      String(sql).startsWith("DELETE FROM"),
    );
    expect(deleteCalls).toHaveLength(1);
    expect(SignalRollupsRecordSignalDeletion).toHaveBeenCalledTimes(1);
  });

  it("skips legacy invalid shapes but keeps an empty serviceName as all services", async () => {
    mockQueries(
      [
        { signalType: "logs", pattern: "   ", periodHours: 24 },
        { signalType: "logs", pattern: "cleanme", periodHours: 24, serviceName: "  " },
        { signalType: "logs", pattern: "all-services", periodHours: 24, serviceName: "" },
      ],
      [{ serviceName: "svc", serviceVersion: "1.0", cnt: 1 }],
    );
    execMock.mockImplementation(async (_span: unknown, sql: string) => {
      if (sql.startsWith("DELETE FROM")) {
        return 1;
      }
      return undefined;
    });

    await MaintenanceApplyRetentionRules(span);

    const payload = statusWrite();
    expect(payload.rules.map((rule: any) => rule.status)).toEqual([
      "skipped",
      "skipped",
      "deleted",
    ]);
    expect(payload.rules[0].message).toBe("pattern must be a non-empty string");
    expect(payload.rules[1].message).toBe(
      "serviceName must be a non-empty string",
    );
    expect(payload.rules[2].deletedRows).toBe(1);
    const deleteCalls = execMock.mock.calls.filter(([, sql]) =>
      String(sql).startsWith("DELETE FROM"),
    );
    expect(deleteCalls).toHaveLength(1);
  });

  it("records a failing rule and still runs the next one", async () => {
    mockQueries(
      [
        { signalType: "logs", pattern: "first", periodHours: 24 },
        { signalType: "logs", pattern: "second", periodHours: 24 },
      ],
      [{ serviceName: "svc", serviceVersion: "1.0", cnt: 1 }],
    );
    let deleteCalls = 0;
    execMock.mockImplementation(async (_span: unknown, sql: string) => {
      if (sql.startsWith("DELETE FROM")) {
        deleteCalls++;
        if (deleteCalls === 1) {
          throw new Error("delete exploded");
        }
        return 1;
      }
      return undefined;
    });

    await MaintenanceApplyRetentionRules(span);

    const payload = statusWrite();
    expect(payload.rules[0]).toMatchObject({
      status: "error",
      deletedRows: 0,
      message: "delete exploded",
    });
    expect(payload.rules[1]).toMatchObject({
      status: "deleted",
      deletedRows: 1,
    });
  });
});
