# OTel Light

**OTel Light** is a lightweight, easy-to-use [OpenTelemetry (OTel)](https://opentelemetry.io/) service designed for small and resource-constrained environments. This is ideal for development environments or home labs.

## Features

- HTTP API for ingestion of Traces, Logs, and Metrics
- User interface to visualize telemetry signals
- Administration interface for login and maintenance rule management
- All-in-one container deployment
- Low memory footprint (<100MB)
- Supports up to 1 million signals (Traces, Logs, Metrics)

![](docs/images/Traces.png?raw=true)

![](docs/images/TracesStats.png?raw=true)

![](docs/images/Metrics.png?raw=true)

![](docs/images/Logs.png?raw=true)

## Specification

- Deployed as a single container
- Target memory usage: <100MB
- Ingestion via HTTP API (use an [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) for other protocols)
- Storage optimized for fewer than 1 million signals

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

| Parameter                                               | Description                                      | Default | Availability                        |
| ------------------------------------------------------- | ------------------------------------------------ | ------- | ----------------------------------- |
| OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS    | Interval (in seconds) to export logs             | 60      | Config file                         |
| OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS | Interval (in seconds) to export metrics          | 60      | Config file                         |
| METRICS_COMPRESS_MINUTE_THRESHOLD_HOURS                 | Hours before minute-level metrics are compressed | 12      | Config file                         |
| METRICS_COMPRESS_HOUR_THRESHOLD_DAYS                    | Days before hour-level metrics are compressed    | 7       | Config file                         |
| OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER              | Authorization header for OTel collection         | (empty) | Config file or environment variable |

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

## Contributing

Contributions are welcome! Please open issues or pull requests on [GitHub](https://github.com/DidierHoarau/otel-light).
