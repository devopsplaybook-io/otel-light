# AGENTS.md

This file provides context for AI coding agents working on this repository.

## Repository Overview

**OTel Light** is a lightweight OpenTelemetry backend designed for development environments and home labs. It ingests traces, metrics, and logs via HTTP API, stores them in SQLite or PostgreSQL, and provides a web UI for visualization with analytics, maintenance, and optional LLM-powered recommendations.

The repository is a monorepo with three components:

| Component           | Technology                           | Port | Role                                                               |
| ------------------- | ------------------------------------ | ---- | ------------------------------------------------------------------ |
| `otel-light-server` | Node.js + Fastify + TypeScript       | 8080 | API server: OTLP ingestion, analytics, auth, maintenance           |
| `otel-light-web`    | Nuxt 4.6.4 (Vue 3)                   | 3000 | Static frontend (pre-rendered, served by the server)               |
| `otel-light-proxy`  | Traefik v2.11.63 (pre-compiled binary) | 9012 | Dev reverse proxy: routes `/api/` and `/v1/` to server, `/` to web |

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
│   ├── config.json                     # Default config (DATABASE_TYPE=sqlite, processor names)
│   ├── tsconfig.json                   # ES2020, CommonJS, strict:false
│   ├── tsconfig.spec.json              # Jest test config (includes jest types)
│   ├── jest.config.js                  # @swc/jest transform, v8 coverage, uuid mock, src/**/*.spec.ts
│   ├── sql/
│   │   ├── sqlite/init-0000..0017.sql  # 18 migration files (CREATE tables, indexes, ALTER columns, data backfills)
│   │   └── postgres/init-0000..0017.sql # Parallel migrations for PostgreSQL
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
│       │   ├── AnalyticsFilters.ts      # Shared keyword/attribute/status/duration parsing + dual-dialect SQL
│       │   ├── AnalyticsLogsRoutes.ts   # GET /api/analytics/logs, /api/analytics/logs/export
│       │   ├── AnalyticsMetricsRoutes.ts # GET /api/analytics/metrics
│       │   ├── AnalyticsTracesRoutes.ts # GET /api/analytics/traces, /api/analytics/traces/export
│       │   ├── AnalyticsServicesRoutes.ts # GET /api/analytics/services
│       │   ├── AnalyticsStatsRoutes.ts  # GET /api/analytics (dashboard stats)
│       │   ├── AnalyticsExport.ts       # Streamed CSV/JSONL export helpers (cap, neutralization)
│       │   ├── SelfMetrics.ts           # Observable gauges: signal counts per service
│       │   └── AnalyticsUtils.ts        # Shared query helpers
│       ├── savedviews/SavedViewsRoutes.ts # GET/POST/PATCH/DELETE /api/saved-views
│       ├── reports/                     # Scheduled reports & LLM recommendations
│       │   ├── Recommendation.ts        # LLM-powered daily analysis (DeepSeek/OpenAI-compatible)
│       │   ├── RecommendationRoutes.ts  # GET/POST /api/recommendation
│       │   ├── LongestTracesReport.ts  # Top N traces by duration (scheduled)
│       │   ├── MostCalledTracesReport.ts # Top N traces by frequency (scheduled)
│       │   ├── ReportsRoutes.ts        # GET/POST /api/reports/*
│       │   └── TraceGroupReportTypes.ts # Shared types for trace grouping
│       ├── settings/SettingsRoutes.ts  # GET/PUT /api/settings (maintenance rules)
│       ├── model/                       # Data models (Span, Trace, Log, Metric, Settings, SavedView)
│       └── utils-std-ts/               # Re-exports from @devopsplaybook.io/common-utils
│           ├── DbUtils.ts              # → DbUtilsSetOTel, DbUtilsInit, DbUtilsExecSQL, DbUtilsQuerySQL, ...
│           ├── DbUtilsNoTelemetry.ts   # → DbUtilsNoTelemetrySetLogger, DbUtilsNoTelemetryBatchInsert, ...
│           ├── SystemCommand.ts        # → SystemCommandExecute
│           └── Timeout.ts              # → TimeoutWait
├── otel-light-web/                     # --- FRONTEND (Nuxt 4) ---
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

Ingestion accepts **OTLP/JSON only** (`application/json`): Protobuf payloads are rejected with HTTP 415. Bodies larger than `INGESTION_BODY_LIMIT_BYTES` are rejected with HTTP 413; request payload compression is not supported.

**Analytics** (web UI):

```
Browser → GET /api/analytics/* → AuthHasScope guard → DbUtilsQuerySQL (with OTel span) → JSON response
```

**LLM Recommendation** (scheduled via node-schedule):

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
7. `SignalUtilsInit` — ingestion auth header + body limit
8. `AnalyticsUtilsInit` — apply `ANALYTICS_UTILS_RESULT_LIMIT_METRICS`
9. `AnalyticsStatsInit` — apply traces-stats sample cap / cache TTL / max entries, clear the cache
10. `AnalyticsExportInit` — apply `ANALYTICS_EXPORT_MAX_ROWS`
11. `DbUtilsInit(span, config, sqlDir)` — run SQL migrations, open DB connection
12. `AuthSetOTel` / `UsersDataSetOTel` + `AuthInit(span, config, scopes)` (from common-utils) — register app scopes, generate or load JWT signing key from DB
13. `SignalRollupsInit` — one-time recount of the incremental rollups when empty
14. `MaintenanceInit` — start signal cleanup + metrics compression scheduler
15. `SelfMetricsInit` — register observable gauges for signal counts
16. `AnalyticsCacheInit` — load cached analytics from file, refresh, start refresh scheduler
17. `RecommendationInit` — schedule LLM recommendation generation via cron
18. `LongestTracesReportInit` / `MostCalledTracesReportInit` — schedule static report generation
19. Register Fastify routes, start listening on `config.API_PORT`

## Database Schema

| Table      | Key Columns                                                                                                                     | Purpose                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `metadata` | type, value, dateCreated                                                                                                        | Migration tracking, auth token   |
| `users`    | id, name, passwordEncrypted, role, scopes                                                                                       | User accounts (role: admin/user) |
| `settings` | category, content (JSON)                                                                                                        | Maintenance rules, app settings  |
| `traces`   | traceId, spanId, parentSpanId, name, serviceName, serviceVersion, startTime, endTime, statusCode, attributes, rawSpan, keywords | Ingested trace spans             |
| `metrics`  | name, serviceName, serviceVersion, type, time, attributes, rawMetric, keywords                                                  | Ingested metric data points      |
| `logs`     | serviceName, serviceVersion, severity, time, logText, attributes, keywords, traceId, spanId                                     | Ingested log records             |
| `saved_views` | id, userId, name, signalType, query, shared, dateCreated, dateUpdated                                                        | Named search views (private or shared) |
| `alert_rule_state` | ruleId (PK), stateValue (JSON), updatedAt                                                                              | Alert rule lifecycle/state (alerting 2.0) |
| `alert_events` | id, ruleId, ruleName, ruleType, serviceName, status, severity, observedValue, thresholdValue, message, signalType, signalPath, signalQuery, eventTime, notifiedAt, error | Alert history (fired/notified/resolved/suppressed/error) |

Migrations are in `sql/{sqlite|postgres}/init-NNNN.sql` (0000-0017). The `metadata` table tracks applied versions for idempotency. Both dialects have parallel migration files.

## Key Conventions

- **TypeScript**: Target ES2020, CommonJS output, `strict: false`, `noImplicitAny: false`. Spec files are excluded from the emitted build but type-checked by `npm run build` (`tsc -p tsconfig.spec.json --noEmit`). Compiled with the TypeScript 7 native compiler (`typescript ^7.0.2`).
- **Linting**: `oxlint` with the recommended preset (`npm run lint` → `oxlint src`). `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments remain in the source but are inert under the oxlint preset.
- **No default exports**: All modules use named exports only.
- **Route classes**: Each route module exports a class with a `getRoutes(fastify: FastifyInstance)` method, registered in `App.ts` with a prefix.
- **Module-level singletons**: Config, OTel tracer/meter/logger, and DB connection are stored as module-level variables, initialized once in `App.ts`.
- **Init pattern**: Each module exports an `*Init(context: Span, config: Config)` function called during startup. Modules that need periodic execution schedule their own timers.
- **SQL dual-dialect**: Queries are defined as objects with `sqlite` and `postgres` keys. SQLite uses `?` placeholders and unquoted identifiers; Postgres uses `$1, $2, ...` and double-quoted identifiers. The correct variant is selected at runtime via `DbUtilsGetType()`.
- **SQL queries co-located**: `SQL_QUERIES` constant at the bottom of each file that uses the database. Each query is a function or object keyed by database type.
- **Test mocking**: Tests use `jest.mock("../../utils-std-ts/DbUtils")` to mock the re-export modules. The mock file path intercepts all imports through that re-export. `jest.mock("uuid", ...)` is handled globally via `jest.config.js` `moduleNameMapper`.
- **Auth pattern**: authorization goes through the common-utils guards — `AuthHasScope(req, res, scope)` for scoped reads, `AuthMustBeAdmin(req, res)` for write access, `AuthMustBeAuthenticated(req, res)` plus `AuthGetLiveUser(req)` when several scopes grant access. The guards answer **401 `UNAUTHENTICATED`** when there is no live user and **403 `FORBIDDEN`** when the live user lacks the scope or role; they **send the response and then throw**, so every call site must wrap the guard in `try/catch` and `return` from the catch block. `AuthGetUserSession(req)` returns JWT claims only: display, never authorization (see Gotchas).
- **common-utils adoption**: `utils-std-ts/` files are thin re-exports from `@devopsplaybook.io/common-utils`. Do not add implementations there — extend the shared library instead.

## Build and Verification

### Server (otel-light-server)

```bash
cd otel-light-server
npm install          # installs @devopsplaybook.io/common-utils from npm (^2.9.2)
npm run build        # tsc → dist/ + type-check of spec files (tsconfig.spec.json --noEmit)
npm run lint         # oxlint src (recommended preset)
npm run test         # jest --coverage (@swc/jest transform, v8 coverage provider)
```

### Web (otel-light-web)

```bash
cd otel-light-web
npm install
npm run dev          # Nuxt dev server on :3000
npm run lint         # eslint . (must report 0 warnings)
npm run test         # vitest run
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

- **`main-build.yml`** (push to main): calls `reusable-merge-build.yml` — promotes the image validated by the merged pull request to the version, major, minor, `latest` and `beta` tags (no build); a full build is only the fallback when no verified PR image can be promoted
- **`pr-check.yml`** (pull request): calls `reusable-pr-verify.yml` — version check, Node.js build/lint/test, dependency audit, and one multi-platform Docker build pushing `beta-pr-<PR number>` and `beta`, reusing a shared registry layer cache

Both pass `node_app_directories: '["otel-light-server", "otel-light-web"]'` to tell the reusable workflow where to find the Node.js applications.

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
| `@fastify/rate-limit`                   | Per-route rate limiting (ingestion and login)                          |
| `@fastify/static`                       | Static file serving (web assets in production)                         |
| `better-sqlite3`                        | Synchronous SQLite driver (via common-utils)                           |
| `pg`                                    | PostgreSQL client with connection pooling (via common-utils)           |
| `jsonwebtoken`                          | JWT generation and verification                                        |
| `bcrypt`                                | Password hashing                                                       |
| `uuid`                                  | UUID v4 generation (ESM — requires mock in tests)                      |
| `@opentelemetry/sdk-trace`              | `Span` type for the init-span parameter passed through the app         |
| `fs-extra`                              | Async file operations                                                  |
| `axios`                                 | HTTP client (LLM API calls)                                            |
| `node-schedule`                         | Cron scheduling for recommendations, reports and maintenance           |

### Web

| Package                | Role                                                |
| ---------------------- | --------------------------------------------------- |
| `nuxt` (4.6.4)         | Nuxt 4 framework (Vue 3, SSR disabled)              |
| `vue3-apexcharts`      | Vue 3 wrapper for ApexCharts                        |
| `apexcharts`           | Chart library for trace/metric visualization         |
| `pinia` / `@pinia/nuxt`| Authentication and services stores                  |
| `axios`                | HTTP client for non-queued API calls                |
| `marked` / `dompurify` | Markdown rendering, sanitized before `v-html`       |
| `jwt-decode`           | Client-side JWT expiry/role/scope inspection        |
| `@vueuse/core`         | Vue composition utilities                           |
| `mitt`                 | Event bus for UI notifications                      |
| `@picocss/pico`        | Base CSS framework                                  |
| `bootstrap-icons`      | Icon set used by the navigation and cards           |

## Configuration

Config extends `ConfigBase` from common-utils with a 3-layer override: environment variables > `config.json` > defaults. Project-specific fields are registered via `addConfigField()` in the constructor.

Key config fields (in addition to those inherited from ConfigBase):

| Field                                        | Default                                     | Description                                    |
| -------------------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| `DATABASE_TYPE`                              | `sqlite`                                    | `sqlite` or `postgres`                         |
| `API_PORT`                                   | `8080`                                      | Server listen port (inherited from ConfigBase) |
| `CORS_POLICY_ORIGIN`                         | (empty)                                     | CORS allowed origin; empty = CORS disabled     |
| `OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER` | (empty)                                     | Bearer token required for ingestion            |
| `INGESTION_BODY_LIMIT_BYTES`                 | `1048576`                                   | Max OTLP/JSON body size (clamped 1024–16777216); over-limit requests get 413 |
| `INGESTION_RATE_LIMIT_MAX`                   | `3000`                                      | Max ingestion requests per client IP per window (0 = disabled) |
| `INGESTION_RATE_LIMIT_WINDOW_SECONDS`        | `60`                                        | Ingestion rate-limit window (clamped 1–86400)  |
| `LOGIN_RATE_LIMIT_MAX`                       | `10`                                        | Max login attempts per client IP + username per window (0 = disabled) |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS`            | `60`                                        | Login rate-limit window (clamped 1–86400)      |
| `API_TRUST_PROXY`                            | `false`                                     | Trust `X-Forwarded-For` (only behind a trusted proxy) |
| `OPENTELEMETRY_COLLECTOR_HTTP_*`             | `http://localhost:8080/v1/*`                | OTel collector endpoints (overridden in dev)   |
| `MAINTENANCE_FREQUENCY_HOURS`                | `6`                                         | How often maintenance runs                     |
| `MAINTENANCE_ORPHAN_LOOKBACK_HOURS`          | `24`                                        | Lookback window for orphan-span cleanup scans  |
| `METRICS_COMPRESS_MINUTE_THRESHOLD_HOURS`    | `12`                                        | Hours before minute-level compression          |
| `METRICS_COMPRESS_HOUR_THRESHOLD_DAYS`       | `7`                                         | Days before hour-level compression             |
| `CACHE_REFRESH_MINUTES`                      | `10`                                        | Analytics cache refresh interval               |
| `METRICS_SELF_REFRESH_MINUTES`               | `10`                                        | Refresh interval for the self-metrics gauges   |
| `ANALYTICS_UTILS_RESULT_LIMIT_METRICS`       | `10000`                                     | Metrics query result limit (applied by `AnalyticsUtilsInit`) |
| `ANALYTICS_STATS_SAMPLE_CAP`                 | `20000`                                     | Max traces sampled for traces-stats percentiles |
| `ANALYTICS_STATS_CACHE_TTL_SECONDS`          | `30`                                        | Traces-stats response cache TTL (0 = off)      |
| `ANALYTICS_STATS_CACHE_MAX_ENTRIES`          | `100`                                       | Traces-stats response cache size               |
| `ANALYTICS_EXPORT_MAX_ROWS`                  | `100000`                                    | Hard cap on rows per streamed analytics export (clamped 1–1,000,000) |
| `LLM_API_KEY`                                | (empty)                                     | API key for LLM (empty = disabled)             |
| `LLM_API_URL`                                | `https://api.deepseek.com/chat/completions` | OpenAI-compatible endpoint                     |
| `LLM_MODEL`                                  | `deepseek-chat`                             | Model name                                     |
| `LLM_THINKING_MODE`                          | `disabled`                                  | `disabled`/`enabled`/`omit` (see gotcha below) |
| `LLM_RECOMMENDATION_SCHEDULE_CRON`           | `20 0 * * *`                                | Daily recommendation generation                |
| `LLM_RECOMMENDATION_PERIOD_HOURS`            | `24`                                        | Hours of telemetry included in each report     |
| `LLM_RECOMMENDATION_SAMPLE_CAP`              | `20000`                                     | Max root spans sampled for percentiles         |
| `LLM_RECOMMENDATION_TIMEOUT_SECONDS`         | `180`                                       | Overall budget for all LLM attempts/retries    |
| `LLM_RECOMMENDATION_STARTUP_DELAY_MINUTES`   | `2`                                         | Delay before initial recommendation generation |
| `STATIC_REPORT_SCHEDULE_CRON`                | `40 0 * * *`                                | Longest-traces report schedule                 |
| `MOST_CALLED_TRACES_SCHEDULE_CRON`           | `0 1 * * *`                                 | Most-called-traces report schedule             |
| `LONGEST_TRACES_STARTUP_DELAY_MINUTES`       | `15`                                        | Delay before initial longest-traces report     |
| `MOST_CALLED_TRACES_STARTUP_DELAY_MINUTES`   | `25`                                        | Delay before initial most-called-traces report |
| `SCHEDULED_JOB_JITTER_MINUTES`               | `5`                                         | Random delay after a heavy job's cron fire     |
| `SCHEDULED_JOB_OVERLAP_WAIT_MINUTES`         | `30`                                        | Wait before skipping an overlapping heavy job  |
| `NOTIFICATIONS_API`                          | (empty)                                     | Notifications API endpoint; empty = disabled   |
| `NOTIFICATIONS_TOKEN`                        | (empty)                                     | Notifications API token                        |
| `ERROR_ALERTS_EVALUATION_FREQUENCY_MINUTES`  | `15`                                        | Error alert rule evaluation frequency           |
| `ERROR_ALERTS_STARTUP_DELAY_MINUTES`         | `1`                                         | Delay before the first error alert evaluation  |
| `STATIC_REPORT_TOP_N`                        | `30`                                        | Top N traces for static reports                |
| `STATIC_REPORT_PERIOD_DAYS`                  | `30`                                        | Lookback period for static reports             |

## Known Gotchas

- **ConfigBase VERSION override**: `ConfigBase` reads its own `package.json` for `VERSION`, which returns common-utils' version. The `Config` constructor overrides `VERSION` by reading `otel-light-server/package.json` instead.
- **ConfigBase rejects invalid values (common-utils 2.x)**: an env/config-file value that does not coerce to the type of its default makes `reload()` reject instead of being applied as a string. `Config.reload()` restores `JWT_KEY` in a `finally` block so a rejected reload can never leave the config-file key in place, and the `watchFile` handler only logs the error: the server keeps running with the configuration it had (partially applied fields included), so a bad `config.json` edit does not crash a running instance.
- **Live authorization (common-utils 2.x)**: the guards read the user from the database on every request, so a demoted admin, a revoked scope or a deleted user takes effect on the next request. `AuthGetUserSession()` still returns the JWT claims and the web store uses them for the UI only — an authorization decision must always come from a guard or `AuthGetLiveUser()`. Login failures answer 401 `INVALID_CREDENTIALS`, so `SessionRenewalIsAuthError` treats 401 and 403 alike.
- **Session policy:** `JWT_VALIDITY_DURATION` (30 days, sliding) and `JWT_SESSION_MAX_DURATION` (90 days, absolute cap) follow `docs/auth-session-policy.md` in common-utils. `App.ts` calls `AuthSessionPolicyLog(config, { app: "otel-light", ... })` after `reload()` so the effective values and any policy violation are logged at startup. `Config.spec.ts` locks the values and parses the doc table.
- **Session lifetime and API-token exchange (common-utils >= 2.10.1)**: access tokens default to **30 days** (`JWT_VALIDITY_DURATION`) and the absolute session lifetime `JWT_SESSION_MAX_DURATION` caps the whole session at **90 days** from the first login (`<= 0` disables), and JWTs carry `iss`/`aud` plus a random `jti`. An API token can no longer be exchanged for a JWT: `POST /users/session` and `POST /users/session/refresh` answer 403 `FORBIDDEN` for API-token credentials (API tokens still authenticate every other endpoint directly), so the web UI keeps signing in with name and password and relies on `SessionRenewal`, which renews on startup, on focus/visibilitychange and when less than 20% of the token lifetime remains. `/users/status/initialization` is now rate limited. From 2.8.0 user names are validated at the request boundary (max 64 chars, `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`), so an account whose name is outside that pattern can no longer log in.
- **OTel collector URL defaults**: `ConfigBase` defaults OTel collector URLs to empty strings. The `Config` subclass overrides them to `http://localhost:8080/v1/*` via field initializers. In dev mode, `ecosystem.config.js` overrides them to `http://localhost:9999/v1/*`.
- **uuid ESM in tests**: `uuid` v14+ ships ESM. The `jest.config.js` maps `uuid` to `src/__mocks__/uuid.ts` globally. Tests that transitively import uuid work without additional mocking.
- **SQLite is synchronous**: `better-sqlite3` (used by common-utils) returns values synchronously, not Promises. Consuming code uses `await` which works on both synchronous values and Promises.
- **SQL_DIR path**: In dev mode, `__dirname` is `src/`; in production (compiled), it is `dist/`. The path `path.join(__dirname, '../sql/${config.DATABASE_TYPE}')` resolves correctly in both because `sql/` is a sibling of both `src/` and `dist/`.
- **Keywords column**: All signal tables have a `keywords` column (lowercased, space-separated) used for LIKE pattern matching in maintenance cleanup rules. `*` is the only wildcard; `MaintenanceFormatRetentionPattern` escapes `\`, `%` and `_` and every rule query uses `LIKE ? ESCAPE '\'`, so those characters compare literally.
- **Atomic JSON writes**: analytics cache and report/recommendation files are written with `FileUtilsWriteJsonAtomic` (serialize → temp file → fsync → rename). A failed serialization or crash never truncates the previous file; do not use `fs.writeJson` directly for these caches.
- **Scheduled heavy jobs**: maintenance, LLM recommendation and static reports run through `ScheduledJobRunDelayed` / `ScheduledJobRegisterCron`, which add `SCHEDULED_JOB_JITTER_MINUTES` of random delay and serialize with an in-process mutex (`ScheduledJobRunExclusive`, waits up to `SCHEDULED_JOB_OVERLAP_WAIT_MINUTES` then skips). There is no distributed lock: the guard assumes a single server instance, and the staggered cron defaults mitigate cross-instance overlap.
- **Traces-stats determinism**: `/api/analytics/traces/stats` rounds windows to whole minutes and samples with a deterministic stride (`ANALYTICS_STATS_SAMPLE_CAP`), so percentiles are stable across identical requests. Responses are cached by rounded window + filters (`ANALYTICS_STATS_CACHE_TTL_SECONDS`, max entries). The cache module defaults to TTL 0 until `AnalyticsStatsInit` runs, keeping tests isolated.
- **Traces summary semantics**: `/api/analytics/traces/summary` (home KPI strip, Aggregated view) aggregates root spans only (`parentSpanId IS NULL`), so `traceCount`/`avgDuration`/P90/P95 describe whole traces and `nbErrors` counts traces whose root span failed. This intentionally differs from `/traces/stats`, which aggregates every matching span; `errorsOnly=true` keeps the list semantics (a trace is included when any span errored). Both routes share `buildTracesRootsFilter`, the gzip+`AnalyticsStatsCache` contract and the deterministic stride sample; the cache key tags the summary mode so a stats request with an exact `name` cannot collide with a summary request. `init-0014` adds the covering `idx_traces_stats_summary` index used by both. Do not switch the summary to an all-span join without re-measuring the 24 h latency budget.
- **Analytics filters and bounds**: paging `offset` is parsed with `AnalyticsUtilsParseOffset` (integer `[0, 1_000_000]`, 400 otherwise) and `LIMIT`/`OFFSET` are bound — never interpolate them. Every analytics `keywords` LIKE uses `ESCAPE '\'` with `AnalyticsUtilsEscapeLike`, so `%`/`_`/`\` match literally. `/logs/stats` defaults `from` to 24 h ago and rejects `bucketNs` below 1 s or windows over 1,000 buckets. `/traces/stats` and `/traces/summary` accept the same filters as `/traces`, and the cache key must include `AnalyticsFiltersFingerprint` of them.
- **Structured search filters (`AnalyticsFilters.ts`)**: list, stats, summary and export routes all build their `WHERE` through the same module. `keywords` is split into terms (quoted phrases keep spaces) and ANDed as literal `LIKE … ESCAPE '\'` predicates. `attr` is repeatable `key:op[:value]` with `=`, `!=`, `contains`, `exists` (max 20 filters, key ≤256, value ≤4096); SQL is dual-dialect over the OTLP KeyValue array — SQLite `json_each`/`json_extract`, Postgres `jsonb_array_elements`/`#>>`. `contains` is case-insensitive, `!=` also matches rows without the key, and trace `durationMin`/`durationMax` (ms) filter on the whole trace via `MAX(endTime)-MIN(startTime)` against root spans. No expression indexes are created on `attributes` (documented in the README); changing this SQL means updating the parser/builder tests for both dialects.
- **Saved views**: `saved_views` (migration `init-0015`) stores the API query string (absolute ns bounds) per user; listing returns own **or** `shared` views, while rename/delete are owner-only (404 unknown, 403 other owner). The web `SearchQueryStateFromParams` converts stored absolute bounds back to the seconds-ago route window, so applying a view keeps its time window. The URL remains the source of truth — a view is applied by replacing the route query.
- **Streamed analytics export**: `/api/analytics/{logs,traces}/export` sends `Readable.from` async generators over keyset chunks (`(time, recordId)` / `(startTime, traceId)`, 1,000 rows), newest first; nothing is buffered. `ANALYTICS_EXPORT_MAX_ROWS` caps rows, and since headers are sent before the first chunk the response always carries `X-Export-Max-Rows`/`X-Export-Format` (CORS `exposedHeaders`) and a trailing truncation marker inside the body. CSV keeps the formula neutralization from the client exporter and includes `attributes`; JSONL emits attributes as parsed arrays. `format` must be `csv` or `jsonl`, and the route `scope` must match the signal type.
- **Metric series identity**: `metrics.attributes` stores canonicalized resource attributes (`SignalUtilsCanonicalizeAttributes`: sorted by key, `JSON.stringify`), so compression can compare the TEXT column directly. The compression series identity is `(serviceName, serviceVersion, name, type, attributes, bucket)` in both dialects — do not remove any of these from the GROUP BY/delete predicates.
- **Raw JSON storage**: `rawSpan`, `rawMetric` columns store the full OTLP JSON for each signal. These are returned by analytics endpoints for client-side rendering.
- **Nanoseosecond timestamps**: OTel uses nanosecond timestamps. Maintenance calculations multiply JavaScript milliseconds by `1_000_000` to convert. Time-based queries use nanosecond ranges.
- **Timestamp precision in queries**: Nanosecond timestamps exceed `Number.MAX_SAFE_INTEGER`, so stored values are JS doubles. Analytics routes run query-string times through `AnalyticsUtilsGetTimeParam` before binding: binding the raw digits as text makes SQLite parse them as exact 64-bit integers that no longer equal the stored value, silently breaking equality and composite-cursor predicates.
- **AnalyticsCache adaptive refresh**: The cache refreshes every 10 minutes when recently accessed (within 1 hour), otherwise every hour. This minimizes DB load during idle periods.
- **Single-container production**: In production, the server serves pre-built web assets via `@fastify/static`. The Traefik proxy is NOT used. Only `dist/`, `node_modules/`, `sql/`, `config.json`, and `web/` are copied into the Docker image.
- **Test mocks intercept re-exports**: Tests mock `../../utils-std-ts/DbUtils` etc., which are now re-export files. Jest intercepts the import at the re-export file path, so mocks work without changes. Do not mock `@devopsplaybook.io/common-utils` directly.
- **LLM thinking mode**: Reasoning/thinking models (e.g. DeepSeek `-flash`/`-pro` variants) spend `max_tokens` on their internal chain-of-thought, which can leave `content` empty and trigger "LLM returned an empty response." `Recommendation.ts` sends `thinking.type=disabled` by default; set `LLM_THINKING_MODE=enabled` only when chain-of-thought is wanted (also raises the request timeout). `LLM_THINKING_MODE=omit` leaves the DeepSeek-specific `thinking` field out entirely for strict OpenAI-compatible providers.
- **Alert rule persistence is dual**: the full alerting 2.0 state lives in `alert_rule_state` (one JSON row per rule, `AlertRuleState` lifecycle: last observed value, notified flag, repeat timestamp, last outcome/error — survives restarts), while a compact legacy outcome (max 200 chars) is still written to `maintenance_state` key `error-alert-outcome-<id>` for older consumers. A missing `alert_rule_state` row is seeded from the legacy outcome, so upgrading does not re-notify active breaches. Keep both writes in sync when changing the engine.
- **Alert history and maintenance windows**: every evaluation outcome worth keeping goes to `alert_events` (`fired`, `notified`, `resolved`, `suppressed`, `error`); rows older than `ALERT_HISTORY_RETENTION_DAYS` (90) are pruned at most hourly from the evaluation loop. Maintenance windows (rule/service scoped, ISO start/end) suppress breach/recovery notifications but rules are still evaluated and state/history recorded as `suppressed`; an all-services rule is not muted by a service-scoped window. Notification severity mapping is `critical → error`, `warning → warning`, `info → info` (`info` is the test default); grouping sends one notification per `(breach|recovery, serviceLabel)`.
- **Canonical log severity**: `logs.severity` stores the uppercase OTLP set (`TRACE`/`DEBUG`/`INFO`/`WARN`/`ERROR`/`FATAL`), normalized at ingestion by `SignalNormalization.ts` (alias + `severityNumber` fallback). Filters, logs stats and alert rules compare that exact value; lowercase query input is canonicalized by the route. `init-0013` backfills legacy rows and must stay UPDATE-only: common-utils >= 2.4.1 compares `MAX(CAST(value AS INTEGER))`, but the migrations idempotency test keeps guarding every init file against re-application (a runner downgrade must not take the server down at startup).
- **Atomic deletes and rollup drift**: maintenance deletions go through `MaintenanceAtomicDelete`: PostgreSQL runs a single `DELETE … RETURNING` data-modifying CTE, SQLite runs `BEGIN IMMEDIATE` → grouped delta `SELECT` → `DELETE` → `COMMIT`. The rollup decrement uses the returned rows, so a crash between delete and decrement could still leave drift; `SignalRollupsReconcile` (at most once every 24 h, tracked in `maintenance_state` key `signal-rollups-reconcile-last-run`) compares rollups with the raw tables, logs the drift (log-only, no OTel metric) and recounts. Do not reintroduce separate "select then delete" statements outside a transaction.
- **Untrusted telemetry in the LLM prompt**: every telemetry-derived string in the recommendation prompt goes through `RecommendationSanitizePromptText` (control characters stripped, `<untrusted_telemetry_data>` delimiter spoofing replaced with `[filtered]`, length capped) and the whole data block is wrapped in `<untrusted_telemetry_data>` tags with the static request outside. The system prompt states the block is attacker-controllable. Never interpolate a service/trace/log name into the prompt without sanitizing it, and keep the closing tag and final request outside the truncated data budget.
- **Recommendation scopes**: `GET /api/recommendation` requires **both** `traces` and `logs` scopes (the cached payload contains log totals, per-severity counts and top error messages). The home page hides the card unless the user has both (`HomeOverviewCanAccessRecommendation`).
- **Self-metrics refresh**: `METRICS_SELF_REFRESH_MINUTES` is clamped to `1–1440` by `Config.reload()` and `SelfMetricsGetRefreshIntervalMs` falls back to 10 minutes for `0`/invalid values, never below one minute. The refresh timer is `unref()`'d so it never keeps the process (or a test runner) alive.
- **Ingestion normalization and limits**: Traces/logs routes normalize ids (50 chars), names/service values (2000), keywords (4000) and log text (65,536) before binding, reject non-finite/out-of-range timestamps and report rejects in `partialSuccess` (`rejectedSpans` / `rejectedLogRecords`). `attributes`/`rawSpan`/`rawMetric` stay raw JSON and are bounded only by `INGESTION_BODY_LIMIT_BYTES` and retention. Do not add validation that could throw on a single record and abort the whole batch.
- **Restart-only settings**: body limits, rate limits, `API_TRUST_PROXY`, `CORS_POLICY_ORIGIN`, database settings, analytics init values and the scheduled-job/refresh intervals are captured at startup (route registration, `*Init` functions, timers). Changing them in `config.json` has no effect until a restart/rollout. The full list is in the README "Settings applied at startup" section — keep it in sync when adding startup-captured settings.
- **Shipped dependency audit**: `@fastify/static` pins `glob ^13`, whose `minimatch` advisory is fixed in `glob 14`; `package.json` therefore carries a scoped `overrides` entry `"@fastify/static": { "glob": "^14.0.3" }`. Keep the CI audit gate (`audit_enabled: true`) and re-check `npm audit --omit=dev` when upgrading. Do not add `minimatch` back as a direct dependency (nothing imports it).
