# AGENTS.md

This file provides context for AI coding agents working on this repository.

## Repository Overview

**OTel Light** is a lightweight OpenTelemetry backend designed for development environments and home labs. It ingests traces, metrics, and logs via HTTP API, stores them in SQLite or PostgreSQL, and provides a web UI for visualization with analytics, maintenance, and optional LLM-powered recommendations.

The repository is a monorepo with three components:

| Component           | Technology                           | Port | Role                                                               |
| ------------------- | ------------------------------------ | ---- | ------------------------------------------------------------------ |
| `otel-light-server` | Node.js + Fastify + TypeScript       | 8080 | API server: OTLP ingestion, analytics, auth, maintenance           |
| `otel-light-web`    | Nuxt 3 (Vue 3)                       | 3000 | Static frontend (pre-rendered, served by the server)               |
| `otel-light-proxy`  | Traefik v2.9.6 (pre-compiled binary) | 9012 | Dev reverse proxy: routes `/api/` and `/v1/` to server, `/` to web |

In production, all three run inside a single Docker container. The server serves the pre-built web assets via `@fastify/static`, eliminating the need for the proxy. The proxy is only used in local development with PM2.

## Architecture

```
otel-light/
├── Dockerfile                         # Multi-stage: build server + web, then run server only
├── entrypoint.sh                      # Replaces APPLICATION_TITLE in manifest, runs `node dist/App.js`
├── ecosystem.config.js                # PM2 config for dev: proxy + server + web
├── env-dev.js                         # Dev environment overrides (DATA_DIR, OTel collector URLs)
├── package.json                        # Root package (for Docker build context)
├── otel-light-server/                  # --- API SERVER ---
│   ├── package.json
│   ├── config.json                     # Default config (CORS, DATABASE_TYPE=sqlite, JWT_KEY=dev)
│   ├── tsconfig.json                   # ES2020, CommonJS, strict:false
│   ├── tsconfig.spec.json              # Jest test config (includes jest types)
│   ├── jest.config.js                  # ts-jest, uuid mock, src/**/*.spec.ts
│   ├── eslint.config.mjs               # typescript-eslint strict + stylistic
│   ├── sql/
│   │   ├── sqlite/init-0000..0008.sql  # 9 migration files (CREATE tables, indexes, ALTER columns)
│   │   └── postgres/init-0000..0008.sql # Parallel migrations for PostgreSQL
│   └── src/
│       ├── App.ts                      # Entry point: config init, OTel setup, DB init, Fastify routes
│       ├── Config.ts                   # Extends ConfigBase from common-utils
│       ├── OTelContext.ts              # createOTelContext() re-export from common-utils
│       ├── Maintenance.ts              # Signal cleanup rules + metrics compression
│       ├── v1/                          # OTLP ingestion endpoints (traces, metrics, logs)
│       │   ├── SignalUtils.ts           # Auth header check, service name/version extraction
│       │   ├── logs/LogsRoutes.ts       # POST /v1/logs
│       │   ├── metrics/MetricsRoutes.ts # POST /v1/metrics
│       │   └── traces/TracesRoutes.ts   # POST /v1/traces
│       ├── analytics/                   # Query & visualization APIs
│       │   ├── AnalyticsCache.ts        # Cached service/metric lists with adaptive refresh
│       │   ├── AnalyticsLogsRoutes.ts   # GET /api/analytics/logs
│       │   ├── AnalyticsMetricsRoutes.ts # GET /api/analytics/metrics
│       │   ├── AnalyticsTracesRoutes.ts # GET /api/analytics/traces
│       │   ├── AnalyticsServicesRoutes.ts # GET /api/analytics/services
│       │   ├── AnalyticsStatsRoutes.ts  # GET /api/analytics (dashboard stats)
│       │   ├── SelfMetrics.ts           # Observable gauges: signal counts per service
│       │   └── AnalyticsUtils.ts        # Shared query helpers
│       ├── reports/                     # Scheduled reports & LLM recommendations
│       │   ├── Recommendation.ts        # LLM-powered daily analysis (DeepSeek/OpenAI-compatible)
│       │   ├── RecommendationRoutes.ts  # GET/POST /api/recommendation
│       │   ├── LongestTracesReport.ts  # Top N traces by duration (scheduled)
│       │   ├── MostCalledTracesReport.ts # Top N traces by frequency (scheduled)
│       │   ├── ReportsRoutes.ts        # GET/POST /api/reports/*
│       │   └── TraceGroupReportTypes.ts # Shared types for trace grouping
│       ├── settings/SettingsRoutes.ts  # GET/PUT /api/settings (maintenance rules)
│       ├── model/                       # Data models (Span, Trace, Log, Metric, Settings)
│       └── utils-std-ts/               # Re-exports from @devopsplaybook.io/common-utils
│           ├── DbUtils.ts              # → DbUtilsSetOTel, DbUtilsInit, DbUtilsExecSQL, DbUtilsQuerySQL, ...
│           ├── DbUtilsNoTelemetry.ts   # → DbUtilsNoTelemetrySetLogger, DbUtilsNoTelemetryBatchInsert, ...
│           ├── SystemCommand.ts        # → SystemCommandExecute
│           └── Timeout.ts              # → TimeoutWait
├── otel-light-web/                     # --- FRONTEND (Nuxt 3) ---
│   ├── app.vue                         # Root component with tab navigation
│   ├── nuxt.config.ts                  # SSR disabled, generate static output
│   ├── components/                     # Vue components (Trace, Log, Metric charts, SearchOptions)
│   └── pages/                          # Nuxt pages (traces, metrics, logs, settings, recommendation)
└── otel-light-proxy/                   # --- DEV PROXY (Traefik) ---
    ├── traefik-rules.yml               # Routes /api/ and /v1/ → :8080, / → :3000
    └── start.sh                        # Downloads Traefik binary if missing, runs on :9012
```

### Request Flow

**Ingestion** (OTLP HTTP):

```
Client → POST /v1/{traces|metrics|logs} → SignalUtilsCheckAuthHeader → parse OTLP JSON → DbUtilsNoTelemetryBatchInsert → DB
```

**Analytics** (web UI):

```
Browser → GET /api/analytics/* → AuthGetUserSession → DbUtilsQuerySQL (with OTel span) → JSON response
```

**LLM Recommendation** (scheduled via node-cron):

```
Cron trigger → collect stats (logs/traces/metrics) → POST to LLM API → cache result to <DATA_DIR>/recommendation.json → GET /api/recommendation serves cached
```

### Initialization Sequence (App.ts)

1. `new Config()` + `config.reload()` — loads from `config.json` then env vars
2. `OTelSetTracer(new StandardTracer(config))` — sets up OTel tracer
3. `OTelSetMeter(new StandardMeter(config))` — sets up OTel meter
4. `OTelLogger().initOTel(config)` — initializes OTel logger with collector URLs
5. `DbUtilsSetOTel(OTelTracer(), OTelLogger())` — inject OTel into DB utils
6. `DbUtilsNoTelemetrySetLogger(OTelLogger())` — inject logger into no-telemetry DB utils
7. `DbUtilsInit(span, config, sqlDir)` — run SQL migrations, open DB connection
8. `AuthSetOTel` / `UsersDataSetOTel` + `AuthInit(span, config, scopes)` (from common-utils) — register app scopes, generate or load JWT signing key from DB
9. `MaintenanceInit` — start signal cleanup + metrics compression scheduler
10. `SelfMetricsInit` — register observable gauges for signal counts
11. `AnalyticsCacheInit` — load cached analytics from file, start refresh scheduler
12. `RecommendationInit` — schedule LLM recommendation generation via cron
13. `LongestTracesReportInit` / `MostCalledTracesReportInit` — schedule static report generation
14. Register Fastify routes, start listening on `config.API_PORT`

## Database Schema

| Table      | Key Columns                                                                                                                     | Purpose                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `metadata` | type, value, dateCreated                                                                                                        | Migration tracking, auth token   |
| `users`    | id, name, passwordEncrypted, role, scopes                                                                                       | User accounts (role: admin/user) |
| `settings` | category, content (JSON)                                                                                                        | Maintenance rules, app settings  |
| `traces`   | traceId, spanId, parentSpanId, name, serviceName, serviceVersion, startTime, endTime, statusCode, attributes, rawSpan, keywords | Ingested trace spans             |
| `metrics`  | name, serviceName, serviceVersion, type, time, attributes, rawMetric, keywords                                                  | Ingested metric data points      |
| `logs`     | serviceName, serviceVersion, severity, time, logText, attributes, keywords, traceId, spanId                                     | Ingested log records             |

Migrations are in `sql/{sqlite|postgres}/init-NNNN.sql` (0000-0008). The `metadata` table tracks applied versions for idempotency. Both dialects have parallel migration files.

## Key Conventions

- **TypeScript**: Target ES2020, CommonJS output, `strict: false`, `noImplicitAny: false`. Spec files excluded from compilation.
- **ESLint**: `typescript-eslint` with `strict` and `stylistic` rule sets. `eslint-disable-next-line @typescript-eslint/no-explicit-any` is used frequently due to relaxed strict mode.
- **No default exports**: All modules use named exports only.
- **Route classes**: Each route module exports a class with a `getRoutes(fastify: FastifyInstance)` method, registered in `App.ts` with a prefix.
- **Module-level singletons**: Config, OTel tracer/meter/logger, and DB connection are stored as module-level variables, initialized once in `App.ts`.
- **Init pattern**: Each module exports an `*Init(context: Span, config: Config)` function called during startup. Modules that need periodic execution schedule their own timers.
- **SQL dual-dialect**: Queries are defined as objects with `sqlite` and `postgres` keys. SQLite uses `?` placeholders and unquoted identifiers; Postgres uses `$1, $2, ...` and double-quoted identifiers. The correct variant is selected at runtime via `DbUtilsGetType()`.
- **SQL queries co-located**: `SQL_QUERIES` constant at the bottom of each file that uses the database. Each query is a function or object keyed by database type.
- **Test mocking**: Tests use `jest.mock("../../utils-std-ts/DbUtils")` to mock the re-export modules. The mock file path intercepts all imports through that re-export. `jest.mock("uuid", ...)` is handled globally via `jest.config.js` `moduleNameMapper`.
- **Auth pattern**: `AuthGetUserSession(req)` for read access (returns session or null). `AuthMustBeAdmin(req, res)` for write access (throws on failure). `AuthHasScope(req, res, scope)` for scoped access.
- **common-utils adoption**: `utils-std-ts/` files are thin re-exports from `@devopsplaybook.io/common-utils`. Do not add implementations there — extend the shared library instead.

## Build and Verification

### Server (otel-light-server)

```bash
cd otel-light-server
npm install          # installs common-utils from local file:../_libs/common-utils
npm run build        # tsc → dist/
npm run lint         # eslint src
npm run test         # jest --coverage (9 suites, 76 tests)
```

### Web (otel-light-web)

```bash
cd otel-light-web
npm install
npm run dev          # Nuxt dev server on :3000
npm run generate     # Static generation → .output/public/
```

### Full Project (Docker)

```bash
docker build -t otel-light .
docker run -p 8080:8080 -v "$(pwd)/data:/data" otel-light
```

### Local Development (PM2)

```bash
# From project root
pm2 start ecosystem.config.js --env development
# Proxy:  http://localhost:9012  (routes to server :8080 and web :3000)
# Server: http://localhost:8080
# Web:    http://localhost:3000
```

All three checks (`build`, `lint`, `test`) must pass before committing. CI runs the same via reusable workflows from `common-utils`.

## CI/CD

GitHub Actions workflows are callers that reference reusable workflows from `devopsplaybook-io/common-utils`:

- **`main-build.yml`** (push to main): calls `reusable-merge-build.yml` — lint, test, build, Docker build with version tags, push to Docker Hub
- **`pr-check.yml`** (pull request): calls `reusable-pr-verify.yml` — matrix Node.js versions + multi-platform Docker build

Both pass `node_app_directories: '["otel-light-server"]'` to tell the reusable workflow where to find the Node.js application.

## Dependencies

### Server

| Package                                 | Role                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `@devopsplaybook.io/common-utils`       | Shared DB access (better-sqlite3/pg), ConfigBase, OTelContext, helpers |
| `@devopsplaybook.io/otel-utils`         | StandardTracer, StandardMeter, StandardLogger                          |
| `@devopsplaybook.io/otel-utils-fastify` | Fastify hooks for OTel request tracing                                 |
| `fastify`                               | Web framework (v5)                                                     |
| `@fastify/compress`                     | Gzip/deflate response compression                                      |
| `@fastify/cors`                         | CORS handling                                                          |
| `@fastify/multipart`                    | Multipart form parsing                                                 |
| `@fastify/static`                       | Static file serving (web assets in production)                         |
| `better-sqlite3`                        | Synchronous SQLite driver (via common-utils)                           |
| `pg`                                    | PostgreSQL client with connection pooling (via common-utils)           |
| `jsonwebtoken`                          | JWT generation and verification                                        |
| `bcrypt`                                | Password hashing                                                       |
| `uuid`                                  | UUID v4 generation (ESM — requires mock in tests)                      |
| `fs-extra`                              | Async file operations                                                  |
| `axios`                                 | HTTP client (LLM API calls)                                            |
| `node-cron`                             | Cron scheduling for LLM recommendations and static reports             |
| `node-schedule`                         | Job scheduling (alternative to node-cron)                              |
| `minimatch`                             | Glob pattern matching (maintenance rules)                              |

### Web

| Package       | Role                                         |
| ------------- | -------------------------------------------- |
| `nuxt`        | Nuxt 3 framework (Vue 3, SSR disabled)       |
| `apexcharts`  | Chart library for trace/metric visualization |
| `nuxtjs/apex` | Vue 3 wrapper for ApexCharts                 |

## Configuration

Config extends `ConfigBase` from common-utils with a 3-layer override: environment variables > `config.json` > defaults. Project-specific fields are registered via `addConfigField()` in the constructor.

Key config fields (in addition to those inherited from ConfigBase):

| Field                                        | Default                                     | Description                                    |
| -------------------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| `DATABASE_TYPE`                              | `sqlite`                                    | `sqlite` or `postgres`                         |
| `API_PORT`                                   | `8080`                                      | Server listen port (inherited from ConfigBase) |
| `CORS_POLICY_ORIGIN`                         | `*`                                         | CORS origin (empty = disabled)                 |
| `OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER` | (empty)                                     | Bearer token required for ingestion            |
| `OPENTELEMETRY_COLLECTOR_HTTP_*`             | `http://localhost:8080/v1/*`                | OTel collector endpoints (overridden in dev)   |
| `MAINTENANCE_FREQUENCY_HOURS`                | `6`                                         | How often maintenance runs                     |
| `METRICS_COMPRESS_MINUTE_THRESHOLD_HOURS`    | `12`                                        | Hours before minute-level compression          |
| `METRICS_COMPRESS_HOUR_THRESHOLD_DAYS`       | `7`                                         | Days before hour-level compression             |
| `CACHE_REFRESH_MINUTES`                      | `10`                                        | Analytics cache refresh interval               |
| `LLM_API_KEY`                                | (empty)                                     | API key for LLM (empty = disabled)             |
| `LLM_API_URL`                                | `https://api.deepseek.com/chat/completions` | OpenAI-compatible endpoint                     |
| `LLM_MODEL`                                  | `deepseek-chat`                             | Model name                                     |
| `LLM_ENABLE_THINKING`                        | `false`                                     | Thinking mode for reasoning LLM models         |
| `LLM_RECOMMENDATION_SCHEDULE_CRON`           | `0 0 * * *`                                 | Daily at midnight                              |
| `STATIC_REPORT_TOP_N`                        | `30`                                        | Top N traces for static reports                |
| `STATIC_REPORT_PERIOD_DAYS`                  | `30`                                        | Lookback period for static reports             |

## Known Gotchas

- **ConfigBase VERSION override**: `ConfigBase` reads its own `package.json` for `VERSION`, which returns common-utils' version. The `Config` constructor overrides `VERSION` by reading `otel-light-server/package.json` instead.
- **OTel collector URL defaults**: `ConfigBase` defaults OTel collector URLs to empty strings. The `Config` subclass overrides them to `http://localhost:8080/v1/*` via field initializers. In dev mode, `ecosystem.config.js` overrides them to `http://localhost:9999/v1/*`.
- **uuid ESM in tests**: `uuid` v14+ ships ESM. The `jest.config.js` maps `uuid` to `src/__mocks__/uuid.ts` globally. Tests that transitively import uuid work without additional mocking.
- **SQLite is synchronous**: `better-sqlite3` (used by common-utils) returns values synchronously, not Promises. Consuming code uses `await` which works on both synchronous values and Promises.
- **SQL_DIR path**: In dev mode, `__dirname` is `src/`; in production (compiled), it is `dist/`. The path `path.join(__dirname, '../sql/${config.DATABASE_TYPE}')` resolves correctly in both because `sql/` is a sibling of both `src/` and `dist/`.
- **Keywords column**: All signal tables have a `keywords` column (lowercased, space-separated) used for LIKE pattern matching in maintenance cleanup rules. Wildcards (`*`) are converted to `%` SQL wildcards at query time.
- **Raw JSON storage**: `rawSpan`, `rawMetric` columns store the full OTLP JSON for each signal. These are returned by analytics endpoints for client-side rendering.
- **Nanoseosecond timestamps**: OTel uses nanosecond timestamps. Maintenance calculations multiply JavaScript milliseconds by `1_000_000` to convert. Time-based queries use nanosecond ranges.
- **AnalyticsCache adaptive refresh**: The cache refreshes every 10 minutes when recently accessed (within 1 hour), otherwise every hour. This minimizes DB load during idle periods.
- **Single-container production**: In production, the server serves pre-built web assets via `@fastify/static`. The Traefik proxy is NOT used. Only `dist/`, `node_modules/`, `sql/`, `config.json`, and `web/` are copied into the Docker image.
- **Test mocks intercept re-exports**: Tests mock `../../utils-std-ts/DbUtils` etc., which are now re-export files. Jest intercepts the import at the re-export file path, so mocks work without changes. Do not mock `@devopsplaybook.io/common-utils` directly.
- **LLM thinking mode**: Reasoning/thinking models (e.g. DeepSeek `-flash`/`-pro` variants) spend `max_tokens` on their internal chain-of-thought, which can leave `content` empty and trigger "LLM returned an empty response." `Recommendation.ts` sends `thinking.type=disabled` by default; set `LLM_ENABLE_THINKING=true` only when chain-of-thought is wanted (also raises the request timeout).
