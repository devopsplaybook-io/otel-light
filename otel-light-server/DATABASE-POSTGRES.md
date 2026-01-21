# Database Configuration - PostgreSQL Support

The otel-light-server now supports both SQLite (default) and PostgreSQL databases.

## Configuration

### SQLite (Default)

SQLite is the default database and requires no additional configuration. The database file will be created at `${DATA_DIR}/database.db`.

```json
{
  "DATABASE_TYPE": "sqlite"
}
```

### PostgreSQL

To use PostgreSQL, configure the following settings in your `config.json` or via environment variables:

```json
{
  "DATABASE_TYPE": "postgres",
  "DATABASE_POSTGRES_HOST": "localhost",
  "DATABASE_POSTGRES_PORT": 5432,
  "DATABASE_POSTGRES_USER": "otel",
  "DATABASE_POSTGRES_PASSWORD": "your_password",
  "DATABASE_POSTGRES_DATABASE": "otel_light"
}
```

Environment variables:

- `DATABASE_TYPE` - Database type: `sqlite` or `postgres`
- `DATABASE_POSTGRES_HOST` - PostgreSQL server host
- `DATABASE_POSTGRES_PORT` - PostgreSQL server port
- `DATABASE_POSTGRES_USER` - PostgreSQL username
- `DATABASE_POSTGRES_PASSWORD` - PostgreSQL password
- `DATABASE_POSTGRES_DATABASE` - PostgreSQL database name

## Database Migration

### Migrating from SQLite to PostgreSQL

```bash
npm run migrate -- --from sqlite --to postgres
```

### Migrating from PostgreSQL to SQLite

```bash
npm run migrate -- --from postgres --to sqlite
```

The migration script will:

1. Read all data from the source database
2. Clear the destination database tables
3. Copy all rows to the destination database
4. Preserve all data including metadata, users, traces, metrics, logs, and settings

**Note:** Make sure to configure both database connections properly before running the migration.

## SQL Schema Files

### SQLite

SQL initialization files are located in `sql/` directory:

- `init-0000.sql` - Metadata table
- `init-0001.sql` - Users table
- `init-0002.sql` - Traces, metrics, and logs tables
- `init-0003.sql` - Settings table
- `init-0004.sql` - Schema updates

### PostgreSQL

PostgreSQL-specific SQL initialization files are located in `sql-postgres/` directory with equivalent schemas optimized for PostgreSQL.

## Implementation Details

### Database Abstraction Layer

The application uses a database abstraction layer (`DbUtils`) that automatically:

- Routes queries to the appropriate database implementation
- Converts SQLite placeholder syntax (`?`) to PostgreSQL syntax (`$1, $2, ...`)
- Maintains compatibility with existing code

### Key Files

- `src/utils-std-ts/DbUtils.ts` - Main database utility abstraction
- `src/utils-std-ts/SqlDbUtils.ts` - SQLite implementation
- `src/utils-std-ts/PostgresUtils.ts` - PostgreSQL implementation
- `src/utils-std-ts/DbUtilsNoTelemetry.ts` - No-telemetry wrapper for both databases
- `src/migrate-database.ts` - Database migration script

## PostgreSQL Setup

### Creating the Database

```sql
CREATE DATABASE otel_light;
CREATE USER otel WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE otel_light TO otel;
```

### Using Docker

```bash
docker run -d \
  --name postgres-otel \
  -e POSTGRES_USER=otel \
  -e POSTGRES_PASSWORD=otel \
  -e POSTGRES_DB=otel_light \
  -p 5432:5432 \
  postgres:16
```

## Switching Between Databases

1. Stop the server
2. Update `DATABASE_TYPE` in `config.json` or set environment variable
3. If migrating existing data, run the migration script
4. Start the server

The server will automatically initialize the appropriate database schema on startup.

## Notes

- SQLite is recommended for development and small deployments
- PostgreSQL is recommended for production with high data volumes
- Both databases support all features of otel-light-server
- The migration script does not automatically switch the configuration; update `config.json` after migration
