-- Incremental rollups for service/version signal counts and metric names so
-- SelfMetrics and AnalyticsCache stop running full-table GROUP BY scans.
-- Maintained on ingestion (upsert) and on maintenance deletes (deltas);
-- populated once at startup by a recount when empty (first boot after upgrade).

CREATE TABLE IF NOT EXISTS signal_service_counts (
    signalType VARCHAR(20) NOT NULL,
    serviceName VARCHAR(2000) NOT NULL,
    serviceVersion VARCHAR(2000) NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    firstSeen INTEGER,
    lastSeen INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_service_counts_key
    ON signal_service_counts(signalType, serviceName, serviceVersion);

CREATE TABLE IF NOT EXISTS signal_metric_names (
    serviceName VARCHAR(2000) NOT NULL,
    name VARCHAR(2000) NOT NULL,
    type VARCHAR(50) NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    firstSeen INTEGER,
    lastSeen INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_metric_names_key
    ON signal_metric_names(serviceName, name, type);

-- Watermarks for chunked maintenance processing (e.g. duplicate-metric
-- compression progression over the historical backlog).
CREATE TABLE IF NOT EXISTS maintenance_state (
    stateKey VARCHAR(100) NOT NULL,
    stateValue VARCHAR(200) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_state_key
    ON maintenance_state(stateKey);

-- settings.category must be unique for the atomic PUT upsert. De-duplicate
-- defensively first (keeps the most recently inserted row per category).
DELETE FROM settings
WHERE rowid NOT IN (SELECT MAX(rowid) FROM settings GROUP BY category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
