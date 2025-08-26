# BUILD
FROM node:22-alpine as builder

WORKDIR /opt/src

RUN apk add --no-cache bash git python3 perl alpine-sdk

COPY otel-light-server otel-light-server

RUN cd otel-light-server && \
    npm ci && \
    npm run build

COPY otel-light-web otel-light-web

RUN cd otel-light-web && \
    npm ci && \
    npm run generate

# RUN
FROM node:22-alpine

RUN apk add --no-cache kubectl gzip

COPY entrypoint.sh /entrypoint.sh

COPY --from=builder /opt/src/otel-light-server/node_modules /opt/app/otel-light/node_modules
COPY --from=builder /opt/src/otel-light-server/dist /opt/app/otel-light/dist
COPY --from=builder /opt/src/otel-light-web/.output/public /opt/app/otel-light/web
COPY otel-light-server/config.json /opt/app/otel-light/config.json
COPY otel-light-server/sql /opt/app/otel-light/sql
COPY package.json /opt/app/otel-light/package.json

WORKDIR /opt/app/otel-light

ENTRYPOINT [ "/entrypoint.sh" ]