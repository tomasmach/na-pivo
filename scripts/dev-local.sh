#!/usr/bin/env bash
# Local dev runner: applies backend migrations, starts the Django backend,
# then builds and launches the app in the iOS simulator. On exit (Ctrl+C)
# it stops the backend it started and shuts down the simulator.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$(cd "$REPO_ROOT/backend" 2>/dev/null && pwd || true)"
# 8012 = the dvanactka of ports; 80xx range, but clear of 8000/8080/8081
BACKEND_PORT="${EXPO_PUBLIC_BACKEND_PORT:-8012}"
export EXPO_PUBLIC_BACKEND_PORT="$BACKEND_PORT"

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
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$BACKEND_PORT/v1/health" >/dev/null; then
      break
    fi
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      echo "Backend failed to start" >&2
      exit 1
    fi
    sleep 1
  done
fi

echo "==> Syncing native iOS configuration"
cd "$REPO_ROOT"
npx expo prebuild --platform ios --no-install
(cd "$REPO_ROOT/ios" && pod install)

echo "==> Building and launching the iOS app"
npm run ios:local
