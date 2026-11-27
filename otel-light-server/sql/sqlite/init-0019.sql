-- metrics: per-series chart queries (GET /analytics/metrics) filter by
-- serviceName + name and scan a time range ordered by time. This composite
-- index serves that access pattern directly (equality prefix + time range),
-- avoiding a full-history scan per chart on large metrics tables.
CREATE INDEX IF NOT EXISTS idx_metrics_service_name_time ON metrics(serviceName, name, time);
