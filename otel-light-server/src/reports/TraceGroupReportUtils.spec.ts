// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock("../utils-std-ts/DbUtils", () => ({
  DbUtilsGetType: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";
import { BuildGroupFilterCTE } from "./TraceGroupReportUtils";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("BuildGroupFilterCTE", () => {
  beforeEach(() => {
    (DbUtilsGetType as jest.Mock).mockReset();
  });

  it("returns an always-false CTE with no parameters for an empty group list", () => {
    (DbUtilsGetType as jest.Mock).mockReturnValue("sqlite");
    expect(BuildGroupFilterCTE([])).toEqual({
      cte: "SELECT NULL AS svc, NULL AS nm WHERE 1=0",
      params: [],
    });
  });

  it("builds sqlite rows with ? placeholders and ordered parameters", () => {
    (DbUtilsGetType as jest.Mock).mockReturnValue("sqlite");
    const result = BuildGroupFilterCTE([
      { serviceName: "svc1", name: "name1" },
      { serviceName: "svc2", name: "name2" },
    ]);
    expect(result.cte).toBe(
      "SELECT ? AS svc, ? AS nm UNION ALL SELECT ? AS svc, ? AS nm",
    );
    expect(result.params).toEqual(["svc1", "name1", "svc2", "name2"]);
  });

  it("numbers postgres placeholders per group", () => {
    (DbUtilsGetType as jest.Mock).mockReturnValue("postgres");
    const result = BuildGroupFilterCTE([
      { serviceName: "svc1", name: "name1" },
      { serviceName: "svc2", name: "name2" },
    ]);
    expect(result.cte).toBe(
      "SELECT $1 AS svc, $2 AS nm UNION ALL SELECT $3 AS svc, $4 AS nm",
    );
    expect(result.params).toEqual(["svc1", "name1", "svc2", "name2"]);
  });
});
