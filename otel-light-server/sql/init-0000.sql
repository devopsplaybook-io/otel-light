CREATE TABLE IF NOT EXISTS metadata (
    type VARCHAR(100) NOT NULL,
    value INTEGER  NOT NULL,
    dateCreated VARCHAR(100) NOT NULL
);

-- 
DELETE FROM metadata WHERE type = 'db_version' and value > 1;

DROP TABLE IF EXISTS traces;
