#!/bin/sh

if [ "${APPLICATION_TITLE}" == "" ]; then
  APPLICATION_TITLE="OTEL Light"
fi

sed -i "s/APPLICATION_TITLE/$APPLICATION_TITLE/g" /opt/app/otel-light/web/manifest.webmanifest

node dist/app.js