<template>
  <div class="first-run-guidance">
    <h3><i class="bi bi-rocket-takeoff"></i> Send your first signal</h3>
    <p>
      No services have reported yet. Point any OpenTelemetry SDK or Collector
      exporting OTLP/HTTP at one of these endpoints:
    </p>
    <ul class="first-run-endpoints">
      <li>
        <i class="bi bi-list-nested"></i> Traces:
        <code>POST {{ origin }}/v1/traces</code>
      </li>
      <li>
        <i class="bi bi-bar-chart-line"></i> Metrics:
        <code>POST {{ origin }}/v1/metrics</code>
      </li>
      <li>
        <i class="bi bi-card-text"></i> Logs:
        <code>POST {{ origin }}/v1/logs</code>
      </li>
    </ul>
    <p class="first-run-auth">
      <i class="bi bi-shield-lock"></i>
      If the server has
      <code>OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER</code> configured, add
      an <code>Authorization: Bearer &lt;token&gt;</code> header with that
      value to ingestion requests.
    </p>
    <h4>Quick start: send a log entry with curl</h4>
    <pre class="first-run-snippet"><code>{{ curlExample }}</code></pre>
  </div>
</template>

<script>
export default {
  data() {
    return {
      origin: window.location.origin,
    };
  },
  computed: {
    curlExample() {
      return `curl -X POST ${this.origin}/v1/logs \\
  -H "Content-Type: application/json" \\
  -d '{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"my-service"}},{"key":"service.version","value":{"stringValue":"1.0.0"}}]},"scopeLogs":[{"scope":{},"logRecords":[{"timeUnixNano":"1750000000000000000","severityText":"INFO","body":{"stringValue":"hello from otel-light"}}]}]}]}'`;
    },
  },
};
</script>

<style scoped>
.first-run-guidance {
  text-align: left;
  max-width: 60rem;
  margin: 0 auto;
}
.first-run-guidance h3 i,
.first-run-guidance h4 i {
  margin-right: 0.4rem;
}
.first-run-endpoints {
  list-style: none;
  padding-left: 0;
}
.first-run-endpoints i {
  margin-right: 0.4rem;
}
.first-run-auth {
  font-size: 0.85em;
  opacity: 0.8;
}
.first-run-snippet {
  overflow-x: auto;
  font-size: 0.8em;
  text-align: left;
}
</style>
