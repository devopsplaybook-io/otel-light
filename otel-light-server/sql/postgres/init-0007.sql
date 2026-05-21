-- metrics: optimal index for DISTINCT name/serviceName/type lookup ordered by time range
-- time-first ordering enables index range scan, then skip-scan on the remaining columns
CREATE INDEX IF NOT EXISTS idx_metrics_time_names ON metrics("time", "serviceName", "name", "type");

-- metrics: GIN trigram indexes for LIKE '%term%' keyword search on name/serviceName
-- Used by GET /analytics/metrics/names?keywords=... to find matching metric names
CREATE INDEX IF NOT EXISTS idx_metrics_name_trgm ON metrics USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_metrics_serviceName_trgm ON metrics USING gin ("serviceName" gin_trgm_ops);