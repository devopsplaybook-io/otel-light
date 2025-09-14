#!/bin/sh

if [ "${APPLICATION_TITLE}" == "" ]; then
  APPLICATION_TITLE="OTel Light"
fi

sed -i "s/APPLICATION_TITLE/$APPLICATION_TITLE/g" /opt/app/otel-light/web/manifest.webmanifest

pm2 start ecosystem.config.js
pm2 logs
