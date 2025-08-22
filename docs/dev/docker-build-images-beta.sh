#!/bin/bash

set -e

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"
cd ${REPO_DIR}

SERVICE_NAME="otel-light"
SERVICE_VERSION=$(cat ${REPO_DIR}/package.json | jq -r '.version')
SERVICE_VERSION_MAJOR=$(cat ${REPO_DIR}/package.json | grep \"version\" | cut -f4 -d"\"" | cut -f1 -d".")
SERVICE_VERSION_MINOR=$(cat ${REPO_DIR}/package.json | grep \"version\" | cut -f4 -d"\"" | cut -f1-2 -d".")

echo "Building ${SERVICE_NAME}/${SERVICE_VERSION}"

docker buildx build \
  --platform linux/arm64/v8,linux/amd64 \
   --push \
  -f Dockerfile \
  -t devopsplaybookio/${SERVICE_NAME}:beta \
  .
