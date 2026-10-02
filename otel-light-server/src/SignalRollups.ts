import { Span } from "@opentelemetry/sdk-trace-base";
import { OTelLogger, OTelTracer } from "./OTelContext";
import { DbUtilsGetType } from "./utils-std-ts/DbUtils";
import {
  DbUtilsNoTelemetryBatchInsert,
  DbUtilsNoTelemetryExecSQL,
  DbUtilsNoTelemetryQuerySQL,
} from "./utils-std-ts/DbUtilsNoTelemetry";

const logger = OTelLogger().createModuleLogger("SignalRollups");

// Incremental rollups replacing the periodic full-table GROUP BY scans that
// SelfMetrics and AnalyticsCache used to run (M4). Counts are exact:
//   - bumped on ingestion (upsert per batch),
//   - decremented with delete deltas in Maintenance,
//   - recounted from raw tables once at startup when empty (first boot after
//     the init-0011 upgrade). firstSeen/lastSeen of a group whose oldest rows
//     were removed may lag behind the actual boundaries until the group is
//     fully deleted (the row is then dropped and re-created fresh on next
//     insert); they only feed cache/ordering hints, never displayed counts.

export type SignalType = "traces" | "metrics" | "logs";

export interface SignalServiceCountsRow {
  signalType: SignalType;
  serviceName: string;
  serviceVersion: string;
  count: number;
}

export interface SignalServiceVersionRow {
  serviceName: string;
  serviceVersion: string;
  lastSeen: number;
}

export interface SignalMetricNameRow {
  serviceName: string;
  name: string;
  type: string;
  firstSeen: number;
  lastSeen: number;
}

export interface SignalInsertEntry {
  serviceName: string;
  serviceVersion: string;
  time: number;
}

export interface MetricNameInsertEntry {
  serviceName: string;
  name: string;
  type: string;
  time: number;
}

export interface SignalServiceCountsDelta {
  serviceName: string;
  serviceVersion: string;
  count: number;
}

export interface MetricNameDelta {
  serviceName: string;
  name: string;
  type: string;
  count: number;
}

const INSERT_CHUNK_ROWS = 200;

// ── Initialization / recount ──────────────────────────────────────────────────

export async function SignalRollupsInit(context: Span): Promise<void> {
  const span = OTelTracer().startSpan("SignalRollupsInit", context);
  try {
    await ensureInitialized(span);
  } catch (err) {
    // Bounded self-heal: MaintenancePerform re-checks on every run.
    logger.error(
      `Failed to initialize signal rollups (will retry during maintenance): ${err.message}`,
      err,
      span,
    );
  }
  span.end();
}

export async function SignalRollupsEnsureInitialized(
  context: Span,
): Promise<void> {
  const span = OTelTracer().startSpan(
    "SignalRollupsEnsureInitialized",
    context,
  );
  try {
    await ensureInitialized(span);
  } catch (err) {
    logger.error(`Failed to recount signal rollups: ${err.message}`, err, span);
  }
  span.end();
}

async function ensureInitialized(span: Span): Promise<void> {
  const [countsEmpty, namesEmpty] = await Promise.all([
    isRollupEmpty("signal_service_counts"),
    isRollupEmpty("signal_metric_names"),
  ]);
  if (!countsEmpty && !namesEmpty) {
    return;
  }
  logger.info(
    "Signal rollups are empty: recalculating from raw signal tables (one-time)",
    span,
  );
  await recount(span);
}

async function isRollupEmpty(tableName: string): Promise<boolean> {
  const rows = await DbUtilsNoTelemetryQuerySQL(
    `SELECT 1 FROM ${tableName} LIMIT 1`,
    [],
  );
  return !rows || rows.length === 0;
}

async function recount(span: Span): Promise<void> {
  const dbType = DbUtilsGetType();

  const [tracesRows, metricsRows, logsRows, metricNamesRows] =
    await Promise.all([
      DbUtilsNoTelemetryQuerySQL(SQL.SELECT_TRACES_COUNTS[dbType], []),
      DbUtilsNoTelemetryQuerySQL(SQL.SELECT_METRICS_COUNTS[dbType], []),
      DbUtilsNoTelemetryQuerySQL(SQL.SELECT_LOGS_COUNTS[dbType], []),
      DbUtilsNoTelemetryQuerySQL(SQL.SELECT_METRIC_NAMES_COUNTS[dbType], []),
    ]);

  await DbUtilsNoTelemetryExecSQL("DELETE FROM signal_service_counts");
  await DbUtilsNoTelemetryExecSQL("DELETE FROM signal_metric_names");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toServiceCountRows = (signalType: SignalType, rows: any[]) =>
    rows.map((row) => [
      signalType,
      row.serviceName,
      row.serviceVersion,
      Number(row.cnt),
      Number(row.firstSeen),
      Number(row.lastSeen),
    ]);

  const serviceCountRows = [
    ...toServiceCountRows("traces", tracesRows),
    ...toServiceCountRows("metrics", metricsRows),
    ...toServiceCountRows("logs", logsRows),
  ];
  await batchInsertChunked(SQL.INSERT_SERVICE_COUNTS_COLS, 6, serviceCountRows);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metricNameRows = metricNamesRows.map((row: any) => [
    row.serviceName,
    row.name,
    row.type,
    Number(row.cnt),
    Number(row.firstSeen),
    Number(row.lastSeen),
  ]);
  await batchInsertChunked(SQL.INSERT_METRIC_NAMES_COLS, 6, metricNameRows);

  logger.info(
    `Signal rollup recount completed: ${serviceCountRows.length} service/version/signal rows, ${metricNameRows.length} metric name rows`,
    span,
  );
}

// ── Ingestion updates ─────────────────────────────────────────────────────────

export async function SignalRollupsRecordSignalInsert(
  signalType: SignalType,
  entries: SignalInsertEntry[],
): Promise<void> {
  if (!entries || entries.length === 0) {
    return;
  }
  const groups = aggregateByServiceVersion(entries);
  const dbType = DbUtilsGetType();
  await upsertChunked(
    UPSERT_SERVICE_COUNTS[dbType],
    groups.map((group) => [
      signalType,
      group.serviceName,
      group.serviceVersion,
      group.count,
      group.firstSeen,
      group.lastSeen,
    ]),
  );
}

export async function SignalRollupsRecordMetricNamesInsert(
  entries: MetricNameInsertEntry[],
): Promise<void> {
  if (!entries || entries.length === 0) {
    return;
  }
  const groups = aggregateByNameType(entries);
  const dbType = DbUtilsGetType();
  await upsertChunked(
    UPSERT_METRIC_NAMES[dbType],
    groups.map((group) => [
      group.serviceName,
      group.name,
      group.type,
      group.count,
      group.firstSeen,
      group.lastSeen,
    ]),
  );
}

// ── Maintenance delete updates ────────────────────────────────────────────────

export async function SignalRollupsRecordSignalDeletion(
  signalType: SignalType,
  groups: SignalServiceCountsDelta[],
): Promise<void> {
  if (!groups || groups.length === 0) {
    return;
  }
  const dbType = DbUtilsGetType();
  for (const group of groups) {
    await DbUtilsNoTelemetryExecSQL(SQL.DECREMENT_SERVICE_COUNTS[dbType], [
      group.count,
      signalType,
      group.serviceName,
      group.serviceVersion,
    ]);
  }
  await DbUtilsNoTelemetryExecSQL(SQL.DELETE_EMPTY_SERVICE_COUNTS[dbType], []);
}

export async function SignalRollupsRecordMetricNameDeletion(
  groups: MetricNameDelta[],
): Promise<void> {
  if (!groups || groups.length === 0) {
    return;
  }
  const dbType = DbUtilsGetType();
  for (const group of groups) {
    await DbUtilsNoTelemetryExecSQL(SQL.DECREMENT_METRIC_NAMES[dbType], [
      group.count,
      group.serviceName,
      group.name,
      group.type,
    ]);
  }
  await DbUtilsNoTelemetryExecSQL(SQL.DELETE_EMPTY_METRIC_NAMES[dbType], []);
}

// ── Reads (O(1) rollup reads replacing full-table scans) ──────────────────────

export async function SignalRollupsGetAllCounts(): Promise<
  SignalServiceCountsRow[]
> {
  const rows = await DbUtilsNoTelemetryQuerySQL(SQL.GET_ALL_COUNTS, []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => ({
    signalType: row.signalType,
    serviceName: row.serviceName,
    serviceVersion: row.serviceVersion,
    count: Number(row.count),
  }));
}

export async function SignalRollupsGetServicesAndVersions(): Promise<{
  services: string[];
  serviceVersions: SignalServiceVersionRow[];
}> {
  const [serviceRows, versionRows] = await Promise.all([
    DbUtilsNoTelemetryQuerySQL(SQL.GET_SERVICES, []),
    DbUtilsNoTelemetryQuerySQL(SQL.GET_SERVICE_VERSIONS, []),
  ]);
  const services: string[] = [];
  for (const row of serviceRows) {
    if (row.serviceName) services.push(row.serviceName);
  }
  // Rows arrive ordered by (serviceName, lastSeen DESC): de-duplicating by
  // serviceName/serviceVersion keeps the most recently seen version first.
  const seen = new Set<string>();
  const serviceVersions: SignalServiceVersionRow[] = [];
  for (const row of versionRows) {
    const key = `${row.serviceName}::${row.serviceVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    serviceVersions.push({
      serviceName: row.serviceName,
      serviceVersion: row.serviceVersion,
      lastSeen: Number(row.lastSeen),
    });
  }
  return { services, serviceVersions };
}

export async function SignalRollupsGetMetricNames(): Promise<
  SignalMetricNameRow[]
> {
  const rows = await DbUtilsNoTelemetryQuerySQL(SQL.GET_METRIC_NAMES, []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => ({
    serviceName: row.serviceName,
    name: row.name,
    type: row.type,
    firstSeen: Number(row.firstSeen),
    lastSeen: Number(row.lastSeen),
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function aggregateByServiceVersion(entries: SignalInsertEntry[]): {
  serviceName: string;
  serviceVersion: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}[] {
  const map = new Map<
    string,
    {
      serviceName: string;
      serviceVersion: string;
      count: number;
      firstSeen: number;
      lastSeen: number;
    }
  >();
  for (const entry of entries) {
    const key = `${entry.serviceName}\u0000${entry.serviceVersion}`;
    const group = map.get(key);
    if (!group) {
      map.set(key, {
        serviceName: entry.serviceName,
        serviceVersion: entry.serviceVersion,
        count: 1,
        firstSeen: entry.time,
        lastSeen: entry.time,
      });
    } else {
      group.count++;
      if (entry.time < group.firstSeen) group.firstSeen = entry.time;
      if (entry.time > group.lastSeen) group.lastSeen = entry.time;
    }
  }
  return Array.from(map.values());
}

function aggregateByNameType(entries: MetricNameInsertEntry[]): {
  serviceName: string;
  name: string;
  type: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}[] {
  const map = new Map<
    string,
    {
      serviceName: string;
      name: string;
      type: string;
      count: number;
      firstSeen: number;
      lastSeen: number;
    }
  >();
  for (const entry of entries) {
    const key = `${entry.serviceName}\u0000${entry.name}\u0000${entry.type}`;
    const group = map.get(key);
    if (!group) {
      map.set(key, {
        serviceName: entry.serviceName,
        name: entry.name,
        type: entry.type,
        count: 1,
        firstSeen: entry.time,
        lastSeen: entry.time,
      });
    } else {
      group.count++;
      if (entry.time < group.firstSeen) group.firstSeen = entry.time;
      if (entry.time > group.lastSeen) group.lastSeen = entry.time;
    }
  }
  return Array.from(map.values());
}

async function upsertChunked(
  buildSQL: (numRows: number) => string,
  rows: unknown[][],
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_ROWS);
    await DbUtilsNoTelemetryExecSQL(buildSQL(chunk.length), chunk.flat());
  }
}

async function batchInsertChunked(
  tableCols: string,
  numCols: number,
  rows: unknown[][],
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_ROWS) {
    await DbUtilsNoTelemetryBatchInsert(
      tableCols,
      numCols,
      rows.slice(i, i + INSERT_CHUNK_ROWS),
    );
  }
}

function buildValuesRows(numRows: number): string {
  return Array.from({ length: numRows }, () => "(?, ?, ?, ?, ?, ?)").join(",");
}

const UPSERT_SERVICE_COUNTS: Record<string, (numRows: number) => string> = {
  postgres: (numRows) =>
    `INSERT INTO signal_service_counts ("signalType", "serviceName", "serviceVersion", "count", "firstSeen", "lastSeen") ` +
    `VALUES ${buildValuesRows(numRows)} ` +
    `ON CONFLICT ("signalType", "serviceName", "serviceVersion") DO UPDATE SET ` +
    `"count" = "count" + EXCLUDED."count", ` +
    `"firstSeen" = LEAST("firstSeen", EXCLUDED."firstSeen"), ` +
    `"lastSeen" = GREATEST("lastSeen", EXCLUDED."lastSeen")`,
  sqlite: (numRows) =>
    `INSERT INTO signal_service_counts (signalType, serviceName, serviceVersion, count, firstSeen, lastSeen) ` +
    `VALUES ${buildValuesRows(numRows)} ` +
    `ON CONFLICT (signalType, serviceName, serviceVersion) DO UPDATE SET ` +
    `count = count + excluded.count, ` +
    `firstSeen = MIN(firstSeen, excluded.firstSeen), ` +
    `lastSeen = MAX(lastSeen, excluded.lastSeen)`,
};

const UPSERT_METRIC_NAMES: Record<string, (numRows: number) => string> = {
  postgres: (numRows) =>
    `INSERT INTO signal_metric_names ("serviceName", "name", "type", "count", "firstSeen", "lastSeen") ` +
    `VALUES ${buildValuesRows(numRows)} ` +
    `ON CONFLICT ("serviceName", "name", "type") DO UPDATE SET ` +
    `"count" = "count" + EXCLUDED."count", ` +
    `"firstSeen" = LEAST("firstSeen", EXCLUDED."firstSeen"), ` +
    `"lastSeen" = GREATEST("lastSeen", EXCLUDED."lastSeen")`,
  sqlite: (numRows) =>
    `INSERT INTO signal_metric_names (serviceName, name, type, count, firstSeen, lastSeen) ` +
    `VALUES ${buildValuesRows(numRows)} ` +
    `ON CONFLICT (serviceName, name, type) DO UPDATE SET ` +
    `count = count + excluded.count, ` +
    `firstSeen = MIN(firstSeen, excluded.firstSeen), ` +
    `lastSeen = MAX(lastSeen, excluded.lastSeen)`,
};

// ── SQL ───────────────────────────────────────────────────────────────────────

const SQL = {
  SELECT_TRACES_COUNTS: {
    postgres:
      'SELECT "serviceName", "serviceVersion", COUNT(*) AS cnt, MIN("startTime") AS "firstSeen", MAX("startTime") AS "lastSeen" FROM traces GROUP BY "serviceName", "serviceVersion"',
    sqlite:
      "SELECT serviceName, serviceVersion, COUNT(*) AS cnt, MIN(startTime) AS firstSeen, MAX(startTime) AS lastSeen FROM traces GROUP BY serviceName, serviceVersion",
  },
  SELECT_METRICS_COUNTS: {
    postgres:
      'SELECT "serviceName", "serviceVersion", COUNT(*) AS cnt, MIN("time") AS "firstSeen", MAX("time") AS "lastSeen" FROM metrics GROUP BY "serviceName", "serviceVersion"',
    sqlite:
      "SELECT serviceName, serviceVersion, COUNT(*) AS cnt, MIN(time) AS firstSeen, MAX(time) AS lastSeen FROM metrics GROUP BY serviceName, serviceVersion",
  },
  SELECT_LOGS_COUNTS: {
    postgres:
      'SELECT "serviceName", "serviceVersion", COUNT(*) AS cnt, MIN("time") AS "firstSeen", MAX("time") AS "lastSeen" FROM logs GROUP BY "serviceName", "serviceVersion"',
    sqlite:
      "SELECT serviceName, serviceVersion, COUNT(*) AS cnt, MIN(time) AS firstSeen, MAX(time) AS lastSeen FROM logs GROUP BY serviceName, serviceVersion",
  },
  SELECT_METRIC_NAMES_COUNTS: {
    postgres:
      'SELECT "serviceName", "name", "type", COUNT(*) AS cnt, MIN("time") AS "firstSeen", MAX("time") AS "lastSeen" FROM metrics GROUP BY "serviceName", "name", "type"',
    sqlite:
      "SELECT serviceName, name, type, COUNT(*) AS cnt, MIN(time) AS firstSeen, MAX(time) AS lastSeen FROM metrics GROUP BY serviceName, name, type",
  },
  INSERT_SERVICE_COUNTS_COLS:
    'INTO signal_service_counts ("signalType", "serviceName", "serviceVersion", "count", "firstSeen", "lastSeen")',
  INSERT_METRIC_NAMES_COLS:
    'INTO signal_metric_names ("serviceName", "name", "type", "count", "firstSeen", "lastSeen")',
  DECREMENT_SERVICE_COUNTS: {
    postgres:
      'UPDATE signal_service_counts SET "count" = "count" - $1 WHERE "signalType" = $2 AND "serviceName" = $3 AND "serviceVersion" = $4',
    sqlite:
      "UPDATE signal_service_counts SET count = count - ? WHERE signalType = ? AND serviceName = ? AND serviceVersion = ?",
  },
  DELETE_EMPTY_SERVICE_COUNTS: {
    postgres: 'DELETE FROM signal_service_counts WHERE "count" <= 0',
    sqlite: "DELETE FROM signal_service_counts WHERE count <= 0",
  },
  DECREMENT_METRIC_NAMES: {
    postgres:
      'UPDATE signal_metric_names SET "count" = "count" - $1 WHERE "serviceName" = $2 AND "name" = $3 AND "type" = $4',
    sqlite:
      "UPDATE signal_metric_names SET count = count - ? WHERE serviceName = ? AND name = ? AND type = ?",
  },
  DELETE_EMPTY_METRIC_NAMES: {
    postgres: 'DELETE FROM signal_metric_names WHERE "count" <= 0',
    sqlite: "DELETE FROM signal_metric_names WHERE count <= 0",
  },
  GET_ALL_COUNTS:
    'SELECT "signalType", "serviceName", "serviceVersion", "count" FROM signal_service_counts WHERE "count" > 0',
  GET_SERVICES:
    'SELECT DISTINCT "serviceName" FROM signal_service_counts WHERE "count" > 0 ORDER BY "serviceName"',
  GET_SERVICE_VERSIONS:
    `SELECT "serviceName", "serviceVersion", "lastSeen" FROM signal_service_counts WHERE "signalType" IN ('traces', 'logs') AND "count" > 0 ORDER BY "serviceName", "lastSeen" DESC`,
  GET_METRIC_NAMES:
    'SELECT "serviceName", "name", "type", "firstSeen", "lastSeen" FROM signal_metric_names WHERE "count" > 0 ORDER BY "serviceName", "name", "type"',
};
