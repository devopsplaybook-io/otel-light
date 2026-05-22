-- Performance: pg_trgm extension for GIN trigram indexes on keyword search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- traces: partial index for root spans (parentSpanId IS NULL) ordered by time
-- enables instant index-only scan for the CTE roots query in AnalyticsTracesRoutes
CREATE INDEX IF NOT EXISTS idx_traces_rootspan_time ON traces("startTime") WHERE "parentSpanId" IS NULL;

-- traces: composite index for GROUP BY + ORDER BY on the child-span aggregation side
CREATE INDEX IF NOT EXISTS idx_traces_traceid_starttime ON traces("traceId", "startTime");

-- logs: GIN trigram index for LIKE '%term%' keyword search
CREATE INDEX IF NOT EXISTS idx_logs_keywords_trgm ON logs USING gin ("keywords" gin_trgm_ops);

-- traces: GIN trigram index for LIKE '%term%' keyword search on rootSpan keywords
CREATE INDEX IF NOT EXISTS idx_traces_keywords_trgm ON traces USING gin ("keywords" gin_trgm_ops);
