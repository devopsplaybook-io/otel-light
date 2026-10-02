import * as fs from "fs-extra";
import * as path from "path";

// The common-utils migration runner reads `Number(MAX(value))` from
// metadata.type='db_version' and re-applies on every boot every init file
// whose version is above it. In Postgres `value` is VARCHAR, so once
// two-digit versions exist MAX('1'..'9','10','11') is lexicographically '9':
// all files from init-0010 onwards are re-executed at every startup. They
// must therefore stay re-runnable no matter how often they are applied.
// (SQLite stores the same values with INTEGER affinity, so its MAX is
// numeric and its files are applied only once - not covered by this guard.)
const FIRST_REAPPLIED_VERSION = 10;

const stripSqlComments = (sql: string): string =>
  sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

// Statements whose second application would fail. DML (UPDATE/DELETE, and
// INSERTs written defensively) is expected to be re-runnable by design.
const NON_IDEMPOTENT_PATTERNS: { description: string; regex: RegExp }[] = [
  {
    description: "CREATE TABLE without IF NOT EXISTS",
    regex: /\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/gi,
  },
  {
    description: "CREATE INDEX without IF NOT EXISTS",
    regex: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/gi,
  },
  {
    description: "ALTER TABLE ADD [COLUMN] without IF NOT EXISTS",
    regex:
      /\bALTER\s+TABLE\s+\S+\s+ADD\s+(?:COLUMN\s+)?(?!(?:COLUMN\s+)?IF\s+NOT\s+EXISTS)/gi,
  },
  {
    description: "DROP TABLE/INDEX without IF EXISTS",
    regex: /\bDROP\s+(?:TABLE|INDEX)\s+(?!IF\s+EXISTS)/gi,
  },
];

describe("Postgres migrations re-applied by the runner on every boot", () => {
  const sqlDir = path.join(__dirname, "../sql/postgres");

  it(`keeps every init-*.sql with version >= ${FIRST_REAPPLIED_VERSION} re-runnable`, () => {
    const files = fs
      .readdirSync(sqlDir)
      .filter((file) => {
        const match = /^init-(\d+)\.sql$/.exec(file);
        return match !== null && Number(match[1]) >= FIRST_REAPPLIED_VERSION;
      })
      .sort();
    expect(files.length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const file of files) {
      const sql = stripSqlComments(
        fs.readFileSync(path.join(sqlDir, file), "utf8"),
      );
      for (const { description, regex } of NON_IDEMPOTENT_PATTERNS) {
        const matches = sql.match(regex);
        if (matches) {
          problems.push(`${file}: ${description} -> ${matches.join(", ")}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("flags the non-idempotent statement shapes it is meant to catch", () => {
    const nonIdempotentSamples = [
      'ALTER TABLE logs ADD COLUMN "recordId" VARCHAR(50);',
      'ALTER TABLE logs ADD "recordId" VARCHAR(50);',
      "CREATE TABLE foo (a INTEGER);",
      "CREATE INDEX idx_foo ON foo(a);",
      "CREATE UNIQUE INDEX idx_foo ON foo(a);",
      "DROP TABLE foo;",
      "DROP INDEX idx_foo;",
    ];
    for (const sample of nonIdempotentSamples) {
      expect(
        NON_IDEMPOTENT_PATTERNS.some(({ regex }) => sample.match(regex)),
      ).toBe(true);
    }

    const idempotentSamples = [
      'ALTER TABLE logs ADD COLUMN IF NOT EXISTS "recordId" VARCHAR(50);',
      "CREATE TABLE IF NOT EXISTS foo (a INTEGER);",
      "CREATE INDEX IF NOT EXISTS idx_foo ON foo(a);",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_foo ON foo(a);",
      "DROP TABLE IF EXISTS foo;",
    ];
    for (const sample of idempotentSamples) {
      expect(
        NON_IDEMPOTENT_PATTERNS.some(({ regex }) => sample.match(regex)),
      ).toBe(false);
    }
  });
});
