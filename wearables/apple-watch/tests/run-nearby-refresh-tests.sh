#!/bin/sh
set -eu

test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
watch_root=$(dirname -- "$test_dir")
binary_path="${TMPDIR:-/tmp}/napivo-watch-nearby-refresh-probe"

xcrun swiftc \
  "$watch_root/watch-app/Services/NearbyRefreshGate.swift" \
  "$test_dir/NearbyRefreshGateProbe.swift" \
  -o "$binary_path"

"$binary_path"
