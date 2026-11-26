-- Cross-device "login with a code" (common-utils 2.12.0 LoginCodesStore).
-- Identical for SQLite and Postgres; IF NOT EXISTS keeps the Postgres file
-- re-runnable (guarded by MigrationsIdempotency.spec.ts).
CREATE TABLE IF NOT EXISTS "users_login_codes" (
  "id" TEXT PRIMARY KEY,
  "requestTokenHash" TEXT NOT NULL UNIQUE,
  "codeHash" TEXT NOT NULL,
  "previousCodeHash" TEXT,
  "codeExpiresAt" TEXT NOT NULL,
  "previousCodeExpiresAt" TEXT,
  "status" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "approvedAt" TEXT,
  "approvedByUserId" TEXT,
  "consumedAt" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "requestUserAgent" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_login_codes_code_hash" ON "users_login_codes" ("codeHash");
CREATE INDEX IF NOT EXISTS "users_login_codes_status_expires" ON "users_login_codes" ("status", "expiresAt");
