# OTel Light

**OTel Light** is a lightweight, easy-to-use [OpenTelemetry (OTel)](https://opentelemetry.io/) service designed for small and resource-constrained environments. This is ideal for development environments or home labs.

## Features

- HTTP API for ingestion of Traces, Logs, and Metrics
- User interface to visualize telemetry signals
- Filter signals by service name and service version
- Shareable trace pages (deep-linkable `/traces/{traceId}` URLs) with trace JSON copy/download, CSV export of the filtered logs view, and one-click navigation between logs, aggregated trace groups and traces
- Metrics page with auto-refreshing card grid, per-card latest value with unit and timestamp, and chart loading progress; metrics excluded from auto-load are listed last
- Dynamic paging with infinite scroll for Traces and Logs
- Administration interface for login and maintenance rule management
- Maintenance rules support optional service-name filtering
- User API tokens: create personal tokens (on the profile page) to call the authenticated `GET/POST /api/*` endpoints with your own permissions; valid until revoked
- All-in-one container deployment
- Low memory footprint (<100MB)
- Supports up to 1 million signals (Traces, Logs, Metrics)
- **Optional LLM-powered daily recommendation**: sends telemetry statistics to an LLM for analysis and actionable recommendations
  - Configurable period (default 24h) and cron schedule (default daily at midnight)
  - Statistics include: log volumes and error rates, trace counts and top types by duration, metric volumes, all per service
  - Supports any OpenAI-compatible API (DeepSeek, OpenAI, etc.)
- **Optional error-threshold notifications**: per-service (or global) alert rules "more than N error logs in the last H hours" evaluated on a schedule, pushing through the notification channel (see [Error Notifications](#error-notifications))
  - Rules managed in the settings **Alerts** tab, with the last evaluation outcome shown per rule
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

## Configuration

Configuration can be provided via a JSON configuration file (e.g., using a ConfigMap) or environment variables.

See the [ConfigMap YAML](docs/deployments/kubernetes/otel-light/base/configmap.yaml) for an example configuration.

| Parameter                                               | Description                                           | Default                                     | Availability                        |
| ------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------- | ----------------------------------- |
| OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS    | Interval (in seconds) to export logs                  | 60                                          | Config file or environment variable |
| OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS | Interval (in seconds) to export metrics               | 60                                          | Config file or environment variable |
| OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER              | Authorization header for OTel collection              | (empty)                                     | Config file or environment variable |
| INGESTION_BODY_LIMIT_BYTES                              | Maximum OTLP/JSON request body size in bytes (clamped to 1024–16777216); larger requests get HTTP 413 | 1048576        | Config file or environment variable |
| METRICS_COMPRESS_MINUTE_THRESHOLD_HOURS                 | Hours before minute-level metrics are compressed      | 12                                          | Config file or environment variable |
| METRICS_COMPRESS_HOUR_THRESHOLD_DAYS                    | Days before hour-level metrics are compressed         | 7                                           | Config file or environment variable |
| MAINTENANCE_FREQUENCY_HOURS                             | Frequency of execution of maintenance rule (in hours) | 6                                           | Config file or environment variable |
| CACHE_REFRESH_MINUTES                                   | Interval (in minutes) to refresh the services cache   | 10                                          | Config file or environment variable |
| DATABASE_TYPE                                           | Database type (`sqlite` or `postgres`)                | sqlite                                      | Config file or environment variable |
| DATABASE_POSTGRES_HOST                                  | PostgreSQL server hostname                            |                                             | Config file or environment variable |
| DATABASE_POSTGRES_PORT                                  | PostgreSQL server port                                |                                             | Config file or environment variable |
| DATABASE_POSTGRES_USER                                  | PostgreSQL user                                       |                                             | Config file or environment variable |
| DATABASE_POSTGRES_PASSWORD                              | PostgreSQL password                                   |                                             | Config file or environment variable |
| DATABASE_POSTGRES_DATABASE                              | PostgreSQL database name                              |                                             | Config file or environment variable |
| ANALYTICS_UTILS_RESULT_LIMIT_METRICS                    | Maximum number of results for metrics queries         | 10000                                       | Config file or environment variable |
| ANALYTICS_STATS_SAMPLE_CAP                              | Max traces deterministically sampled for duration percentiles on `/api/analytics/traces/stats` | 20000 | Config file or environment variable |
| ANALYTICS_STATS_CACHE_TTL_SECONDS                       | TTL of the traces-stats response cache (0 disables)   | 30                                          | Config file or environment variable |
| ANALYTICS_STATS_CACHE_MAX_ENTRIES                       | Max cached traces-stats responses                     | 100                                         | Config file or environment variable |
| LLM_API_KEY                                             | API key for the LLM service (leave empty to disable)  | (empty)                                     | Config file or environment variable |
| LLM_API_URL                                             | LLM API endpoint (OpenAI-compatible)                  | `https://api.deepseek.com/chat/completions` | Config file or environment variable |
| LLM_MODEL                                               | LLM model name                                        | `deepseek-chat`                             | Config file or environment variable |
| LLM_THINKING_MODE                                       | Thinking mode for reasoning LLMs (`disabled`, `enabled` or `omit`) | `disabled`                                  | Config file or environment variable |
| LLM_RECOMMENDATION_SCHEDULE_CRON                        | Cron expression for daily recommendation generation   | `20 0 * * *`                                | Config file or environment variable |
| LLM_RECOMMENDATION_PERIOD_HOURS                         | Hours of telemetry data to include in each report     | 24                                          | Config file or environment variable |
| LLM_RECOMMENDATION_SAMPLE_CAP                           | Max root spans randomly sampled for percentiles       | 20000                                       | Config file or environment variable |
| LLM_RECOMMENDATION_TIMEOUT_SECONDS                      | Overall budget for all LLM attempts (including retries and backoff) | 180                            | Config file or environment variable |
| LLM_RECOMMENDATION_STARTUP_DELAY_MINUTES                | Delay before the initial recommendation generation    | 2                                           | Config file or environment variable |
| STATIC_REPORT_SCHEDULE_CRON                             | Cron expression for the longest-traces report         | `40 0 * * *`                                | Config file or environment variable |
| MOST_CALLED_TRACES_SCHEDULE_CRON                        | Cron expression for the most-called-traces report     | `0 1 * * *`                                 | Config file or environment variable |
| LONGEST_TRACES_STARTUP_DELAY_MINUTES                    | Delay before the initial longest-traces report        | 15                                          | Config file or environment variable |
| MOST_CALLED_TRACES_STARTUP_DELAY_MINUTES                | Delay before the initial most-called-traces report    | 25                                          | Config file or environment variable |
| SCHEDULED_JOB_JITTER_MINUTES                            | Random delay (0..N minutes) added after a heavy job's cron fire | 5                                  | Config file or environment variable |
| SCHEDULED_JOB_OVERLAP_WAIT_MINUTES                      | How long a heavy job waits for another running job before skipping that run | 30                    | Config file or environment variable |
| MAINTENANCE_ORPHAN_LOOKBACK_HOURS                       | Lookback window for orphan-span cleanup scans         | 24                                          | Config file or environment variable |
| NOTIFICATIONS_API                                       | Notifications API endpoint URL (empty = notifications disabled) | (empty)                           | Config file or environment variable |
| NOTIFICATIONS_TOKEN                                     | Notifications API token                               | (empty)                                     | Config file or environment variable |
| ERROR_ALERTS_EVALUATION_FREQUENCY_MINUTES               | Interval (in minutes) between error alert rule evaluations | 15                                     | Config file or environment variable |
| ERROR_ALERTS_STARTUP_DELAY_MINUTES                      | Delay before the first error alert evaluation         | 1                                           | Config file or environment variable |

## Signal Cleanup and Metric Compression

Cleanup rules (settings → **Maintenance**) delete old signals whose `keywords` match a pattern. Patterns are matched case-insensitively and `*` is the **only** wildcard (it matches any sequence). SQL wildcards are escaped before the query, so `%`, `_` and `\` are compared literally — a rule like `error%100` matches that exact text, not "error followed by anything".

Periodic metric compression keeps one data point per minute (then per hour) bucket **per full series**: `serviceName`, `serviceVersion`, `name`, `type` and the resource `attributes` are all part of the series identity. Series that share a name but differ by type, version or resource attributes are therefore preserved. Note that data compressed by older versions may already have lost series; that history cannot be recovered.

## Analytics Statistics

`GET /api/analytics/traces/stats` rounds its `from`/`to` window down/up to whole minutes and uses a deterministic sampling stride (capped by `ANALYTICS_STATS_SAMPLE_CAP`) for P90/P95 durations, so repeated identical requests return identical percentiles. Responses are cached for `ANALYTICS_STATS_CACHE_TTL_SECONDS` (up to `ANALYTICS_STATS_CACHE_MAX_ENTRIES` entries). Pass `includePercentiles=false` to skip the percentile computation and payload.

## LLM Recommendation

When `LLM_API_KEY` is configured, OTel Light automatically generates a daily telemetry analysis and recommendation report.

### How it works

1. **Statistics collection**: At the scheduled time, the server queries the database for the last N hours (configurable via `LLM_RECOMMENDATION_PERIOD_HOURS`, default 24h) and gathers:
   - **Logs** — total count, error count, per-service breakdown with error rates, per-severity distribution
   - **Traces** — total count, traces with errors, per-service breakdown, top 5 trace types by cumulative duration with per-service breakdown (count, total/avg duration, errors)
   - **Metrics** — total data points, per-service breakdown
2. **LLM analysis**: The collected statistics are sent to the configured LLM, which returns:
   - **Analysis** — overall system health assessment, notable patterns, anomalies, and trends
   - **Recommendations** — actionable, prioritized bullet points for improvement
3. **Caching**: The result is stored in `<DATA_DIR>/recommendation.json` and displayed on the home page UI.

### API

- `GET /api/recommendation` — Returns the latest cached recommendation (analysis + recommendations + raw statistics)

### Frontend

The recommendation is displayed as a card on the home page, with markdown-rendered analysis and recommendations sections, and the generation timestamp.

## Error Notifications

OTel Light can notify you when a service (or all services) produces too many error logs, using the existing notification channel.

### Alert rules

Rules are managed in the settings **Alerts** tab (admin only). Each rule defines:

- **Service**: a specific service, or all services
- **Threshold**: the rule breaches when the number of error logs is **greater than** this value during the period (a threshold of 0 means "any error")
- **Period**: the lookback window in hours or days (e.g. "more than 10 errors in the last 24 hours")
- **Enabled**: disabled rules are kept but not evaluated

Rules are stored in the settings store and re-read at every evaluation, so changes apply without a restart.

### Evaluation

- The engine evaluates all enabled rules on a schedule: every `ERROR_ALERTS_EVALUATION_FREQUENCY_MINUTES` (default 15 minutes), starting `ERROR_ALERTS_STARTUP_DELAY_MINUTES` (default 1 minute) after startup.
- Only the healthy→breached **transition** sends a notification: a breach that persists does not repeat, and the rule re-arms after an evaluation below the threshold (the breach state survives restarts).
- The last evaluation outcome of each rule (timestamp, counted errors, threshold, whether an alert was sent, or the error encountered) is shown in the **Alerts** tab — rules are never silently skipped.

### Daily error digest

When the LLM recommendation is enabled, its notification also includes a per-service error digest (total logs and error logs per service), so a quiet day is confirmed and not only breaches reported.

### Disabled integration

When `NOTIFICATIONS_API`/`NOTIFICATIONS_TOKEN` are not configured, the **Alerts** tab shows the integration as disabled: rules are still evaluated and their outcomes (counts, breaches) are recorded with "not notified", and no notifications are sent.

### API

- `GET /api/alerts/status` — Returns whether the notifications integration is enabled and the last evaluation outcome of each rule

## API Tokens

Users can create their own API tokens from the profile page (`/settings/profile`), in the "API Tokens" section. A token has the same permissions as the user who created it (role and scopes are read live on every request, so permission changes and revocation apply immediately).

- **Create**: profile page → "Create Token" → give it a name. The plaintext token is displayed only once — copy it immediately.
- **List / Revoke**: the profile page lists your tokens; revoking a token immediately invalidates it.
- **Use**: call any authenticated endpoint with the HTTP header below (e.g. `GET /api/analytics`, `GET /api/reports`, `GET /api/recommendation`):

```
Authorization: Bearer <your API token>
```

> **Note:** Ingestion endpoints (`POST /v1/traces`, `POST /v1/metrics`, `POST /v1/logs`) are not affected: they keep using the static `OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER` value.

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

### OTLP ingestion

The ingestion endpoints accept **OTLP/JSON only** (`application/json`). Protobuf is not implemented, so exporters must be configured for the JSON protocol:

- SDKs: set `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` — or per signal: `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`, `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` and `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` to `http/json`.
- OpenTelemetry Collector: use the `otlphttp` exporter with `encoding: json` (the default `otlp` gRPC exporter cannot be used against otel-light directly; route it through an `otlphttp` exporter).

Any other content type (for example `application/x-protobuf`) is rejected with **HTTP 415** and a message pointing at these settings.

Accepted requests answer **HTTP 200** with an empty JSON object. Trace ingestion may instead return an OTLP `partialSuccess` object (`rejectedSpans`, `errorMessage`) when some spans are missing a `traceId`/`spanId` or a positive start/end time; the valid spans in the same batch are still stored.

Spans are de-duplicated on `(traceId, spanId)`: replaying a batch (an exporter retry) does not duplicate rows or inflate counts. Logs are stored at-least-once (OTLP has no stable log record ID) and metrics may duplicate on retry.

Requests larger than `INGESTION_BODY_LIMIT_BYTES` are rejected with **HTTP 413**. Request payload compression is not supported.

## Contributing

Contributions are welcome! Please open issues or pull requests on [GitHub](https://github.com/DidierHoarau/otel-light).
