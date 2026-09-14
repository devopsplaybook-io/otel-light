-- User API tokens: only the SHA-256 hash of the token is stored
CREATE TABLE IF NOT EXISTS users_api_tokens (
    id VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    userId VARCHAR(50) NOT NULL,
    tokenHash VARCHAR(64) NOT NULL,
    dateCreated VARCHAR(50) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_tokens_tokenHash ON users_api_tokens (tokenHash);
CREATE INDEX IF NOT EXISTS idx_users_api_tokens_userId ON users_api_tokens (userId);
