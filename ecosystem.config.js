module.exports = {
  apps: [
    {
      name: "otel-light-proxy",
      cwd: "otel-light-proxy",
      script: "npm",
      args: "run start",
      autorestart: false,
      ignore_watch: ["node_modules"],
    },
    {
      name: "otel-light-server",
      cwd: "otel-light-server",
      script: "npm",
      args: "run dev",
      autorestart: false,
      env_development: {
        DEV_MODE: "true",
        DATA_DIR: "../docs/dev/data",
        OPENTELEMETRY_COLLECTOR_HTTP: "http://localhost:9999/api/v1/traces",
        OPENTELEMETRY_COLLECTOR_AWS: true,
      },
    },
    {
      name: "otel-light-web",
      cwd: "otel-light-web",
      script: "npm",
      args: "run dev",
      autorestart: false,
      env_development: {
        DEV_MODE: "true",
      },
    },
  ],
};
