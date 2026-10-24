-- Make trace ingestion idempotent: an exporter retry of the same batch must
-- not duplicate spans. De-duplicate existing rows first (keep the oldest),
-- then enforce one row per (traceId, spanId).
DELETE FROM traces a USING traces b
WHERE a."traceId" = b."traceId" AND a."spanId" = b."spanId" AND a.ctid < b.ctid;
CREATE UNIQUE INDEX IF NOT EXISTS idx_traces_traceid_spanid ON traces("traceId", "spanId");
