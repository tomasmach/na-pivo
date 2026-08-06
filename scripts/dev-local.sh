#!/usr/bin/env bash
# Local dev runner: applies backend migrations, starts the Django backend,
# then builds and launches the app in the iOS simulator. On exit (Ctrl+C)
# it stops the backend it started and shuts down the simulator.
set -euo pipefail

# CocoaPods reads the Podfile path through Ruby's unicode_normalize, which raises
# on an ASCII-8BIT locale — `pod install` then dies before the pods are even read.
# A non-interactive shell (CI, an agent, `npm run dev` from a bare env) has no
# LANG at all, so set one here rather than expecting every shell profile to.
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-$LANG}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$(cd "$REPO_ROOT/backend" 2>/dev/null && pwd || true)"
# 8012 = the dvanactka of ports; 80xx range, but clear of 8000/8080/8081
BACKEND_PORT="${EXPO_PUBLIC_BACKEND_PORT:-8012}"
export EXPO_PUBLIC_BACKEND_PORT="$BACKEND_PORT"
# The WidgetKit target powers the shipped beer-counter Live Activity, but it is
# irrelevant for ordinary simulator work and substantially inflates clean local
# builds. Release/EAS builds do not set this flag and keep the extension.
export NA_PIVO_SKIP_IOS_WIDGETS=1

if [ -z "$BACKEND_DIR" ]; then
  echo "Backend directory not found in this repo (expected backend/)" >&2
  exit 1
fi

BACKEND_PID=""
STARTED_BACKEND=0
CLEANED_UP=0

cleanup() {
  [ "$CLEANED_UP" = 1 ] && return
  CLEANED_UP=1
  echo ""
  echo "==> Shutting down"
  if [ "$STARTED_BACKEND" = 1 ] && [ -n "$BACKEND_PID" ]; then
    pkill -P "$BACKEND_PID" 2>/dev/null || true
    kill "$BACKEND_PID" 2>/dev/null || true
    # runserver's autoreload child can outlive its parent; free the port
    lsof -ti "tcp:$BACKEND_PORT" | xargs kill 2>/dev/null || true
  fi
  xcrun simctl shutdown booted 2>/dev/null || true
  osascript -e 'quit app "Simulator"' 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Applying backend migrations"
(cd "$BACKEND_DIR" && uv run python manage.py migrate)

if lsof -ti "tcp:$BACKEND_PORT" >/dev/null 2>&1; then
  echo "==> Backend already running on port $BACKEND_PORT, reusing it (won't be stopped on exit)"
else
  echo "==> Starting backend on 0.0.0.0:$BACKEND_PORT"
  (cd "$BACKEND_DIR" && exec uv run python manage.py runserver "0.0.0.0:$BACKEND_PORT") &
  BACKEND_PID=$!
  STARTED_BACKEND=1
  BACKEND_READY=0
  for _ in $(seq 1 30); do
    # -fs, not -fsS: a refused connection is the normal state of the first second
    # or two, and printing "curl: (7)" once a second reads like a failure.
    if curl -fs "http://127.0.0.1:$BACKEND_PORT/v1/health" >/dev/null; then
      BACKEND_READY=1
      break
    fi
    # `$!` is the `uv run` wrapper, not necessarily the process that ends up
    # holding the port, so a dead PID on its own is not proof of a dead backend
    # — it used to kill runs whose server was already printing its banner. Give
    # up only when nothing is listening either.
    if ! kill -0 "$BACKEND_PID" 2>/dev/null &&
      ! lsof -ti "tcp:$BACKEND_PORT" >/dev/null 2>&1; then
      echo "Backend failed to start" >&2
      exit 1
    fi
    sleep 1
  done
  if [ "$BACKEND_READY" != 1 ]; then
    # Never build the app against a backend that never answered.
    echo "Backend did not answer /v1/health on port $BACKEND_PORT within 30s" >&2
    exit 1
  fi
fi

echo "==> Syncing native iOS configuration"
cd "$REPO_ROOT"
# The native project is generated and gitignored. Regenerate it from scratch so
# targets from config plugins on another branch cannot survive a branch switch.
npx expo prebuild --clean --platform ios --no-install
(cd "$REPO_ROOT/ios" && pod install)

echo "==> Building and launching the iOS app"
npm run ios:local
