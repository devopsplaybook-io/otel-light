-- Performance indexes for analytics queries

-- traces: serviceName/serviceVersion filtering combined with time-range scans
CREATE INDEX IF NOT EXISTS idx_traces_serviceName ON traces(serviceName, startTime);
CREATE INDEX IF NOT EXISTS idx_traces_serviceVersion ON traces(serviceVersion, startTime);
-- traces: parentSpanId used in self-JOIN to find root spans
CREATE INDEX IF NOT EXISTS idx_traces_parentSpanId ON traces(parentSpanId);
-- traces: covering index for DISTINCT serviceName/serviceVersion lookup
CREATE INDEX IF NOT EXISTS idx_traces_service_covering ON traces(serviceName, serviceVersion);

-- logs: serviceName/serviceVersion filtering combined with time-range scans
CREATE INDEX IF NOT EXISTS idx_logs_serviceName ON logs(serviceName, time);
CREATE INDEX IF NOT EXISTS idx_logs_serviceVersion ON logs(serviceVersion, time);
-- logs: traceId lookup used in /:traceId/logs endpoint
CREATE INDEX IF NOT EXISTS idx_logs_traceId ON logs(traceId);
-- logs: covering index for DISTINCT serviceName/serviceVersion lookup
CREATE INDEX IF NOT EXISTS idx_logs_service_covering ON logs(serviceName, serviceVersion);

-- metrics: serviceName/name filtering combined with time-range scans
CREATE INDEX IF NOT EXISTS idx_metrics_serviceName ON metrics(serviceName, time);
CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name, time);
-- metrics: covering index for DISTINCT serviceName/name/type lookup (GET /names endpoint)
CREATE INDEX IF NOT EXISTS idx_metrics_names_covering ON metrics(serviceName, name, type, time);
