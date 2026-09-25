#!/usr/bin/env bash
# Bundle the home page coaster scene with the parts of three.js it uses.
# Output is committed, so production needs no Node and the page loads nothing from a CDN.
set -euo pipefail

cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

npm install --silent --no-audit --no-fund --prefix "$tmp" three@0.186.1 esbuild@0.28.2
NODE_PATH="$tmp/node_modules" "$tmp/node_modules/.bin/esbuild" pubs/landing/coaster.js \
  --bundle --minify --format=esm --target=es2020 --legal-comments=eof --tsconfig-raw={} \
  --outfile=pubs/static/pubs/landing/coaster.min.js
