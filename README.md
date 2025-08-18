# otel-light

otel-light is a lightweight, easy-to-use OpenTelemetry (OTel) instrumentation library designed for rapid integration and minimal overhead. It provides essential observability features for your applications, enabling distributed tracing and metrics collection with minimal configuration.

## Features

- Minimal setup and configuration
- Supports distributed tracing and metrics
- Compatible with OpenTelemetry Collector and exporters
- Lightweight and fast
- Suitable for microservices and serverless environments

## Installation

# Deployment

FeedWatcher is designed to be deployed as a container.

- The Docker image is: `didierhoarau/otel-light` [https://hub.docker.com/r/didierhoarau/otel-light](https://hub.docker.com/r/didierhoarau/otel-light)
- This image exposes port `8080`
- The volume is located at `/data`

## Docker

You can, for example, run the following command to run FeedWatcher in Docker:

```bash
mkdir -p data
docker run --name otel-light -p 8080:8080 -v "$(pwd)/data:/data" -d didierhoarau/otel-light
```

## Kubernetes

The following manifest can be used to deploy in Kubernetes:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: otel-light
  labels:
    app: otel-light
spec:
  replicas: 1
  selector:
    matchLabels:
      app: otel-light
  template:
    metadata:
      labels:
        app: otel-light
    spec:
      containers:
        - image: otel-light
          name: otel-light
          resources:
            limits:
              memory: 500Mi
              cpu: 1
            requests:
              memory: 200Mi
              cpu: 100m
          volumeMounts:
            - mountPath: /data
              name: pod-volume
          imagePullPolicy: Always
          readinessProbe:
            httpGet:
              path: /api/status
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3
      volumes:
        - name: pod-volume
          persistentVolumeClaim:
            claimName: otel-light
---
apiVersion: v1
kind: Service
metadata:
  name: otel-light
spec:
  ports:
    - name: tcp
      port: 8080
      targetPort: 8080
  selector:
    app: otel-light
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: otel-light
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
```

Check the [docs/deployments](docs/deployments) for more examples of deployments.
