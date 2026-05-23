import { OTelLogger } from "../OTelContext";
import {
  DbUtilsInitGetDatabase,
  DbUtilsGetType,
  convertToPostgresPlaceholders,
} from "./DbUtils";

const logger = OTelLogger().createModuleLogger("DbUtilsNoTelemetry");

/**
 * Execute a multi-row INSERT with a flat parameter array.
 * Builds: INSERT INTO <tableCols> VALUES (?,?...),(?,?...),...
 */
export function DbUtilsNoTelemetryBatchInsert(
  tableCols: string,
  numCols: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[][],
): Promise<number> {
  if (rows.length === 0) return Promise.resolve(0);
  const rowSQL = `(${Array.from({ length: numCols }, () => "?").join(",")})`;
  const multiValues = Array.from({ length: rows.length }, () => rowSQL).join(
    ",",
  );
  const sql = `INSERT ${tableCols} VALUES ${multiValues}`;
  return DbUtilsNoTelemetryExecSQL(sql, rows.flat());
}

export function DbUtilsNoTelemetryExecSQL(
  sql: string,
  params = [],
): Promise<number> {
  const dbType = DbUtilsGetType();
  if (dbType === "postgres") {
    return new Promise((resolve, reject) => {
      DbUtilsInitGetDatabase().query(
        convertToPostgresPlaceholders(sql),
        params,
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result.rowCount || 0);
          }
        },
      );
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
    const convertedSql = convertToPostgresPlaceholders(sql);

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
