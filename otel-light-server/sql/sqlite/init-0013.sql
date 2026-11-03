-- Canonicalize log severity to the uppercase OTLP set so the list filter,
-- stats and error alerts can compare one exact value. The statements are
-- re-runnable: the WHERE predicates turn a second application into a no-op.
UPDATE logs
SET severity = SUBSTR(UPPER(TRIM(severity)), 1, 50)
WHERE severity <> SUBSTR(UPPER(TRIM(severity)), 1, 50);

-- Strip one trailing OTLP numeric suffix (WARN2 -> WARN) when the remaining
-- base is a canonical severity or a known alias. Custom values are kept.
UPDATE logs
SET severity = SUBSTR(severity, 1, LENGTH(severity) - 1)
WHERE LENGTH(severity) > 1
  AND SUBSTR(severity, LENGTH(severity), 1) IN ('1','2','3','4')
  AND SUBSTR(severity, 1, LENGTH(severity) - 1) IN (
    'TRACE','DEBUG','INFO','WARN','ERROR','FATAL',
    'WARNING','INFORMATION','NOTICE','ERR','CRITICAL','CRIT','ALERT','EMERG','EMERGENCY'
  );

-- Map common severity aliases onto the canonical set.
UPDATE logs
SET severity = CASE severity
  WHEN 'WARNING' THEN 'WARN'
  WHEN 'INFORMATION' THEN 'INFO'
  WHEN 'NOTICE' THEN 'INFO'
  WHEN 'ERR' THEN 'ERROR'
  WHEN 'CRITICAL' THEN 'FATAL'
  WHEN 'CRIT' THEN 'FATAL'
  WHEN 'ALERT' THEN 'FATAL'
  WHEN 'EMERG' THEN 'FATAL'
  WHEN 'EMERGENCY' THEN 'FATAL'
  ELSE severity
END
WHERE severity IN ('WARNING','INFORMATION','NOTICE','ERR','CRITICAL','CRIT','ALERT','EMERG','EMERGENCY');
