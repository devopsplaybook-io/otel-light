-- Optional API-token metadata (capability-probed by common-utils): token
-- expiry and last-use timestamps. Existing rows get NULL = never expires /
-- never used. IF NOT EXISTS keeps the file re-runnable.
ALTER TABLE users_api_tokens ADD COLUMN IF NOT EXISTS "expiresAt" VARCHAR(50);
ALTER TABLE users_api_tokens ADD COLUMN IF NOT EXISTS "lastUsedAt" VARCHAR(50);
