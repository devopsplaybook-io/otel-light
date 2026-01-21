import { OTelLogger } from "../OTelContext";
import { DbUtilsInitGetDatabase, DbUtilsGetType } from "./DbUtils";

const logger = OTelLogger().createModuleLogger("DbUtilsNoTelemetry");

export function DbUtilsNoTelemetryExecSQL(
  sql: string,
  params = [],
): Promise<number> {
  const dbType = DbUtilsGetType();

  if (dbType === "postgres") {
    // Convert SQLite placeholders (?) to PostgreSQL ($1, $2, etc.)
    let paramIndex = 1;
    const convertedSql = sql.replace(/\?/g, () => `$${paramIndex++}`);

    return new Promise((resolve, reject) => {
      DbUtilsInitGetDatabase().query(convertedSql, params, (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result.rowCount || 0);
        }
      });
    });
  } else {
    return new Promise((resolve, reject) => {
      DbUtilsInitGetDatabase().run(sql, params, function (error) {
        if (error) {
          reject(error);
        } else {
          resolve(this.changes);
        }
      });
    });
  }
}

export function DbUtilsNoTelemetryQuerySQL(
  sql: string,
  params = [],
  debug = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  if (debug) {
    console.log(sql);
  }

  const dbType = DbUtilsGetType();

  if (dbType === "postgres") {
    // Convert SQLite placeholders (?) to PostgreSQL ($1, $2, etc.)
    let paramIndex = 1;
    const convertedSql = sql.replace(/\?/g, () => `$${paramIndex++}`);

    return new Promise((resolve, reject) => {
      DbUtilsInitGetDatabase().query(convertedSql, params, (error, result) => {
        if (error) {
          logger.error(`SQL ERROR: ${sql}`, error);
          reject(error);
        } else {
          resolve(result.rows);
        }
      });
    });
  } else {
    return new Promise((resolve, reject) => {
      DbUtilsInitGetDatabase().all(sql, params, (error, rows) => {
        if (error) {
          logger.error(`SQL ERROR: ${sql}`, error);
          reject(error);
        } else {
          resolve(rows);
        }
      });
    });
  }
}
