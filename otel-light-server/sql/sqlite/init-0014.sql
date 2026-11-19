-- Covering index for the root-span summary aggregate
-- (GET /api/analytics/traces/summary): the query filters parentSpanId IS
-- NULL and a startTime range, then groups by service/version/name and reads
-- statusCode/endTime. Keeping those columns in the index lets SQLite answer
-- the aggregate and the duration sample from the index without touching the
-- table (which also holds keywords/rawSpan). Re-runnable by design.
CREATE INDEX IF NOT EXISTS idx_traces_stats_summary ON traces(parentSpanId, startTime, traceId, spanId, serviceName, serviceVersion, name, statusCode, endTime);
