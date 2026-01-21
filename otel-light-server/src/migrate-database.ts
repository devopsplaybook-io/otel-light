#!/usr/bin/env node
/**
 * Database Migration Script for otel-light-server
 *
 * This script migrates data between SQLite and PostgreSQL databases.
 *
 * Usage:
 *   node migrate-database.js --from sqlite --to postgres
 *   node migrate-database.js --from postgres --to sqlite
 *
 * Configuration:
 *   The script reads configuration from config.json and environment variables
 */

import { Database } from "sqlite3";
import { Pool } from "pg";
import * as fs from "fs-extra";

interface MigrationConfig {
  from: "sqlite" | "postgres";
  to: "sqlite" | "postgres";
  sqliteDbPath: string;
  postgresConfig: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
}

const TABLES = ["metadata", "users", "traces", "metrics", "logs", "settings"];

class DatabaseMigration {
  private sqliteDb?: Database;
  private postgresPool?: Pool;
  private config: MigrationConfig;

  constructor(config: MigrationConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    console.log(
      `Initializing migration from ${this.config.from} to ${this.config.to}...`,
    );

    if (this.config.from === "sqlite" || this.config.to === "sqlite") {
      this.sqliteDb = new Database(this.config.sqliteDbPath);
    }

    if (this.config.from === "postgres" || this.config.to === "postgres") {
      this.postgresPool = new Pool(this.config.postgresConfig);
      // Test connection
      const client = await this.postgresPool.connect();
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.sqliteDb) {
      this.sqliteDb.close();
    }
    if (this.postgresPool) {
      await this.postgresPool.end();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async querySqlite(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.sqliteDb!.all(sql, params, (error, rows) => {
        if (error) {
          reject(error);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async execSqlite(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.sqliteDb!.run(sql, params, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async queryPostgres(sql: string, params: any[] = []): Promise<any[]> {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const result = await this.postgresPool!.query(sql, params);
    return result.rows;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async execPostgres(sql: string, params: any[] = []): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.postgresPool!.query(sql, params);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getRowsFromSource(tableName: string): Promise<any[]> {
    if (this.config.from === "sqlite") {
      return await this.querySqlite(`SELECT * FROM ${tableName}`);
    } else {
      return await this.queryPostgres(`SELECT * FROM ${tableName}`);
    }
  }

  private async clearTable(tableName: string): Promise<void> {
    console.log(`  Clearing table ${tableName} in destination...`);
    if (this.config.to === "sqlite") {
      await this.execSqlite(`DELETE FROM ${tableName}`);
    } else {
      await this.execPostgres(`DELETE FROM ${tableName}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async insertRow(tableName: string, row: any): Promise<void> {
    const columns = Object.keys(row);
    const values = Object.values(row);

    if (this.config.to === "sqlite") {
      const placeholders = columns.map(() => "?").join(", ");
      const sql = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`;
      await this.execSqlite(sql, values);
    } else {
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`;
      await this.execPostgres(sql, values);
    }
  }

  private async getTableRowCount(tableName: string): Promise<number> {
    try {
      if (this.config.from === "sqlite") {
        const result = await this.querySqlite(
          `SELECT COUNT(*) as count FROM ${tableName}`,
        );
        return result[0].count;
      } else {
        const result = await this.queryPostgres(
          `SELECT COUNT(*) as count FROM ${tableName}`,
        );
        return parseInt(result[0].count);
      }
    } catch {
      console.log(`  Table ${tableName} does not exist in source, skipping...`);
      return 0;
    }
  }

  async migrateTable(tableName: string): Promise<void> {
    console.log(`Migrating table: ${tableName}`);

    const rowCount = await this.getTableRowCount(tableName);
    if (rowCount === 0) {
      console.log(`  No rows to migrate from ${tableName}`);
      return;
    }

    console.log(`  Found ${rowCount} rows in ${tableName}`);
    const rows = await this.getRowsFromSource(tableName);

    await this.clearTable(tableName);

    let migratedCount = 0;
    for (const row of rows) {
      await this.insertRow(tableName, row);
      migratedCount++;
      if (migratedCount % 100 === 0) {
        console.log(`  Migrated ${migratedCount}/${rows.length} rows...`);
      }
    }

    console.log(
      `  ✓ Successfully migrated ${migratedCount} rows from ${tableName}`,
    );
  }

  async migrate(): Promise<void> {
    console.log(
      `Starting migration from ${this.config.from} to ${this.config.to}...\n`,
    );

    for (const table of TABLES) {
      try {
        await this.migrateTable(table);
      } catch (error) {
        console.error(`Error migrating table ${table}:`, error);
        throw error;
      }
    }

    console.log("\n✓ Migration completed successfully!");
  }
}

async function main() {
  const args = process.argv.slice(2);

  let from: "sqlite" | "postgres" = "sqlite";
  let to: "sqlite" | "postgres" = "postgres";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) {
      from = args[i + 1] as "sqlite" | "postgres";
    }
    if (args[i] === "--to" && args[i + 1]) {
      to = args[i + 1] as "sqlite" | "postgres";
    }
  }

  if (from === to) {
    console.error("Error: Source and destination databases cannot be the same");
    process.exit(1);
  }

  // Load configuration
  const configFile = process.env.CONFIG_FILE || "config.json";
  const config = await fs.readJson(configFile);

  const migrationConfig: MigrationConfig = {
    from,
    to,
    sqliteDbPath: `${process.env.DATA_DIR || config.DATA_DIR || "/data"}/database.db`,
    postgresConfig: {
      host:
        process.env.DATABASE_POSTGRES_HOST ||
        config.DATABASE_POSTGRES_HOST ||
        "localhost",
      port: parseInt(
        process.env.DATABASE_POSTGRES_PORT ||
          config.DATABASE_POSTGRES_PORT ||
          "5432",
      ),
      user:
        process.env.DATABASE_POSTGRES_USER ||
        config.DATABASE_POSTGRES_USER ||
        "otel",
      password:
        process.env.DATABASE_POSTGRES_PASSWORD ||
        config.DATABASE_POSTGRES_PASSWORD ||
        "",
      database:
        process.env.DATABASE_POSTGRES_DATABASE ||
        config.DATABASE_POSTGRES_DATABASE ||
        "otel_light",
    },
  };

  console.log("Migration Configuration:");
  console.log(`  From: ${migrationConfig.from}`);
  console.log(`  To: ${migrationConfig.to}`);
  console.log(`  SQLite DB: ${migrationConfig.sqliteDbPath}`);
  console.log(
    `  PostgreSQL: ${migrationConfig.postgresConfig.host}:${migrationConfig.postgresConfig.port}/${migrationConfig.postgresConfig.database}`,
  );
  console.log("");

  const migration = new DatabaseMigration(migrationConfig);

  try {
    await migration.init();
    await migration.migrate();
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await migration.close();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
