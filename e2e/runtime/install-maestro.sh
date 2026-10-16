#!/usr/bin/env bash
set -euo pipefail
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_DISABLE_UPDATE_CHECK=true MAESTRO_API_URL=http://127.0.0.1:9
cd "$(dirname "$0")/../.."
mkdir -p .e2e/tools
if [[ -x .e2e/tools/maestro/bin/maestro ]] && [[ "$(.e2e/tools/maestro/bin/maestro --version)" == 2.11.0 ]]; then
  exit 0
fi
archive=".e2e/tools/maestro.zip"
trap 'rm -f "$archive"' EXIT
curl -fL --connect-timeout 15 --max-time 120 --silent --show-error \
  https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.11.0/maestro.zip -o "$archive"
echo "5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a  $archive" | shasum -a 256 -c -
unzip -qo "$archive" -d .e2e/tools
.e2e/tools/maestro/bin/maestro --version
