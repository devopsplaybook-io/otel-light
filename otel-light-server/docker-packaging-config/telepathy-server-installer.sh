#!/bin/bash

set -e

# Init
if [ "$(uname -a | grep Linux | grep x86_64)" != "" ]; then
    ARCH=linux-x64
fi
if [ "$(uname -a | grep Linux | grep armv7)" != "" ]; then
    ARCH=linux-armv7
fi
if [ "$(uname -a | grep Linux | grep armv6)" != "" ]; then
    ARCH=linux-armv6
fi
if [ "${ARCH}" == "" ]; then
    echo Unsupported achitecture
    exit 1
fi
mkdir -p /opt/telepathy/
mkdir -p /etc/telepathy/
kill $(ps -ef | grep telepathy-server | grep -v installer | tr -s " " | cut -f2 -d" ") >> /dev/null || true

# Binaries
cd /opt/telepathy/
rm -fr telepathy-server-installer.sh
rm -fr telepathy-server-${ARCH}
wget https://s3-ap-southeast-1.amazonaws.com/telepathy-dist/telepathy-server-${ARCH}
wget https://s3-ap-southeast-1.amazonaws.com/telepathy-dist/telepathy-server-list
wget https://s3-ap-southeast-1.amazonaws.com/telepathy-dist/telepathy-server-installer.sh

# Config
cd /opt/telepathy/
cat telepathy-server-list | grep ${ARCH} | cut -f2 -d":" > version-server
if [ ! -f /etc/telepathy/config-server.json ]; then
echo '{
    "UPDATE_AUTO": true,
    "UPDATE_URL_INFO": "https://s3-ap-southeast-1.amazonaws.com/telepathy-dist/telepathy-server-list",
    "UPDATE_URL_BINARY": "https://s3-ap-southeast-1.amazonaws.com/telepathy-dist/telepathy-server-'${ARCH}'"
}
' > /etc/telepathy/config-server.json
fi
rm telepathy-server-list

# Auto Run
cd /opt/telepathy/
chmod +x telepathy-server-installer.sh
chmod +x telepathy-server-${ARCH}
echo '[Unit]
Description = Telepathy server
After = network.target

[Service]
ExecStart = /opt/telepathy/telepathy-server-'${ARCH}'

[Install]
WantedBy = multi-user.target' > /etc/systemd/system/telepathy-server.service
systemctl enable telepathy-server.service
systemctl restart telepathy-server.service
