import * as fs from "fs";
import * as fse from "fs-extra";
import * as path from "path";
import { Config } from "../Config";
import { OTelLogger } from "../OTelContext";
import { DbUtilsInitGetDatabase } from "../utils-std-ts/DbUtils";

const logger = OTelLogger().createModuleLogger("ExportImport");

export async function ExportImportExportSqliteDatabase(
  config: Config,
): Promise<void> {
  const exportPath = path.join(config.DATA_DIR, "import_postgres.sql");
  logger.info(`Exporting SQLite database to ${exportPath}`);
  const db = DbUtilsInitGetDatabase();
  const tables = ["traces", "metrics", "logs"];

  const escapeValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return "NULL";
    }
    if (typeof value === "number") {
      return String(value);
    }
    return `'${String(value).replace(/'/g, "''")}'`;
  };

  const writeStream = fs.createWriteStream(exportPath, { encoding: "utf-8" });
  let totalRows = 0;
  for (const table of tables) {
    logger.info(`Exporting table: ${table}`);
    const rows: Record<string, unknown>[] = await new Promise(
      (resolve, reject) => {
        db.all(`SELECT * FROM ${table}`, [], (error, rows) => {
          if (error) {
            reject(error);
          } else {
            resolve(rows);
          }
        });
      },
    );
    logger.info(`Table ${table}: ${rows.length} rows`);
    for (const row of rows) {
      const columns = Object.keys(row)
        .map((col) => `"${col}"`)
        .join(", ");
      const values = Object.values(row).map(escapeValue).join(", ");
      const canContinue = writeStream.write(
        `INSERT INTO ${table} (${columns}) VALUES (${values});\n`,
      );
      if (!canContinue) {
        await new Promise<void>((resolve) =>
          writeStream.once("drain", resolve),
        );
      }
      totalRows++;
    }
  }

  await new Promise<void>((resolve, reject) => {
    writeStream.end(() => resolve());
    writeStream.on("error", reject);
  });
  logger.info(`PostgreSQL export complete: ${totalRows} total rows exported`);
}

export async function ExportImportImportPostgresDatabase(
  config: Config,
): Promise<void> {
  const importPath = path.join(config.DATA_DIR, "import_postgres.sql");
  if (!(await fse.pathExists(importPath))) {
    logger.error(`Import file not found: ${importPath}`);
    return;
  }
  logger.info(`Importing PostgreSQL data from ${importPath}`);
  const pool = DbUtilsInitGetDatabase();
  const content = await fse.readFile(importPath, "utf-8");
  const statements = content
    .split("\n")
    .filter((line) => line.trim().length > 0);
  logger.info(`Total statements to execute: ${statements.length}`);

  let success = 0;
  let errors = 0;
  for (const statement of statements) {
    try {
      await pool.query(statement);
      success++;
    } catch (error) {
      errors++;
      logger.error(`Error executing statement: ${error.message}`);
    }
  }
  logger.info(
    `PostgreSQL import complete: ${success} succeeded, ${errors} failed`,
  );
}
