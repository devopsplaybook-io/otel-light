#!/bin/bash

set -e

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"

pm2 delete all || true

update_dependencies_in_folder() {
	local target_dir="$1"

	echo "==== Updating dependencies in: ${target_dir}"

	cd "${target_dir}"

	# Update dependency ranges in package.json where possible.
	npx --yes npm-check-updates -u || true

	rm -fr node_modules
	rm -f package-lock.json

	npm install

	# Best effort audit remediation.
	npm audit fix || true
	npm audit fix --force || true
}

for dir in "${REPO_DIR}"/*; do
	if [[ -d "${dir}" && -f "${dir}/package.json" ]]; then
		update_dependencies_in_folder "${dir}"
	fi
done
