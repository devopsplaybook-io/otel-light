-- Recreate idx_logs_traceId index for consistency with PostgreSQL migration
DROP INDEX IF EXISTS idx_logs_traceId;
CREATE INDEX IF NOT EXISTS idx_logs_traceId ON logs(traceId);
