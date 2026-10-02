-- Logs: unique record id used as keyset-pagination cursor tiebreaker.
-- Rows ingested before this migration get a deterministic legacy id so
-- ordering ("time" DESC, "recordId" DESC) stays a total order.
ALTER TABLE logs ADD COLUMN "recordId" VARCHAR(50);
UPDATE logs SET "recordId" = 'legacy-' || md5(ctid::text) WHERE "recordId" IS NULL;
CREATE INDEX IF NOT EXISTS idx_logs_time_recordid ON logs("time", "recordId");
