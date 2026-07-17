#!/bin/sh
# Container entrypoint for the na-pivo backend web service.
# Applies DB migrations, collects static files, then hands off to gunicorn.
set -e

echo "[entrypoint] applying database migrations..."
python manage.py migrate --no-input

echo "[entrypoint] collecting static files..."
python manage.py collectstatic --no-input

echo "[entrypoint] starting gunicorn on :8000..."
# --forwarded-allow-ips=* : trust X-Forwarded-* from the Caddy reverse proxy
#   (it lives on a private Docker network, not 127.0.0.1) so Django's
#   SECURE_PROXY_SSL_HEADER sees the real https scheme and skips redirect loops.
exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers 2 \
    --timeout 120 \
    --forwarded-allow-ips="*" \
    --access-logfile - \
    --error-logfile -
