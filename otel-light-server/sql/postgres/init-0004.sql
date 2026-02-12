ALTER TABLE traces RENAME COLUMN "atttributes" TO "attributes";
ALTER TABLE metrics RENAME COLUMN "atttributes" TO "attributes";
ALTER TABLE logs RENAME COLUMN "atttributes" TO "attributes";

ALTER TABLE logs ADD COLUMN IF NOT EXISTS "traceId" VARCHAR(50);
ALTER TABLE logs ADD COLUMN IF NOT EXISTS "spanId" VARCHAR(50);