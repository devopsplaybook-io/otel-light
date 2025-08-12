#!/bin/bash

set -e

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"

pm2 delete all || true

# Server
cd "${REPO_DIR}/otel-light-server"
rm -fr node_modules
rm -f package-lock.json
npm install

# Agent
cd "${REPO_DIR}/otel-light-web"
rm -fr node_modules
rm -f package-lock.json
npm install

