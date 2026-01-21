import { Span } from "@opentelemetry/sdk-trace-base";
import { Config } from "../Config";
import * as SqliteUtils from "./SqlDbUtils";
import * as PostgresUtils from "./PostgresUtils";

let databaseType: "sqlite" | "postgres" = "sqlite";

export async function DbUtilsInit(
  context: Span,
  config: Config,
): Promise<void> {
  databaseType = config.DATABASE_TYPE;
  if (databaseType === "postgres") {
    await PostgresUtils.PostgresDbUtilsInit(context, config);
  } else {
    await SqliteUtils.SqlDbUtilsInit(context, config);
  }
}

export function DbUtilsInitGetDatabase() {
  if (databaseType === "postgres") {
    return PostgresUtils.PostgresDbUtilsGetPool();
  } else {
    return SqliteUtils.SqlDbUtilsInitGetDatabase();
  }
}

export function DbUtilsExecSQL(
  context: Span,
  sql: string,
  params = [],
): Promise<number> {
  // Convert SQLite placeholders (?) to PostgreSQL ($1, $2, etc.)
  if (databaseType === "postgres") {
    let paramIndex = 1;
    const convertedSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    return PostgresUtils.PostgresDbUtilsExecSQL(context, convertedSql, params);
  } else {
    return SqliteUtils.SqlDbUtilsExecSQL(context, sql, params);
  }
}

export function DbUtilsQuerySQL(
  context: Span,
  sql: string,
  params = [],
  debug = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  // Convert SQLite placeholders (?) to PostgreSQL ($1, $2, etc.)
  if (databaseType === "postgres") {
    let paramIndex = 1;
    const convertedSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    return PostgresUtils.PostgresDbUtilsQuerySQL(
      context,
      convertedSql,
      params,
      debug,
    );
  } else {
    return SqliteUtils.SqlDbUtilsQuerySQL(context, sql, params, debug);
  }
}

export function DbUtilsGetType(): "sqlite" | "postgres" {
  return databaseType;
}
