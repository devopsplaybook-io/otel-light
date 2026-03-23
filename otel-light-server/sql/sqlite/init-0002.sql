CREATE TABLE IF NOT EXISTS traces (
    traceId VARCHAR(50) NOT NULL,
    spanId VARCHAR(50) NOT NULL,
    parentSpanId VARCHAR(50),
    name VARCHAR(2000) NOT NULL,
    serviceName VARCHAR(2000) NOT NULL,
    serviceVersion VARCHAR(2000) NOT NULL,
    startTime INTEGER NOT NULL,
    endTime INTEGER NOT NULL,
    statusCode INTEGER NOT NULL,
    atttributes TEXT NOT NULL,
    rawSpan TEXT NOT NULL,
    keywords VARCHAR(4000) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_traces_startTime ON traces(startTime);
CREATE INDEX IF NOT EXISTS idx_traces_traceId ON traces(traceId);

CREATE TABLE IF NOT EXISTS metrics (
    name VARCHAR(2000) NOT NULL,
    serviceName VARCHAR(2000) NOT NULL,
    serviceVersion VARCHAR(2000) NOT NULL,
    type VARCHAR(50) NOT NULL,
    time INTEGER NOT NULL,
    atttributes TEXT NOT NULL,
    rawMetric TEXT NOT NULL,
    keywords VARCHAR(4000) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_time ON metrics(time);

CREATE TABLE IF NOT EXISTS logs (
    serviceName VARCHAR(2000) NOT NULL,
    serviceVersion VARCHAR(2000) NOT NULL,
    severity VARCHAR(50) NOT NULL,
    time INTEGER NOT NULL,
    logText TEXT NOT NULL,
    atttributes TEXT NOT NULL,
    keywords VARCHAR(4000) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(time);
