import { FastifyInstance } from "fastify";
import { DbUtilsGetType } from "../utils-std-ts/DbUtils";
import { DbUtilsNoTelemetryQuerySQL } from "../utils-std-ts/DbUtilsNoTelemetry";

const INSERT_CHUNK_ROWS = 500;
const SPAN_KEY_SEPARATOR = "\u0000";

export function SignalIngestionSpanKey(
  traceId: unknown,
  spanId: unknown,
): string {
  return `${String(traceId)}${SPAN_KEY_SEPARATOR}${String(spanId)}`;
}

// OTLP/HTTP exporters default to application/x-protobuf. otel-light only
// implements the JSON encoding, so reject every other content type with an
// actionable error instead of a generic parse failure.
export function SignalIngestionRegisterJsonProtocol(
  fastify: FastifyInstance,
): void {
  fastify.addContentTypeParser(
    "*",
    { parseAs: "string" },
    (_request, _body, done) => {
      const error = new Error(
        "Unsupported Content-Type. otel-light accepts OTLP/JSON only: set " +
          "OTEL_EXPORTER_OTLP_PROTOCOL=http/json (or " +
          "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL / OTEL_EXPORTER_OTLP_METRICS_PROTOCOL / " +
          "OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/json) on the exporter.",
      ) as Error & { statusCode: number };
      error.statusCode = 415;
      done(error);
    },
  );
}

// Inserts spans ignoring rows whose (traceId, spanId) already exists and
// returns the keys that were actually inserted, so callers can keep rollup
// counts exact when an exporter retries a batch.
export async function SignalIngestionInsertTracesIgnoreDuplicates(
  tableCols: string,
  numCols: number,
  rows: unknown[][],
): Promise<Set<string>> {
  const insertedKeys = new Set<string>();
  if (rows.length === 0) {
    return insertedKeys;
  }
  const dbType = DbUtilsGetType();
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_ROWS);
    const values = chunk
      .map(() => `(${Array.from({ length: numCols }, () => "?").join(",")})`)
      .join(",");
    const sql =
      dbType === "postgres"
        ? `INSERT ${tableCols} VALUES ${values} ON CONFLICT ("traceId", "spanId") DO NOTHING RETURNING "traceId", "spanId"`
        : `INSERT OR IGNORE ${tableCols} VALUES ${values} RETURNING "traceId", "spanId"`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertedRows: any[] = await DbUtilsNoTelemetryQuerySQL(
      sql,
      chunk.flat(),
    );
    for (const row of insertedRows) {
      insertedKeys.add(
        SignalIngestionSpanKey(row?.traceId, row?.spanId),
      );
    }
  }
  return insertedKeys;
}
