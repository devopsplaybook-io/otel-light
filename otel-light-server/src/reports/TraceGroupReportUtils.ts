import { DbUtilsGetType } from "../utils-std-ts/DbUtils";

// Group filters are passed as bound parameters (values originate from
// telemetry and must never be interpolated into the SQL text).
export function BuildGroupFilterCTE(topGroups: {
  serviceName: string;
  name: string;
}[]): { cte: string; params: string[] } {
  if (topGroups.length === 0) {
    return { cte: "SELECT NULL AS svc, NULL AS nm WHERE 1=0", params: [] };
  }

  const dbType = DbUtilsGetType();
  const params: string[] = [];
  const rows = topGroups.map((g, i) => {
    params.push(g.serviceName, g.name);
    if (dbType === "postgres") {
      return `SELECT $${i * 2 + 1} AS svc, $${i * 2 + 2} AS nm`;
    }
    return "SELECT ? AS svc, ? AS nm";
  });
  return { cte: rows.join(" UNION ALL "), params };
}
