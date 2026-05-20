-- traces: composite index to find root spans (parentSpanId IS NULL) ordered by time
CREATE INDEX IF NOT EXISTS idx_traces_parentspanid_starttime ON traces(parentSpanId, startTime);

-- traces: composite index for GROUP BY + ORDER BY on the child-span aggregation side
CREATE INDEX IF NOT EXISTS idx_traces_traceid_starttime ON traces(traceId, startTime);

-- logs: composite index for serviceName + time queries (ordered by time first for range scans)
CREATE INDEX IF NOT EXISTS idx_logs_time_servicename ON logs(time, serviceName);

-- metrics: composite index for time + name queries
CREATE INDEX IF NOT EXISTS idx_metrics_time_name ON metrics(time, name);
