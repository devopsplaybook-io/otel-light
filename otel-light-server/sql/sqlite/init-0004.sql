ALTER TABLE traces RENAME COLUMN atttributes TO attributes;
ALTER TABLE metrics RENAME COLUMN atttributes TO attributes;
ALTER TABLE logs RENAME COLUMN atttributes TO attributes;

ALTER TABLE logs ADD COLUMN traceId VARCHAR(50);
ALTER TABLE logs ADD COLUMN spanId VARCHAR(50);
