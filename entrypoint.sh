#!/bin/sh

APPLICATION_TITLE="${APPLICATION_TITLE:-OTel Light}"

node dist/EntrypointManifest.js /opt/app/otel-light/web/manifest.webmanifest "$APPLICATION_TITLE"

node dist/App.js
