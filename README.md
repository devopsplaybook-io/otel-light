# OTel Light

**OTel Light** is a lightweight, easy-to-use [OpenTelemetry (OTel)](https://opentelemetry.io/) service designed for small and resource-constrained environments. This is ideal for development environments or home labs.

## Features

- HTTP API for ingestion of Traces, Logs, and Metrics
- User interface to visualize telemetry signals
- Filter signals by service name and service version
- Shareable trace pages (deep-linkable `/traces/{traceId}` URLs) with trace JSON copy/download, CSV export of the filtered logs view, and one-click navigation between logs, aggregated trace groups and traces
- Metrics page with auto-refreshing card grid, per-card latest value with unit and timestamp, per-card queued/loading/stale/error states with retry, stable cards while the metric-name list refreshes, and auto-refresh paused while the tab is hidden; metrics excluded from auto-load are listed last
- Dynamic paging with infinite scroll for Traces and Logs
- Administration interface for login and maintenance rule management
- Maintenance rules support optional service-name filtering
- User API tokens: create personal tokens (on the profile page) with an expiry choice (30/90/180/365 days, default 90) to call the authenticated `GET/POST /api/*` endpoints with your own permissions; the list shows last use and expiry
- All-in-one container deployment
- Low memory footprint (<100MB)
- Supports up to 1 million signals (Traces, Logs, Metrics)
- **Optional LLM-powered daily recommendation**: sends telemetry statistics to an LLM for analysis and actionable recommendations
  - Configurable period (default 24h) and cron schedule (default daily at midnight)
  - Statistics include: log volumes and error rates, trace counts and top types by duration, metric volumes, all per service
  - Supports any OpenAI-compatible API (DeepSeek, OpenAI, etc.)
- **Optional alerting 2.0**: per-service (or global) rules for log counts (ERROR/FATAL by default), metric thresholds, trace error rates/counts and heartbeats, evaluated on a schedule and pushed through the notification channel (see [Alerting](#alerting))
  - Rules managed in the settings **Alerts** tab, with the last evaluation outcome shown per rule
  - Per-rule notification severity, repeat interval and recovery notices; maintenance windows suppress notifications; full alert history with links to the matching signals
  - Daily recommendation notifications include a per-service error digest so a quiet day is confirmed, not only breaches

![](docs/images/Traces.png?raw=true)

![](docs/images/TracesStats.png?raw=true)

![](docs/images/Metrics.png?raw=true)

![](docs/images/Logs.png?raw=true)

## Specification

- Deployed as a single container by default using SQLite for storage; can be configured to use PostgreSQL as an external database
- Deploying with PostgreSQL enables handling more load and larger volumes of data
- Target memory usage: <100MB
- Ingestion via HTTP API (use an [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) for other protocols)
- Storage optimized for fewer than 1 million signals (SQLite); higher capacity with PostgreSQL
- Analytics queries accelerated by targeted database indexes (covering indexes on `serviceName`/`serviceVersion`, composite time-range indexes, and JOIN/lookup indexes)
- Service list is cached in `<DATA_DIR>/cache/services.json` and refreshed at a configurable interval to minimize expensive database scans

## Quick Start

### Docker

Run OTel Light in Docker:

```bash
mkdir -p data
docker run --name otel-light -p 8080:8080 -v "$(pwd)/data:/data" -d devopsplaybookio/otel-light
```

- Docker image: [`devopsplaybookio/otel-light`](https://hub.docker.com/r/devopsplaybookio/otel-light)
- Exposes port: `8080`
- Data volume: `/data`
- Application title: set `APPLICATION_TITLE` to rename the installed PWA, e.g. `docker run -e APPLICATION_TITLE="R&D / Ops" -p 8080:8080 -v "$(pwd)/data:/data" -d devopsplaybookio/otel-light`. Any value (including `/`, `&`, `\`, quotes and non-ASCII) is safe: the entrypoint parses and re-serializes the web manifest instead of string-substituting it.

### Kubernetes

Deploy OTel Light on Kubernetes:

```bash
git clone https://github.com/devopsplaybook-io/otel-light
cd otel-light/docs/deployments/kubernetes/otel-light
kubectl kustomize . | kubectl apply -f -
```

To launch the application with the service exposed as a NodePort (for local cluster access):

```bash
git clone https://github.com/devopsplaybook-io/otel-light
cd otel-light/docs/deployments/kubernetes/otel-light-nodeports
kubectl kustomize . | kubectl apply -f -
```

> **Note:** To expose the service externally, use an Ingress or a NodePort service.

## More Deployment Examples

See [`docs/deployments`](docs/deployments) for additional deployment options.

## Security

- **Ingestion authentication**: when `OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER` is empty (the default), the `/v1/*` ingestion endpoints accept unauthenticated writes and the server logs a `SECURITY WARNING` at startup. Set the header on any instance reachable from an untrusted network; clients must then send `Authorization: Bearer <value>`.
- **Rate limiting**: `POST /v1/{traces,metrics,logs}` are limited per client IP (`INGESTION_RATE_LIMIT_MAX` requests per `INGESTION_RATE_LIMIT_WINDOW_SECONDS`, default 3000 per 60 s) and `POST /api/users/session` is limited per IP + username (`LOGIN_RATE_LIMIT_MAX` per `LOGIN_RATE_LIMIT_WINDOW_SECONDS`, default 10 per 60 s). `0` disables a limit. Exceeding a limit returns **HTTP 429** with a `Retry-After` header and a `{"statusCode":429,"error":"Too Many Requests","code":"RATE_LIMITED","message":"..."}` body. Counters are in-memory and per process: they reset on restart and are not shared between replicas. Limits are read at startup, so restart the server after changing them.
- **Reverse proxies**: buckets are keyed on the client IP. Set `API_TRUST_PROXY=true` only when a trusted reverse proxy overwrites `X-Forwarded-For`; on a directly exposed server, trusting the header lets clients spoof their IP and evade the limits.
- **Admin-only data**: reading and writing `/api/settings/:category` and the `GET /api/alerts/status`, `GET /api/alerts/history` and `POST /api/alerts/test` endpoints require the admin role.
- **Trace logs**: `/api/analytics/traces/:traceId/logs` requires the `logs` scope; the trace pages hide/skip the log panel for users without it.
- **Recommendation data**: `GET /api/recommendation` returns log-derived statistics (totals, per-severity counts, top error messages), so it requires **both** the `traces` and `logs` scopes. The home page hides the card for users lacking either scope.
- **CSV export**: exported log values that start with `=`, `+`, `-`, `@`, tab, CR or LF are prefixed with an apostrophe so spreadsheets treat them as text instead of formulas.
- **Browser tokens**: the web UI keeps its JWT in `localStorage`, so any XSS on the app origin could read it (markdown is sanitized before rendering). Tokens without a numeric `exp` claim are rejected. API tokens can be revoked immediately and their permissions are re-checked on every request. This is an accepted tradeoff of the SPA; do not host untrusted scripts on the same origin.

## Configuration

Configuration can be provided via a JSON configuration file (e.g., using a ConfigMap) or environment variables.

See the [ConfigMap YAML](docs/deployments/kubernetes/otel-light/base/configmap.yaml) for an example configuration.

| Parameter                                               | Description                                           | Default                                     | Availability                        |
| ------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------- | ----------------------------------- |
| OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS    | Interval (in seconds) to export logs                  | 60                                          | Config file or environment variable |
| OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS | Interval (in seconds) to export metrics               | 60                                          | Config file or environment variable |
| OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER              | Authorization header for OTel collection              | (empty)                                     | Config file or environment variable |
| INGESTION_BODY_LIMIT_BYTES                              | Maximum OTLP/JSON request body size in bytes (clamped to 1024–16777216); larger requests get HTTP 413 | 1048576        | Config file or environment variable |
| INGESTION_RATE_LIMIT_MAX                                | Max OTLP ingestion requests per client IP per window (0 disables) | 3000                            | Config file or environment variable |
| INGESTION_RATE_LIMIT_WINDOW_SECONDS                     | Ingestion rate-limit window in seconds (clamped to 1–86400) | 60                                   | Config file or environment variable |
| LOGIN_RATE_LIMIT_MAX                                    | Max login attempts per client IP + username per window (0 disables) | 10                          | Config file or environment variable |
| LOGIN_RATE_LIMIT_WINDOW_SECONDS                         | Login rate-limit window in seconds (clamped to 1–86400) | 60                                    | Config file or environment variable |
| API_TRUST_PROXY                                         | Trust `X-Forwarded-For` for client IPs (enable only behind a trusted reverse proxy) | false        | Config file or environment variable |
| CORS_POLICY_ORIGIN                                      | CORS allowed origin (empty = CORS disabled)           | (empty)                                     | Config file or environment variable |
| METRICS_COMPRESS_MINUTE_THRESHOLD_HOURS                 | Hours before minute-level metrics are compressed      | 12                                          | Config file or environment variable |
| METRICS_COMPRESS_HOUR_THRESHOLD_DAYS                    | Days before hour-level metrics are compressed         | 7                                           | Config file or environment variable |
| MAINTENANCE_FREQUENCY_HOURS                             | Frequency of execution of maintenance rule (in hours) | 6                                           | Config file or environment variable |
| CACHE_REFRESH_MINUTES                                   | Interval (in minutes) to refresh the services cache   | 10                                          | Config file or environment variable |
| METRICS_SELF_REFRESH_MINUTES                            | Refresh interval (in minutes) for the self-metrics gauges (clamped to 1–1440) | 10                        | Config file or environment variable |
| DATABASE_TYPE                                           | Database type (`sqlite` or `postgres`)                | sqlite                                      | Config file or environment variable |
| DATABASE_POSTGRES_HOST                                  | PostgreSQL server hostname                            |                                             | Config file or environment variable |
| DATABASE_POSTGRES_PORT                                  | PostgreSQL server port                                |                                             | Config file or environment variable |
| DATABASE_POSTGRES_USER                                  | PostgreSQL user                                       |                                             | Config file or environment variable |
| DATABASE_POSTGRES_PASSWORD                              | PostgreSQL password                                   |                                             | Config file or environment variable |
| DATABASE_POSTGRES_DATABASE                              | PostgreSQL database name                              |                                             | Config file or environment variable |
| ANALYTICS_UTILS_RESULT_LIMIT_METRICS                    | Maximum number of results for metrics queries         | 10000                                       | Config file or environment variable |
| ANALYTICS_STATS_SAMPLE_CAP                              | Max traces deterministically sampled for duration percentiles on `/api/analytics/traces/stats` and `/api/analytics/traces/summary` | 20000 | Config file or environment variable |
| ANALYTICS_STATS_CACHE_TTL_SECONDS                       | TTL of the traces-stats response cache (0 disables)   | 30                                          | Config file or environment variable |
| ANALYTICS_STATS_CACHE_MAX_ENTRIES                       | Max cached traces-stats responses                     | 100                                         | Config file or environment variable |
| ANALYTICS_EXPORT_MAX_ROWS                               | Hard cap on rows returned by one streamed export (clamped to 1–1,000,000) | 100000             | Config file or environment variable |
| LLM_API_KEY                                             | API key for the LLM service (leave empty to disable)  | (empty)                                     | Config file or environment variable |
| LLM_API_URL                                             | LLM API endpoint (OpenAI-compatible)                  | `https://api.deepseek.com/chat/completions` | Config file or environment variable |
| LLM_MODEL                                               | LLM model name                                        | `deepseek-chat`                             | Config file or environment variable |
| LLM_THINKING_MODE                                       | Thinking mode for reasoning LLMs (`disabled`, `enabled` or `omit`) | `disabled`                                  | Config file or environment variable |
| LLM_RECOMMENDATION_SCHEDULE_CRON                        | Cron expression for daily recommendation generation   | `20 0 * * *`                                | Config file or environment variable |
| LLM_RECOMMENDATION_PERIOD_HOURS                         | Hours of telemetry data to include in each report     | 24                                          | Config file or environment variable |
| LLM_RECOMMENDATION_SAMPLE_CAP                           | Max root spans deterministically sampled for percentiles | 20000                                     | Config file or environment variable |
| LLM_RECOMMENDATION_TIMEOUT_SECONDS                      | Overall budget for all LLM attempts (including retries and backoff) | 180                            | Config file or environment variable |
| LLM_RECOMMENDATION_STARTUP_DELAY_MINUTES                | Delay before the initial recommendation generation    | 2                                           | Config file or environment variable |
| STATIC_REPORT_SCHEDULE_CRON                             | Cron expression for the longest-traces report         | `40 0 * * *`                                | Config file or environment variable |
| STATIC_REPORT_TOP_N                                     | Top N traces kept in each static report               | 30                                          | Config file or environment variable |
| STATIC_REPORT_PERIOD_DAYS                               | Lookback period (in days) for the static reports      | 30                                          | Config file or environment variable |
| MOST_CALLED_TRACES_SCHEDULE_CRON                        | Cron expression for the most-called-traces report     | `0 1 * * *`                                 | Config file or environment variable |
| LONGEST_TRACES_STARTUP_DELAY_MINUTES                    | Delay before the initial longest-traces report        | 15                                          | Config file or environment variable |
| MOST_CALLED_TRACES_STARTUP_DELAY_MINUTES                | Delay before the initial most-called-traces report    | 25                                          | Config file or environment variable |
| SCHEDULED_JOB_JITTER_MINUTES                            | Random delay (0..N minutes) added after a heavy job's cron fire | 5                                  | Config file or environment variable |
| SCHEDULED_JOB_OVERLAP_WAIT_MINUTES                      | How long a heavy job waits for another running job before skipping that run | 30                    | Config file or environment variable |
| MAINTENANCE_ORPHAN_LOOKBACK_HOURS                       | Lookback window for orphan-span cleanup scans         | 24                                          | Config file or environment variable |
| NOTIFICATIONS_API                                       | Notifications API endpoint URL (empty = notifications disabled) | (empty)                           | Config file or environment variable |
| NOTIFICATIONS_TOKEN                                     | Notifications API token                               | (empty)                                     | Config file or environment variable |
| ERROR_ALERTS_EVALUATION_FREQUENCY_MINUTES               | Interval (in minutes) between alert rule evaluations  | 15                                     | Config file or environment variable |
| ERROR_ALERTS_STARTUP_DELAY_MINUTES                      | Delay before the first alert rule evaluation          | 1                                           | Config file or environment variable |

### Settings applied at startup

Most settings from `config.json` are re-read when the file changes (and environment variables are read at startup). The settings below are captured once, while Fastify routes/plugins are registered, init functions run or timers/schedulers are created, so **changing them requires a server restart (or a container rollout)**:

- Ingestion and request handling: `INGESTION_BODY_LIMIT_BYTES`, `INGESTION_RATE_LIMIT_MAX`, `INGESTION_RATE_LIMIT_WINDOW_SECONDS`, `LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_WINDOW_SECONDS`, `API_TRUST_PROXY`, `CORS_POLICY_ORIGIN`.
- Database: `DATABASE_TYPE` and the `DATABASE_POSTGRES_*` settings.
- Analytics: `ANALYTICS_UTILS_RESULT_LIMIT_METRICS`, `ANALYTICS_STATS_SAMPLE_CAP`, `ANALYTICS_STATS_CACHE_TTL_SECONDS`, `ANALYTICS_STATS_CACHE_MAX_ENTRIES`, `ANALYTICS_EXPORT_MAX_ROWS`.
- Scheduled work and refresh intervals: `CACHE_REFRESH_MINUTES`, `METRICS_SELF_REFRESH_MINUTES`, `NOTIFICATIONS_API`, `NOTIFICATIONS_TOKEN`, `LLM_API_KEY` (enables/disables the recommendation scheduler), `LLM_RECOMMENDATION_SCHEDULE_CRON`, `LLM_RECOMMENDATION_STARTUP_DELAY_MINUTES`, `STATIC_REPORT_SCHEDULE_CRON`, `MOST_CALLED_TRACES_SCHEDULE_CRON`, `LONGEST_TRACES_STARTUP_DELAY_MINUTES`, `MOST_CALLED_TRACES_STARTUP_DELAY_MINUTES`, `ERROR_ALERTS_STARTUP_DELAY_MINUTES`, `SCHEDULED_JOB_JITTER_MINUTES`, `SCHEDULED_JOB_OVERLAP_WAIT_MINUTES`.

Rate-limit counters are in-memory and per process, so a restart also resets them.

## Signal Cleanup and Metric Compression

Cleanup rules (settings → **Maintenance**) delete old signals whose `keywords` match a pattern. Patterns are matched case-insensitively and `*` is the **only** wildcard (it matches any sequence). SQL wildcards are escaped before the query, so `%`, `_` and `\` are compared literally — a rule like `error%100` matches that exact text, not "error followed by anything".

Each maintenance run records a per-rule outcome (deleted rows, skip reason or error) plus the run time, persisted in the settings category `signal-cleanup-rules-status`; the Maintenance page shows it under the heading and as a "Last run" line per rule. Rules with an invalid period, pattern or service name are rejected by the settings API and the form. An invalid rule that was saved by an older version (e.g. a whitespace-only pattern) is flagged with a one-click **Fix** that repairs the form values (it never saves by itself — review and click Save), and the engine skips it instead of running it.

Periodic metric compression keeps one data point per minute (then per hour) bucket **per full series**: `serviceName`, `serviceVersion`, `name`, `type` and the resource `attributes` are all part of the series identity. Series that share a name but differ by type, version or resource attributes are therefore preserved. Note that data compressed by older versions may already have lost series; that history cannot be recovered.

## Analytics Statistics

`GET /api/analytics/traces/stats` rounds its `from`/`to` window down/up to whole minutes and uses a deterministic sampling stride (capped by `ANALYTICS_STATS_SAMPLE_CAP`) for P90/P95 durations, so repeated identical requests return identical percentiles. Responses are cached for `ANALYTICS_STATS_CACHE_TTL_SECONDS` (up to `ANALYTICS_STATS_CACHE_MAX_ENTRIES` entries). Pass `includePercentiles=false` to skip the percentile computation and payload. It accepts the same `keywords` and `errorsOnly` filters as `GET /api/analytics/traces`.

`GET /api/analytics/traces/summary` is the fast variant used by the home page and the Aggregated view. It aggregates **root spans only** (`parentSpanId IS NULL`), so each row is one distributed trace: `serviceName`, `serviceVersion`, `name`, `traceCount`, `nbErrors` (traces whose root span failed) and `avgDuration`. P90/P95 trace durations are computed from a bounded, deterministic sample controlled by `ANALYTICS_STATS_SAMPLE_CAP`; pass `includePercentiles=false` to skip them. Compared with `/traces/stats`, durations and the error count describe the whole trace rather than every matching span, and `errorsOnly=true` keeps the list semantics of `/traces/stats` (a trace is included when **any** span errored). It accepts the window (`from`/`to`, rounded to whole minutes), `serviceName`, `serviceVersion`, an exact `name` and the `keywords`/`errorsOnly` filters, and shares the stats response cache.

All analytics list endpoints bind and validate their paging parameters: `offset` must be a non-negative integer up to 1,000,000 and a malformed value returns `400`. `GET /api/analytics/logs/stats` requires a bounded window: `from` defaults to 24 hours ago, `bucketNs` must be an integer of at least one second, and the window may not exceed 1,000 buckets (otherwise `400`). Analytics `keywords` filters treat `%`, `_` and `\` literally.

`GET /api/analytics/traces` accepts an exact-match `name` filter on the trace name, which drilldowns use when expanding a group, a report row or a recommendation bullet.

## Search Filters, Saved Views and Export

`GET /api/analytics/logs`, `GET /api/analytics/traces` and their `stats`/`export` variants share one filter contract (filters combine with AND):

| Parameter        | Signal   | Meaning                                                                                                                                         |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `keywords`       | both     | Multi-term search, terms combine with AND. Wrap a phrase in double quotes to keep its spaces (`keywords='"connection refused" timeout'`). `%`, `_` and `\` are literal. |
| `attr`           | both     | Repeatable attribute filter, `key:operator[:value]`. Operators: `=` (exact), `!=` (attribute missing or different), `contains` (case-insensitive substring) and `exists` (no value). Up to 20 filters. |
| `serviceName`    | both     | Exact service name.                                                                                                                             |
| `serviceVersion` | both     | Exact service version.                                                                                                                          |
| `severity`       | logs     | Canonical uppercase severity (`TRACE`/`DEBUG`/`INFO`/`WARN`/`ERROR`/`FATAL`; lowercase input is accepted).                                       |
| `status`         | traces   | Root span status: `unset`/`ok`/`error` or `0`/`1`/`2`. Filters the root span, like `name`.                                                       |
| `errorsOnly`     | traces   | `true` keeps traces with at least one error span (root or child).                                                                               |
| `durationMin`    | traces   | Minimum full-trace duration in milliseconds (`MAX(endTime) − MIN(startTime)`), at most 7 days.                                                  |
| `durationMax`    | traces   | Maximum full-trace duration in milliseconds.                                                                                                    |

Attribute matching reads the stored OTLP KeyValue arrays with `json_each` (SQLite) or `jsonb_array_elements` (PostgreSQL); keys and values stay bound parameters. No expression index is created: each attribute filter scans the rows selected by the other predicates, so keep attribute filters narrow (service, time window) on very large tables.

### Saved views

Named views store the filter query string (including the default time window) per user and signal type.

- `GET /api/saved-views?signalType=logs|traces` — the caller's own views plus views other users marked as shared. Requires authentication.
- `POST /api/saved-views` — `{ name, signalType, query, shared? }`; creates a private view unless `shared` is `true`.
- `PATCH /api/saved-views/:id` — `{ name?, shared? }`; only the owner may rename or change visibility.
- `DELETE /api/saved-views/:id` — only the owner may delete.

The web search bar lists the views for the current signal and can apply, create, rename, share and delete them. The URL stays the source of truth: selecting a view rewrites the route query and the search controls.

### Streamed export

`GET /api/analytics/logs/export` and `GET /api/analytics/traces/export` accept the same filters plus `format=csv|jsonl` (default `csv`) and require the `logs` / `traces` scope respectively. Paging parameters are ignored: the server walks the complete filtered result newest-first in keyset-paginated chunks and streams it, so the response is never buffered in memory.

- CSV keeps the RFC-4180 escaping and the spreadsheet-formula neutralization (`=`, `+`, `-`, `@`, tab, CR and LF get an apostrophe prefix) and includes the `attributes` column.
- JSONL emits one JSON object per line with attributes as structured arrays.
- At most `ANALYTICS_EXPORT_MAX_ROWS` rows (default 100,000) are exported. The cap is advertised in `X-Export-Max-Rows`; when more rows match, a truncation marker is appended (`# export truncated at N rows (ANALYTICS_EXPORT_MAX_ROWS)` for CSV, `{"__otel_light_export__":{"truncated":true,"maxRows":N}}` for JSONL).
- Responses set `Content-Disposition: attachment`, `X-Export-Format` and `Cache-Control: no-store`.

## LLM Recommendation

When `LLM_API_KEY` is configured, OTel Light automatically generates a daily telemetry analysis and recommendation report.

### How it works

1. **Statistics collection**: At the scheduled time, the server queries the database for the last N hours (configurable via `LLM_RECOMMENDATION_PERIOD_HOURS`, default 24h) and gathers:
   - **Logs** — total count, error count, per-service breakdown with error rates, per-severity distribution, top error messages
   - **Traces** — total count, traces with errors, per-service breakdown, HTTP status classes on root spans, and four trace-type rankings (count, errors, cumulative duration, average duration) with P50/P95/P99 durations from a bounded deterministic sample
   Telemetry-derived text is bounded and sanitized, and the whole data block is wrapped in `<untrusted_telemetry_data>` tags: the system prompt instructs the model to treat it strictly as data and ignore any instructions embedded in service names, trace names, log messages or attributes.
2. **LLM analysis**: The collected statistics are sent to the configured LLM, which returns:
   - **Analysis** — overall system health assessment, notable patterns, anomalies, and trends
   - **Recommendations** — actionable, prioritized bullet points for improvement
3. **Caching**: The result is stored in `<DATA_DIR>/recommendation.json` and displayed on the home page UI.

### API

- `GET /api/recommendation` — Returns the latest cached recommendation (analysis + recommendations + raw statistics). Requires both the `traces` and `logs` scopes because the payload includes log-derived statistics.

### Frontend

The recommendation is displayed as a card on the home page, with markdown-rendered analysis and recommendations sections, and the generation timestamp.

## Alerting

OTel Light can notify you when a service (or all services) breaches an alert rule, using the existing notification channel.

### Rule types

Rules are managed in the settings **Alerts** tab (admin only). Every rule defines:

- **Type**: `log-count` (the default for legacy rules), `metric-threshold`, `trace-errors` or `heartbeat`
- **Service**: a specific service, or all services (heartbeat rules require one)
- **Period**: the lookback window in hours or days
- **Severity**: `info`, `warning` or `critical` — critical maps to the notification channel's error severity; the webhook contract stays `info|warning|error`
- **Repeat interval**: minutes between notifications while the breach persists (`0` = notify once)
- **Notify on recovery**: send a recovery notification when the breach clears
- **Enabled**: disabled rules are kept but not evaluated

Type-specific fields:

- **Log count**: the rule breaches when more logs than the threshold carry the selected severities; the default is `ERROR` + `FATAL`, so FATAL is counted as an error.
- **Metric threshold**: aggregates the metric data points (`last`, `avg`, `max`, `min`) and compares them with the threshold (`>`, `>=`, `<`, `<=`).
- **Trace errors**: error rate (percentage of distinct traces with `statusCode = 2`) or error count, compared with `>`.
- **Heartbeat**: breaches when no signal of the chosen type (metrics, logs or traces — optionally a specific metric) was received for the service during the period. One heartbeat rule per expected signal/service covers the freshness checks that otherwise need external cronjobs.

Rules and maintenance windows are stored in the `error-alert-rules` settings category (the name is kept for backwards compatibility) and re-read at every evaluation, so changes apply without a restart.

### Maintenance windows

A maintenance window has an optional rule and service scope (empty = all rules/services), a start/end date and an enabled flag. While a window is active, a matching rule is still evaluated and its observed value/state is stored, but notifications are suppressed and the suppression is recorded in the alert history. An all-services rule is not muted by a service-scoped window.

### Evaluation

- The engine evaluates all enabled rules on a schedule: every `ERROR_ALERTS_EVALUATION_FREQUENCY_MINUTES` (default 15 minutes), starting `ERROR_ALERTS_STARTUP_DELAY_MINUTES` (default 1 minute) after startup.
- A new breach sends a notification; a persisting breach repeats only when `repeatIntervalMinutes` is set. The breach lifecycle survives restarts (`alert_rule_state`).
- When a breach clears, a `resolved` history event is recorded and a recovery notification is sent if the episode had been notified and `notifyOnRecovery` is enabled.
- The last evaluation outcome of each rule (timestamp, observed value, threshold, whether an alert was sent or suppressed, or the error encountered) is shown in the **Alerts** tab — rules are never silently skipped.
- A disabled or failed notification send is recorded as an `error` outcome/history event, so breaches are not lost silently.

### Alert history

Every fired/notified/resolved/suppressed/error event is stored in `alert_events` (90 days retention, pruned at most hourly) and survives restarts. The settings **Alert history** tab lists it with rule/service/status/date filters and "Load more" pagination; each entry links to the matching search page filtered over the rule period (logs with the rule severity, metrics by keyword, traces with `errorsOnly`).

### Test notification

The **Alerts** tab has a "Send test notification" action with a severity selector. It reports whether the channel accepted the notification or why it failed (for example notifications disabled), so the integration can be verified without waiting for a breach.

### Daily error digest

When the LLM recommendation is enabled, its notification also includes a per-service error digest (total logs and error logs per service), so a quiet day is confirmed and not only breaches reported.

### Disabled integration

When `NOTIFICATIONS_API`/`NOTIFICATIONS_TOKEN` are not configured, the **Alerts** tab shows the integration as disabled: rules are still evaluated and their outcomes (observed values, breaches, suppressions) are recorded with "not notified", and no notifications are sent.

### API

- `GET /api/alerts/status` — whether the notifications integration is enabled and the last evaluation outcome of each rule
- `GET /api/alerts/history` — paginated alert history (`ruleId`, `serviceName`, `status`, `from`, `to`, `limit`, `offset`)
- `POST /api/alerts/test` — send a test notification (`severity`: `info`, `warning` or `critical`)
- `GET`/`PUT /api/settings/error-alert-rules` — alert rules and maintenance windows content

All these endpoints require the admin role.

## API Tokens

Users can create their own API tokens from the profile page (`/settings/profile`), in the "API Tokens" section. A token has the same permissions as the user who created it (role and scopes are read live on every request, so permission changes and revocation apply immediately).

- **Create**: profile page → "Create Token" → give it a name and choose an expiry (30/90/180/365 days, default 90). The plaintext token is displayed only once — copy it immediately.
- **List / Revoke**: the profile page lists your tokens with creation date, last use and expiry (an **Expired** badge marks a past expiry); revoking a token asks for confirmation and immediately invalidates it.
- **Last use** is refreshed at most once per hour. The optional `expiresAt`/`lastUsedAt` columns are added by the `init-0017` migration; old rows read as "Never expires" / "Never used". Expiry is enforced by the UI: a raw API client can still omit `expiresAt`.
- **Use**: call any authenticated endpoint with the HTTP header below (e.g. `GET /api/analytics`, `GET /api/reports`, `GET /api/recommendation`):

```
Authorization: Bearer <your API token>
```

> **Note:** Ingestion endpoints (`POST /v1/traces`, `POST /v1/metrics`, `POST /v1/logs`) are not affected: they keep using the static `OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER` value.

## Authentication sessions

Sessions follow the standard policy documented in [`common-utils`](https://github.com/devopsplaybook-io/common-utils/blob/main/docs/auth-session-policy.md): `JWT_VALIDITY_DURATION` (30 days) is a sliding validity renewed while the user is active, and `JWT_SESSION_MAX_DURATION` (90 days) is the absolute cap after which a new login is required. Both are declared with `addConfigField` so a value from `config.json` or the environment survives a reload.

At startup the server logs the effective values and validates them with `AuthSessionPolicyLog(config, { app: "otel-light", ... })`; an invalid combination (for example a validity below one hour) is reported with an `Auth session policy error:` line. Run `curl -s http://<otel-light-url>/api/config | jq '{JWT_VALIDITY_DURATION, JWT_SESSION_MAX_DURATION}'` to check the effective values of a deployment.

> **Pitfall:** on `@devopsplaybook.io/common-utils` <= 2.9.2, a subclass field override is silently discarded on `reload()` unless the field is also declared with `this.addConfigField({ field: "..." })`. This app requires `^2.11.0`.

## Client Application

To send telemetry data, configure your application to send Traces, Metrics, and Logs to the following HTTP endpoints:

- Traces: `http://<otel-light-url>/v1/traces`
- Metrics: `http://<otel-light-url>/v1/metrics`
- Logs: `http://<otel-light-url>/v1/logs`

> **Tip:** Log collection can also be set up using an [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/).

If you have set the `OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER` parameter, you must set the HTTP `Authorization` header to:

```
Bearer <value of OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER>
```

When the header is empty, ingestion is open to anyone who can reach the server (subject to the ingestion rate limit — see [Security](#security)).

### OTLP ingestion

The ingestion endpoints accept **OTLP/JSON only** (`application/json`). Protobuf is not implemented, so exporters must be configured for the JSON protocol:

- SDKs: set `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` — or per signal: `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`, `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` and `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` to `http/json`.
- OpenTelemetry Collector: use the `otlphttp` exporter with `encoding: json` (the default `otlp` gRPC exporter cannot be used against otel-light directly; route it through an `otlphttp` exporter).

Any other content type (for example `application/x-protobuf`) is rejected with **HTTP 415** and a message pointing at these settings.

Accepted requests answer **HTTP 200** with an empty JSON object. When some records cannot be stored, ingestion answers **HTTP 200** with an OTLP `partialSuccess` object and still stores the valid records of the batch:

- Traces: `partialSuccess.rejectedSpans` counts spans missing a valid `traceId`/`spanId` or a valid positive start/end time.
- Logs: `partialSuccess.rejectedLogRecords` counts log records with an explicitly provided but invalid `timeUnixNano` (non-numeric, zero, negative, fractional or above `9e18`). A log record without `timeUnixNano` uses the ingestion time instead.

Every ingested value is normalized to what both database backends can store: ids are trimmed to 50 characters, service name/version and span names to 2000, keywords to 4000, and log text to 65,536 characters (NUL characters are stripped). Trace/span ids are kept as opaque strings but an empty or non-string mandatory id rejects the span. Timestamps must be finite positive integers of nanoseconds that fit a signed 64-bit integer. `attributes`, `rawSpan` and `rawMetric` are stored as the original JSON and are therefore not truncated; they are bounded by `INGESTION_BODY_LIMIT_BYTES` and the retention rules instead.

Log severity is canonicalized at ingestion to the uppercase OTLP set (`TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`): the text is trimmed, uppercased, common aliases are mapped (`WARNING` → `WARN`, `CRITICAL` → `FATAL`, …) and a trailing OTLP numeric suffix is removed (`WARN2` → `WARN`). When `severityText` is missing, the value is derived from `severityNumber` (1–4 `TRACE`, 5–8 `DEBUG`, 9–12 `INFO`, 13–16 `WARN`, 17–20 `ERROR`, 21–24 `FATAL`); custom text is kept uppercased and truncated. The list filter, logs stats and alert rules all compare that exact uppercase value, and the `init-0013` migration backfills existing rows at startup. Filters still accept any casing (`severity=error` matches `ERROR`).

Retry semantics are **at-least-once** for logs and metrics: OTLP has no stable log record or metric identity, so an exporter retry may insert duplicates. Spans are de-duplicated on `(traceId, spanId)`: replaying a trace batch does not duplicate rows or inflate counts.

Requests larger than `INGESTION_BODY_LIMIT_BYTES` are rejected with **HTTP 413**. Request payload compression is not supported.

## Contributing

Contributions are welcome! Please open issues or pull requests on [GitHub](https://github.com/DidierHoarau/otel-light).
