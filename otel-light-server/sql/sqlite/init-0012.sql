-- Make trace ingestion idempotent: an exporter retry of the same batch must
-- not duplicate spans. De-duplicate existing rows first (keep the oldest),
-- then enforce one row per (traceId, spanId).
DELETE FROM traces
WHERE rowid NOT IN (SELECT MIN(rowid) FROM traces GROUP BY traceId, spanId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_traces_traceid_spanid ON traces(traceId, spanId);
