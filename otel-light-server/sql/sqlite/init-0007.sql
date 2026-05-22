-- metrics: optimal index for DISTINCT name/serviceName/type lookup ordered by time range
-- time-first ordering enables index range scan, then skip-scan on the remaining columns
CREATE INDEX IF NOT EXISTS idx_metrics_time_names ON metrics(time, serviceName, name, type);
