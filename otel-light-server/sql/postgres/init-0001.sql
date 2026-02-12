CREATE TABLE IF NOT EXISTS users (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "passwordEncrypted" VARCHAR(500) NOT NULL
);
