#!/usr/bin/env bash
# Keep the existing entry point for terminals and tooling.
set -euo pipefail
exec node "$(dirname "$0")/dev-local.js" "$@"
