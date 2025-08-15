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
    rawSpan TEXT NOT NULL
);
