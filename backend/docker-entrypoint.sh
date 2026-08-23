#!/bin/sh
# Container entrypoint for the na-pivo backend web service.
# Applies DB migrations, collects static files, then hands off to gunicorn.
set -e

echo "[entrypoint] validating production configuration..."
python manage.py check --deploy

echo "[entrypoint] applying database migrations..."
python manage.py migrate --no-input

echo "[entrypoint] collecting static files..."
python manage.py collectstatic --no-input

echo "[entrypoint] starting gunicorn (uvicorn workers) on :8000..."
# ASGI, not WSGI, and uvicorn workers rather than sync ones.
#
# This is what the live game stream needs. Under the previous sync workers an
# open server-sent-events connection owned one of the two workers for as long as
# it stayed open, so two people watching a game at one table would have taken the
# whole API down for everyone — and --timeout 120 would have killed the stream
# every two minutes anyway. On the event loop an idle stream costs a socket.
#
# Everything else is unchanged: the same Django app, the same views. Sync views
# keep running in a threadpool exactly as before.
#
# --timeout 0 : the worker timeout is a watchdog for BLOCKED workers, which an
#   async worker holding a long-lived stream is not. Left at 120 it would cut
#   every stream; uvicorn workers are documented to run with it disabled.
# --forwarded-allow-ips=* : trust X-Forwarded-* from the Caddy reverse proxy
#   (it lives on a private Docker network, not 127.0.0.1) so Django's
#   SECURE_PROXY_SSL_HEADER sees the real https scheme and skips redirect loops.
exec gunicorn config.asgi:application \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8000 \
    --workers 2 \
    --timeout 0 \
    --forwarded-allow-ips="*" \
    --access-logfile - \
    --access-logformat 'method=%(m)s status=%(s)s duration_s=%(L)s' \
    --error-logfile -
