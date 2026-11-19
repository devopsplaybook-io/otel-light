-- Optional API-token metadata (capability-probed by common-utils): token
-- expiry and last-use timestamps. Existing rows get NULL = never expires /
-- never used.
ALTER TABLE users_api_tokens ADD COLUMN expiresAt VARCHAR(50);
ALTER TABLE users_api_tokens ADD COLUMN lastUsedAt VARCHAR(50);
