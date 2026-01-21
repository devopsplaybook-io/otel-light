#!/bin/bash

set -e

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"

pm2 delete all || true


# Environment Variables
if [ -f "${REPO_DIR}/docs/dev/env.sh" ]; then
    . ${REPO_DIR}/docs/dev/env.sh
fi


# Monitoring
cd "${REPO_DIR}/docs/dev/postgres"
docker compose down || true
docker compose up -d || true


# Server
cd "${REPO_DIR}/otel-light-server"
if [ ! -f package-lock.json ]; then
    rm -fr node_modules
    npm install
fi
if [ ! -d node_modules ]; then
    npm ci
fi

# Web
cd "${REPO_DIR}/otel-light-web"
if [ ! -f package-lock.json ]; then
    rm -fr node_modules
    npm install
fi
if [ ! -d node_modules ]; then
    npm ci
fi

# Start
cd "${REPO_DIR}"
pm2 start ecosystem.config.js --env development
pm2 logs
# pm2 logs otel-light-server
