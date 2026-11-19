-- Alerting 2.0: per-rule lifecycle state (breach episode, notification and
-- repeat bookkeeping) and a persistent alert history linked to signals.
-- Both statements are re-runnable: SQLite applies the file once, PostgreSQL
-- files >= 0010 are re-executed on every boot (MigrationsIdempotency.spec.ts).

CREATE TABLE IF NOT EXISTS alert_rule_state (
    ruleId VARCHAR(100) NOT NULL,
    stateValue TEXT NOT NULL,
    updatedAt VARCHAR(50) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_rule_state_rule ON alert_rule_state(ruleId);

CREATE TABLE IF NOT EXISTS alert_events (
    id VARCHAR(50) NOT NULL,
    ruleId VARCHAR(100) NOT NULL,
    ruleName VARCHAR(200) NOT NULL,
    ruleType VARCHAR(30) NOT NULL,
    serviceName VARCHAR(2000) NOT NULL,
    status VARCHAR(20) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    observedValue REAL,
    thresholdValue REAL,
    message VARCHAR(2000) NOT NULL,
    signalType VARCHAR(20) NOT NULL,
    signalPath VARCHAR(50) NOT NULL,
    signalQuery VARCHAR(2000) NOT NULL,
    eventTime VARCHAR(50) NOT NULL,
    notifiedAt VARCHAR(50),
    error VARCHAR(2000)
);
CREATE INDEX IF NOT EXISTS idx_alert_events_time ON alert_events(eventTime);
CREATE INDEX IF NOT EXISTS idx_alert_events_rule ON alert_events(ruleId, eventTime);
CREATE INDEX IF NOT EXISTS idx_alert_events_status ON alert_events(status, eventTime);
