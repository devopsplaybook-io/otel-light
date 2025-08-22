#/bin/bash

SERVICE_DIR="$( cd "$( dirname "$0" )" && pwd )"
cd ${SERVICE_DIR}

if [ ! -d bin ]; then
    mkdir -p bin
    cd bin
    wget https://github.com/traefik/traefik/releases/download/v2.9.6/traefik_v2.9.6_linux_amd64.tar.gz
    tar -xzf *.tar.gz
    cd ..
fi

cd ${SERVICE_DIR}
./bin/traefik \
    --entryPoints.web.address=:9999 \
    --entryPoints.websecure.address=:9998 \
    --providers.file.watch=true \
    --providers.file.filename=traefik-rules.yml \
    --entrypoints.dashboard.address=:9091 \
    --api=true \
    --api.dashboard=true