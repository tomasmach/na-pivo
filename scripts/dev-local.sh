#!/usr/bin/env bash
# Local dev runner: applies backend migrations, starts the Django ASGI backend,
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
    # The ASGI reloader child can outlive its parent; free the port as a final
    # guard so the next `npm run dev` never reuses a stale backend.
    lsof -ti "tcp:$BACKEND_PORT" | xargs kill 2>/dev/null || true
  fi
  # The simulator is only torn down when this runner OWNS the session. Set
  # NAPIVO_KEEP_SIM=1 when something else supervises the process — an agent's
  # background shell, a detached terminal, tmux — because there the runner exits
  # for reasons that have nothing to do with you being finished, and taking the
  # simulator down with it looks exactly like the app crashing.
  if [ "${NAPIVO_KEEP_SIM:-0}" != "1" ]; then
    xcrun simctl shutdown booted 2>/dev/null || true
    osascript -e 'quit app "Simulator"' 2>/dev/null || true
  else
    echo "==> Simulátor nechávám běžet (NAPIVO_KEEP_SIM=1)"
  fi
}
trap cleanup EXIT INT TERM

echo "==> Applying backend migrations"
(cd "$BACKEND_DIR" && uv run python manage.py migrate)

if lsof -ti "tcp:$BACKEND_PORT" >/dev/null 2>&1; then
  echo "==> Backend already running on port $BACKEND_PORT, reusing it (won't be stopped on exit)"
else
  echo "==> Starting backend on 0.0.0.0:$BACKEND_PORT"
  # The shared party-game endpoint is an async SSE stream. Django's WSGI
  # `runserver` adapts its async iterator synchronously, which both hides the
  # production behaviour and can fail while a stream is being disconnected.
  # Run the same ASGI application and Uvicorn event loop used in production.
  (cd "$BACKEND_DIR" && exec uv run --extra prod uvicorn config.asgi:application \
    --host 0.0.0.0 \
    --port "$BACKEND_PORT" \
    --reload \
    --reload-dir "$BACKEND_DIR" \
    --timeout-graceful-shutdown 3) &
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
# The native project is generated and gitignored. Regenerate it from scratch so
# targets from config plugins on another branch cannot survive a branch switch.
npx expo prebuild --clean --platform ios --no-install
(cd "$REPO_ROOT/ios" && pod install)

echo "==> Building and launching the iOS app"
npm run ios:local
