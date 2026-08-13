#!/usr/bin/env bash
# Builds the deployable production package: /home/user/workspace/mosc-tools-ontime-sync.zip
# Contents: dist/ (built), runtime-only package.json + package-lock.json, Dockerfile, DEPLOY.md, README.md
# Excluded: mock/, data.db, node_modules, sources.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/../mosc-tools-ontime-sync.zip}"
stage="$(mktemp -d)"

cd "$root"
npm run build

cp -r dist "$stage/dist"
cp deploy/package.runtime.json "$stage/package.json"
cp deploy/package-lock.runtime.json "$stage/package-lock.json"
cp deploy/Dockerfile deploy/DEPLOY.md README.md "$stage/"

rm -f "$out"
(cd "$stage" && zip -rq "$out" .)
rm -rf "$stage"
echo "packaged -> $out"
