import { Pool } from "pg";
import { Config } from "../Config";
import * as fs from "fs-extra";
import { Span } from "@opentelemetry/sdk-trace-base";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { SpanStatusCode } from "@opentelemetry/api";

const logger = OTelLogger().createModuleLogger("PostgresDbUtils");
const SQL_DIR = `${__dirname}/../../sql/postgres`;

let pool: Pool;

export async function PostgresDbUtilsInit(
  context: Span,
  config: Config,
): Promise<void> {
  const span = OTelTracer().startSpan("PostgresDbUtilsInit", context);

  // PostgreSQL connection details
  pool = new Pool({
    host: config.DATABASE_POSTGRES_HOST,
    port: config.DATABASE_POSTGRES_PORT,
    user: config.DATABASE_POSTGRES_USER,
    password: config.DATABASE_POSTGRES_PASSWORD,
    database: config.DATABASE_POSTGRES_DATABASE,
  });

  await PostgresDbUtilsExecSQLFile(span, `${SQL_DIR}/init-0000.sql`);
  const initFiles = (await fs.readdir(`${SQL_DIR}`)).sort();
  let dbVersionApplied = 0;
  const dbVersionQuery = await PostgresDbUtilsQuerySQL(
    span,
    SQL_QUERIES.GET_DB_VERSION.postgres,
  );
  if (dbVersionQuery.length > 0 && dbVersionQuery[0].version) {
    dbVersionApplied = Number(dbVersionQuery[0].version);
  }
  logger.info(`Current DB Version: ${dbVersionApplied}`, span);
  for (const initFile of initFiles) {
    const regex = /init-(\d+).sql/g;
    const match = regex.exec(initFile);
    if (match) {
      const dbVersionInitFile = Number(match[1]);
      if (dbVersionInitFile > dbVersionApplied) {
        logger.info(`Loading init file: ${initFile}`, span);
        await PostgresDbUtilsExecSQLFile(span, `${SQL_DIR}/${initFile}`);
        await PostgresDbUtilsQuerySQL(
          span,
          SQL_QUERIES.INSERT_DB_VERSION.postgres,
          ["db_version", dbVersionInitFile, new Date().toISOString()],
        );
      }
    }
  }
  span.end();
}

export function PostgresDbUtilsGetPool(): Pool {
  return pool;
}

export function PostgresDbUtilsExecSQL(
  context: Span,
  sql: string,
  params = [],
): Promise<number> {
  const span = OTelTracer().startSpan("PostgresDbUtilsExecSQL", context);
  return new Promise((resolve, reject) => {
    pool.query(sql, params, (error, result) => {
      if (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        span.end();
        reject(error);
      } else {
        span.addEvent(`Impacted Rows: ${result.rowCount || 0}`);
        span.end();
        resolve(result.rowCount || 0);
      }
    });
  });
}

export async function PostgresDbUtilsExecSQLFile(
  context: Span,
  filename: string,
): Promise<void> {
  const span = OTelTracer().startSpan("PostgresDbUtilsExecSQLFile", context);
  const sql = (await fs.readFile(filename)).toString();
  return new Promise((resolve, reject) => {
    pool.query(sql, (error) => {
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

export function PostgresDbUtilsQuerySQL(
  context: Span,
  sql: string,
  params = [],
  debug = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const span = OTelTracer().startSpan("PostgresDbUtilsQuerySQL", context);
  if (debug) {
    console.log(sql);
  }
  return new Promise((resolve, reject) => {
    pool.query(sql, params, (error, result) => {
      if (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        logger.error(`SQL ERROR: ${sql}`, error, span);
        span.end();
        reject(error);
      } else {
        span.end();
        resolve(result.rows);
      }
    });
  });
}

export function PostgresDbUtilsTransactionStart(context: Span): Promise<void> {
  const span = OTelTracer().startSpan(
    "PostgresDbUtilsTransactionStart",
    context,
  );
  return new Promise((resolve, reject) => {
    pool.query("BEGIN", (error) => {
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

export function PostgresDbUtilsTransactionCommit(context: Span): Promise<void> {
  const span = OTelTracer().startSpan(
    "PostgresDbUtilsTransactionCommit",
    context,
  );
  return new Promise((resolve, reject) => {
    pool.query("COMMIT", (error) => {
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

// SQL

const SQL_QUERIES = {
  GET_DB_VERSION: {
    postgres:
      "SELECT MAX(value) as version FROM metadata WHERE \"type\" = 'db_version'",
    sqlite:
      'SELECT MAX(value) as version FROM metadata WHERE type = "db_version"',
  },
  INSERT_DB_VERSION: {
    postgres:
      'INSERT INTO metadata ("type", "value", "dateCreated") VALUES ($1, $2, $3)',
    sqlite:
      "INSERT INTO metadata (type, value, dateCreated) VALUES ($1, $2, $3)",
  },
};
