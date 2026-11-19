-- Named search views. Each view stores the full search query string (filter
-- parameters plus the default `from`/`to` window) for one signal type.
-- Views are private to their owner unless `shared` is set, in which case any
-- authenticated user can read them; only the owner can rename or delete.
CREATE TABLE IF NOT EXISTS saved_views (
    id VARCHAR(50) NOT NULL,
    userId VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    signalType VARCHAR(20) NOT NULL,
    query TEXT NOT NULL,
    shared INTEGER NOT NULL DEFAULT 0,
    dateCreated VARCHAR(50) NOT NULL,
    dateUpdated VARCHAR(50) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views(userId, signalType);
CREATE INDEX IF NOT EXISTS idx_saved_views_shared ON saved_views(shared, signalType);
