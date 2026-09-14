CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    passwordEncrypted VARCHAR(500) NOT NULL
);
-- role and scopes columns are added by init-0008.sql (SQLite has no
-- ADD COLUMN IF NOT EXISTS, so they must not be declared here too)
