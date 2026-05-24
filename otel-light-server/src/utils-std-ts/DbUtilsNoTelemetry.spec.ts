import { DbUtilsNoTelemetryBatchInsert, DbUtilsNoTelemetryExecSQL } from "./DbUtilsNoTelemetry";

// Store mock function references created inside the jest.mock factory so tests can control them.
const mockDbHandle = { run: jest.fn(), query: jest.fn(), all: jest.fn() };

jest.mock("./DbUtils", () => {
  let dbType: "sqlite" | "postgres" = "sqlite";

  // Each test file re-imports, so we keep one mutable object
  const handle = { run: jest.fn(), query: jest.fn(), all: jest.fn() };

  return {
    DbUtilsInitGetDatabase: jest.fn(() => handle),
    DbUtilsGetType: jest.fn(() => dbType),
    convertToPostgresPlaceholders: jest.fn((sql: string) => {
      let idx = 1;
      return sql.replace(/\?/g, () => `$${idx++}`);
    }),
    __setDbType: (t: "sqlite" | "postgres") => {
      dbType = t;
    },
    __mockHandle: handle,
  };
});

const { __setDbType: setDbType, __mockHandle: mockHandle } =
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("./DbUtils");

// Sync handle reference for convenience
Object.assign(mockDbHandle, mockHandle);

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// DbUtilsNoTelemetryBatchInsert
// ---------------------------------------------------------------------------
describe("DbUtilsNoTelemetryBatchInsert", () => {
  it("returns 0 for empty rows", async () => {
    const result = await DbUtilsNoTelemetryBatchInsert("INTO t (c)", 1, []);
    expect(result).toBe(0);
  });

  it("generates correct multi-row VALUES SQL and flat params (sqlite)", async () => {
    setDbType("sqlite");
    mockDbHandle.run.mockImplementation((_sql, _params, cb) => {
      cb.call({ changes: 2 }, null);
    });

    const rows = [
      ["a1", "b1"],
      ["a2", "b2"],
    ];
    await DbUtilsNoTelemetryBatchInsert("INTO t (c1,c2)", 2, rows);

    const sqlArg = mockDbHandle.run.mock.calls[0][0];
    expect(sqlArg).toContain("(?,?),(?,?)");
    const paramsArg = mockDbHandle.run.mock.calls[0][1];
    expect(paramsArg).toEqual(["a1", "b1", "a2", "b2"]);
  });

  it("generates correct postgres-style placeholders", async () => {
    setDbType("postgres");
    mockDbHandle.query.mockImplementation((_sql, _params, cb) => {
      expect(_sql).toContain("($1,$2,$3),($4,$5,$6)");
      cb(null, { rowCount: 2 });
    });

    const rows = [
      ["x", "y", "z"],
      ["p", "q", "r"],
    ];
    const result = await DbUtilsNoTelemetryBatchInsert("INTO t (a,b,c)", 3, rows);
    expect(result).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// DbUtilsNoTelemetryExecSQL – sqlite
// ---------------------------------------------------------------------------
describe("DbUtilsNoTelemetryExecSQL (sqlite)", () => {
  beforeEach(() => setDbType("sqlite"));

  it("resolves with changes count on success", async () => {
    mockDbHandle.run.mockImplementation((_sql, _params, cb) => {
      cb.call({ changes: 3 }, null);
    });

    const result = await DbUtilsNoTelemetryExecSQL(
      "INSERT INTO t (c) VALUES (?)",
      ["x"],
    );
    expect(result).toBe(3);
  });

  it("rejects on error", async () => {
    mockDbHandle.run.mockImplementation((_sql, _params, cb) => {
      cb(new Error("constraint violation"));
    });

    await expect(
      DbUtilsNoTelemetryExecSQL("INSERT INTO t (c) VALUES (?)", ["x"]),
    ).rejects.toThrow("constraint violation");
  });
});

// ---------------------------------------------------------------------------
// DbUtilsNoTelemetryExecSQL – postgres
// ---------------------------------------------------------------------------
describe("DbUtilsNoTelemetryExecSQL (postgres)", () => {
  beforeEach(() => setDbType("postgres"));

  it("resolves with rowCount on success", async () => {
    mockDbHandle.query.mockImplementation((_sql, _params, cb) => {
      cb(null, { rowCount: 5 });
    });

    const result = await DbUtilsNoTelemetryExecSQL(
      "INSERT INTO t (c) VALUES (?)",
      ["x"],
    );
    expect(result).toBe(5);
  });

  it("rejects on error", async () => {
    mockDbHandle.query.mockImplementation((_sql, _params, cb) => {
      cb(new Error("deadlock detected"));
    });

    await expect(
      DbUtilsNoTelemetryExecSQL("INSERT INTO t (c) VALUES (?)", ["x"]),
    ).rejects.toThrow("deadlock detected");
  });

  it("converts ? placeholders to $1,$2,...", async () => {
    mockDbHandle.query.mockImplementation((sql, _params, cb) => {
      expect(sql).toContain("$1,$2,$3");
      cb(null, { rowCount: 1 });
    });

    await DbUtilsNoTelemetryExecSQL(
      "INSERT INTO t (a,b,c) VALUES (?,?,?)",
      [1, 2, 3],
    );
    expect(mockDbHandle.query).toHaveBeenCalled();
  });
});
