module.exports = {
  apps: [
    {
      name: "proxy",
      script: "nginx",
      args: ["-g", "daemon off;"],
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "server",
      script: "dist/App.js",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
