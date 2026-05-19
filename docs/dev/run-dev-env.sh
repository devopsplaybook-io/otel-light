#!/bin/bash

set -e

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"

pm2 delete all || true


# Environment Variables
if [ -f "${REPO_DIR}/docs/dev/env.sh" ]; then
    . ${REPO_DIR}/docs/dev/env.sh
fi


# DB
cd "${REPO_DIR}/docs/dev/postgres"
docker compose down || true
docker compose up -d || true

install_dependencies_in_folder() {
	local target_dir="$1"

	echo "==== Installing dependencies in: ${target_dir}"

	cd "${target_dir}"

	if [ ! -f package-lock.json ]; then
		rm -fr node_modules
		npm install
	fi
	if [ ! -d node_modules ]; then
		npm ci
	fi
}

for dir in "${REPO_DIR}"/*; do
	if [[ -d "${dir}" && -f "${dir}/package.json" ]]; then
		install_dependencies_in_folder "${dir}"
	fi
done

# Start
cd "${REPO_DIR}"
pm2 start ecosystem.config.js --env development
pm2 logs
