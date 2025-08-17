import { Logger } from "./Logger";
import { SqlDbUtilsInitGetDatabase } from "./SqlDbUtils";

const logger = new Logger("SqlDbUtilsNoTelemetry");

export function SqlDbUtilsNoTelemetryExecSQL(
  sql: string,
  params = []
): Promise<void> {
  return new Promise((resolve, reject) => {
    SqlDbUtilsInitGetDatabase().run(sql, params, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export function SqlDbUtilsNoTelemetryQuerySQL(
  sql: string,
  params = [],
  debug = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  if (debug) {
    console.log(sql);
  }
  return new Promise((resolve, reject) => {
    SqlDbUtilsInitGetDatabase().all(sql, params, (error, rows) => {
      if (error) {
        console.log(error);
        logger.error(`SQL ERROR: ${sql}`);
        reject(error);
      } else {
        resolve(rows);
      }
    });
  });
}
