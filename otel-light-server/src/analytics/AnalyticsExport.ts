// Server-side export of the complete filtered result set.
//
// Rows are fetched in keyset-paginated chunks and yielded as strings, so the
// full result is never buffered in memory. CSV keeps the client-side formula
// neutralization (`=`, `+`, `-`, `@`, tab, CR, LF prefixes get an apostrophe)
// and both formats include the record attributes.
import { Span } from "@opentelemetry/sdk-trace";
import { Config } from "../Config";
import { OTelTracer } from "../OTelContext";

export const ANALYTICS_EXPORT_DEFAULT_MAX_ROWS = 100_000;
export const ANALYTICS_EXPORT_MAX_ROWS_LIMIT = 1_000_000;
export const ANALYTICS_EXPORT_CHUNK_SIZE = 1_000;

export type AnalyticsExportFormat = "csv" | "jsonl";

let maxRows = ANALYTICS_EXPORT_DEFAULT_MAX_ROWS;

export async function AnalyticsExportInit(
  context: Span,
  configIn: Config,
): Promise<void> {
  const span = OTelTracer().startSpan("AnalyticsExportInit", context);
  const configured = Number(configIn.ANALYTICS_EXPORT_MAX_ROWS);
  maxRows =
    Number.isFinite(configured) && configured > 0
      ? Math.min(Math.trunc(configured), ANALYTICS_EXPORT_MAX_ROWS_LIMIT)
      : ANALYTICS_EXPORT_DEFAULT_MAX_ROWS;
  span.end();
}

export function AnalyticsExportGetMaxRows(): number {
  return maxRows;
}

export function AnalyticsExportParseFormat(
  value: unknown,
): AnalyticsExportFormat | null {
  const format = String(value ?? "csv").trim().toLowerCase();
  if (format === "csv" || format === "jsonl") {
    return format;
  }
  return null;
}

export function AnalyticsExportContentType(format: AnalyticsExportFormat): string {
  return format === "jsonl"
    ? "application/x-ndjson; charset=utf-8"
    : "text/csv; charset=utf-8";
}

// Spreadsheet applications execute cells that start with one of these
// characters; an apostrophe prefix makes them plain text instead.
export function AnalyticsExportNeutralizeFormula(value: string): string {
  return /^[=+\-@\t\r\n]/.test(value) ? "'" + value : value;
}

export function AnalyticsExportCsvField(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  const neutralized = AnalyticsExportNeutralizeFormula(text);
  if (/[",\n\r]/.test(neutralized)) {
    return '"' + neutralized.replace(/"/g, '""') + '"';
  }
  return neutralized;
}

export function AnalyticsExportCsvRow(values: unknown[]): string {
  return values.map(AnalyticsExportCsvField).join(",");
}

function AnalyticsExportTimestampNs(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }
  const date = new Date(numeric / 1_000_000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AnalyticsExportAttributesJson(attributes: any): string {
  if (attributes === undefined || attributes === null) {
    return "[]";
  }
  if (typeof attributes === "string") {
    return attributes;
  }
  return JSON.stringify(attributes);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AnalyticsExportAttributesValue(attributes: any): any {
  if (typeof attributes !== "string") {
    return attributes ?? [];
  }
  try {
    return JSON.parse(attributes);
  } catch {
    return [];
  }
}

export const ANALYTICS_EXPORT_LOGS_CSV_HEADER = AnalyticsExportCsvRow([
  "time",
  "severity",
  "serviceName",
  "serviceVersion",
  "traceId",
  "spanId",
  "logText",
  "attributes",
]);

export const ANALYTICS_EXPORT_TRACES_CSV_HEADER = AnalyticsExportCsvRow([
  "traceId",
  "startTime",
  "endTime",
  "duration",
  "serviceName",
  "serviceVersion",
  "name",
  "spanCount",
  "nbErrors",
  "attributes",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AnalyticsExportLogCsvRow(log: any): string {
  return AnalyticsExportCsvRow([
    AnalyticsExportTimestampNs(log.time),
    log.severity || "",
    log.serviceName || "",
    log.serviceVersion || "",
    log.traceId || "",
    log.spanId || "",
    log.logText || "",
    AnalyticsExportAttributesJson(log.attributes),
  ]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AnalyticsExportLogJsonl(log: any): string {
  return JSON.stringify({
    time: Number(log.time),
    severity: log.severity || "",
    serviceName: log.serviceName || "",
    serviceVersion: log.serviceVersion || "",
    traceId: log.traceId || "",
    spanId: log.spanId || "",
    logText: log.logText || "",
    attributes: AnalyticsExportAttributesValue(log.attributes),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AnalyticsExportTraceCsvRow(trace: any): string {
  const startTime = Number(trace.startTime);
  const endTime = Number(trace.endTime);
  const duration =
    Number.isFinite(startTime) && Number.isFinite(endTime)
      ? Math.round((endTime - startTime) / 1_000_000)
      : "";
  return AnalyticsExportCsvRow([
    trace.traceId || "",
    AnalyticsExportTimestampNs(trace.startTime),
    AnalyticsExportTimestampNs(trace.endTime),
    duration,
    trace.serviceName || "",
    trace.serviceVersion || "",
    trace.name || "",
    trace.spanCount ?? "",
    trace.nbErrors ?? "",
    AnalyticsExportAttributesJson(trace.attributes),
  ]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AnalyticsExportTraceJsonl(trace: any): string {
  const startTime = Number(trace.startTime);
  const endTime = Number(trace.endTime);
  return JSON.stringify({
    traceId: trace.traceId || "",
    startTime,
    endTime,
    duration:
      Number.isFinite(startTime) && Number.isFinite(endTime)
        ? endTime - startTime
        : null,
    serviceName: trace.serviceName || "",
    serviceVersion: trace.serviceVersion || "",
    name: trace.name || "",
    spanCount: Number(trace.spanCount ?? 0),
    nbErrors: Number(trace.nbErrors ?? 0),
    attributes: AnalyticsExportAttributesValue(trace.attributes),
  });
}

export interface AnalyticsExportCursor {
  time: number;
  id: string;
}

export interface AnalyticsExportStreamOptions<T> {
  format: AnalyticsExportFormat;
  maxRows: number;
  header: string;
  fetchChunk: (
    cursor: AnalyticsExportCursor | null,
    limit: number,
  ) => Promise<T[]>;
  cursorOf: (row: T) => AnalyticsExportCursor;
  toCsv: (row: T) => string;
  toJsonl: (row: T) => string;
}

// Yields the serialized export. The row cap is enforced by fetching at most
// `maxRows` rows (in chunks) and then probing one more row with a cheap
// keyset query: when it exists, an explicit truncation marker is appended so
// the receiver sees why the export ended.
export async function* AnalyticsExportStream<T>(
  options: AnalyticsExportStreamOptions<T>,
): AsyncGenerator<string> {
  const {
    format,
    maxRows,
    header,
    fetchChunk,
    cursorOf,
    toCsv,
    toJsonl,
  } = options;
  if (format === "csv") {
    yield header + "\r\n";
  }
  let emitted = 0;
  let cursor: AnalyticsExportCursor | null = null;
  while (emitted < maxRows) {
    const limit = Math.min(ANALYTICS_EXPORT_CHUNK_SIZE, maxRows - emitted);
    const rows = await fetchChunk(cursor, limit);
    if (!rows || rows.length === 0) {
      return;
    }
    for (const row of rows) {
      yield (format === "csv" ? toCsv(row) + "\r\n" : toJsonl(row) + "\n");
      emitted++;
      cursor = cursorOf(row);
    }
    if (rows.length < limit) {
      return;
    }
  }
  const probe = await fetchChunk(cursor, 1);
  if (probe && probe.length > 0) {
    yield format === "csv"
      ? `# export truncated at ${maxRows} rows (ANALYTICS_EXPORT_MAX_ROWS)\r\n`
      : JSON.stringify({
          __otel_light_export__: { truncated: true, maxRows },
        }) + "\n";
  }
}
