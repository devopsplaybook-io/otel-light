import { Database } from "sqlite3";
import { Config } from "../Config";
import * as fs from "fs-extra";
import { Logger } from "./Logger";
import { Span } from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode } from "@opentelemetry/api";
import { StandardTracerStartSpan } from "./StandardTracer";

const logger = new Logger("SqlDbutils");
const SQL_DIR = `${__dirname}/../../sql`;

let database;

export async function SqlDbUtilsInit(
  context: Span,
  config: Config
): Promise<void> {
  const span = StandardTracerStartSpan("SqlDbUtilsInit", context);
  await fs.ensureDir(config.DATA_DIR);
  database = new Database(`${config.DATA_DIR}/database.db`);
  await SqlDbUtilsExecSQLFile(span, `${SQL_DIR}/init-0000.sql`);
  const initFiles = (await await fs.readdir(`${SQL_DIR}`)).sort();
  let dbVersionApplied = 0;
  const dbVersionQuery = await SqlDbUtilsQuerySQL(
    span,
    "SELECT MAX(value) as maxVerion FROM metadata WHERE type='db_version'"
  );
  if (dbVersionQuery[0].maxVerion) {
    dbVersionApplied = Number(dbVersionQuery[0].maxVerion);
  }
  logger.info(`Current DB Version: ${dbVersionApplied}`);
  for (const initFile of initFiles) {
    const regex = /init-(\d+).sql/g;
    const match = regex.exec(initFile);
    if (match) {
      const dbVersionInitFile = Number(match[1]);
      if (dbVersionInitFile > dbVersionApplied) {
        logger.info(`Loading init file: ${initFile}`);
        await SqlDbUtilsExecSQLFile(span, `${SQL_DIR}/${initFile}`);
        await SqlDbUtilsQuerySQL(
          span,
          'INSERT INTO metadata (type, value, dateCreated) VALUES ("db_version",?,?)',
          [dbVersionInitFile, new Date().toISOString()]
        );
      }
    }
  }
  span.end();
}

export function SqlDbUtilsInitGetDatabase() {
  return database;
}

export function SqlDbUtilsExecSQL(
  context: Span,
  sql: string,
  params = []
): Promise<number> {
  const span = StandardTracerStartSpan("SqlDbUtilsExecSQL", context);
  return new Promise((resolve, reject) => {
    database.run(sql, params, function (error) {
      if (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        span.end();
        reject(error);
      } else {
        span.addEvent(`Changed Rows: ${this.changes}`);
        span.setStatus({ code: SpanStatusCode.ERROR, message: "test" });
        span.end();
        resolve(this.changes);
      }
    });
  });
}

export async function SqlDbUtilsExecSQLFile(
  context: Span,
  filename: string
): Promise<void> {
  const span = StandardTracerStartSpan("SqlDbUtilsExecSQLFile", context);
  const sql = (await fs.readFile(filename)).toString();
  return new Promise((resolve, reject) => {
    database.exec(sql, (error) => {
      if (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        span.end();
        reject(error);
      } else {
        span.end();
        resolve();
      }
    });
  });
}

export function SqlDbUtilsQuerySQL(
  context: Span,
  sql: string,
  params = [],
  debug = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const span = StandardTracerStartSpan("SqlDbUtilsQuerySQL", context);
  if (debug) {
    console.log(sql);
  }
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => {
      if (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        span.end();
        reject(error);
      } else {
        span.end();
        resolve(rows);
      }
    });
  });
}
