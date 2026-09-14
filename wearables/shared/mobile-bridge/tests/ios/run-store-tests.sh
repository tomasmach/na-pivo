#!/bin/sh
set -eu

test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
bridge_root=$(CDPATH= cd -- "$test_dir/../.." && pwd)
repo_root=$(CDPATH= cd -- "$bridge_root/../../.." && pwd)
binary_path="${TMPDIR:-/tmp}/napivo-ios-bridge-store-probe"

xcrun swiftc \
  -D NAPIVO_BRIDGE_TESTS \
  -D NAPIVO_CONTRACT_TESTS \
  "$repo_root/wearables/apple-watch/_shared/WearableContract.swift" \
  "$bridge_root/ios/NaPivoWearableBridgeStore.swift" \
  "$test_dir/BridgeStoreProbe.swift" \
  -o "$binary_path"

"$binary_path"
