-- Recreate corrupted idx_logs_traceId index
-- The B-tree index was found corrupted with a "right sibling's left-link doesn't match" error.
-- Dropping and recreating the index fixes the corruption cleanly.
DROP INDEX IF EXISTS idx_logs_traceId;
CREATE INDEX IF NOT EXISTS idx_logs_traceId ON logs("traceId");
