# BUILD
FROM node:26-alpine as builder

WORKDIR /opt/src

RUN apk add --no-cache bash git python3 perl alpine-sdk

COPY otel-light-server otel-light-server

RUN cd otel-light-server && \
    npm ci && \
    npm run build && \
    npm prune --omit=dev

COPY otel-light-web otel-light-web

RUN cd otel-light-web && \
    npm ci && \
    npm run generate

# RUN
FROM node:26-alpine

RUN apk add --no-cache kubectl gzip

COPY entrypoint.sh /entrypoint.sh

COPY --from=builder /opt/src/otel-light-server/node_modules /opt/app/otel-light/node_modules
COPY --from=builder /opt/src/otel-light-server/dist /opt/app/otel-light/dist
COPY --from=builder /opt/src/otel-light-web/.output/public /opt/app/otel-light/web
COPY otel-light-server/config.json /opt/app/otel-light/config.json
COPY otel-light-server/sql /opt/app/otel-light/sql
COPY package.json /opt/app/otel-light/package.json

# The entrypoint rewrites web/manifest.webmanifest with sed -i, which needs
# write access to the file's directory; everything else just needs to be
# readable by the non-root user below.
RUN chown -R node:node /opt/app/otel-light

WORKDIR /opt/app/otel-light

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${API_PORT:-8080}/api/status" >/dev/null || exit 1

ENTRYPOINT [ "/entrypoint.sh" ]
