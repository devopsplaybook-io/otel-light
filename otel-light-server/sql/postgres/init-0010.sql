-- Logs: unique record id used as keyset-pagination cursor tiebreaker.
-- Rows ingested before this migration get a deterministic legacy id so
-- ordering ("time" DESC, "recordId" DESC) stays a total order.
-- IF NOT EXISTS: the common-utils runner re-applies this file on every boot
-- because metadata."value" is VARCHAR, so MAX('1'..'9','10') is
-- lexicographically '9' and every file above version 9 is re-executed
-- (see MigrationsIdempotency.spec.ts). The whole file must stay re-runnable.
ALTER TABLE logs ADD COLUMN IF NOT EXISTS "recordId" VARCHAR(50);
UPDATE logs SET "recordId" = 'legacy-' || md5(ctid::text) WHERE "recordId" IS NULL;
CREATE INDEX IF NOT EXISTS idx_logs_time_recordid ON logs("time", "recordId");
