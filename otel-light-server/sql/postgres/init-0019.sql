-- metrics: per-series chart queries (GET /analytics/metrics) filter by
-- serviceName + name and scan a time range ordered by time. Existing
-- indexes only cover one equality column before "time" (or put "type"
-- between "name" and "time"), so PostgreSQL had to scan the metric's whole
-- history and sort. This composite index turns that into an ordered range
-- scan, which matters when a dashboard requests dozens of charts at once.
CREATE INDEX IF NOT EXISTS idx_metrics_service_name_time ON metrics("serviceName", "name", "time");
