#!/usr/bin/env bash
set -euo pipefail

SERVICE_DIR="$( cd "$( dirname "$0" )" && pwd )"
cd "${SERVICE_DIR}"

# Dev-only reverse proxy. The pinned binary is verified against the release
# checksums before use; update the version and SHA256 together.
TRAEFIK_VERSION="v2.11.63"
TRAEFIK_ARCHIVE="traefik_${TRAEFIK_VERSION}_linux_amd64.tar.gz"
TRAEFIK_URL="https://github.com/traefik/traefik/releases/download/${TRAEFIK_VERSION}/${TRAEFIK_ARCHIVE}"
TRAEFIK_SHA256="123faa87040cbdf5e4c75f53645c3b3c54f31ad1e90c14f08918b37193e74227"

if [ -x bin/traefik ]; then
    INSTALLED_VERSION="$(./bin/traefik version 2>/dev/null | sed -n 's/^Version: *//p' | head -n1 || true)"
else
    INSTALLED_VERSION=""
fi

if [ "${INSTALLED_VERSION}" != "${TRAEFIK_VERSION#v}" ]; then
    rm -rf bin
    mkdir -p bin
    cd bin
    curl -fsSLO "${TRAEFIK_URL}"
    echo "${TRAEFIK_SHA256}  ${TRAEFIK_ARCHIVE}" | sha256sum -c -
    tar -xzf "${TRAEFIK_ARCHIVE}"
    rm -f "${TRAEFIK_ARCHIVE}"
    cd "${SERVICE_DIR}"
fi

./bin/traefik \
    --entryPoints.web.address=:9012 \
    --providers.file.watch=true \
    --providers.file.filename=traefik-rules.yml \
    --entrypoints.dashboard.address=:9091 \
    --api=true \
    --api.dashboard=true
