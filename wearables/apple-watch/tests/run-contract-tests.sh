#!/bin/sh
set -eu

test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
watch_root=$(dirname -- "$test_dir")
repo_root=$(CDPATH= cd -- "$watch_root/../.." && pwd)
binary_path="${TMPDIR:-/tmp}/napivo-watch-contract-probe"

xcrun swiftc \
  -D NAPIVO_CONTRACT_TESTS \
  "$watch_root/_shared/WearableContract.swift" \
  "$watch_root/_shared/WatchDataStore.swift" \
  "$watch_root/watch-app/Services/NearbyPubsClient.swift" \
  "$test_dir/ContractFixtureProbe.swift" \
  -o "$binary_path"

"$binary_path" "$repo_root/wearables/shared/fixtures"
"$test_dir/run-nearby-refresh-tests.sh"
