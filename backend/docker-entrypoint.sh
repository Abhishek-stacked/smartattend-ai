#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL must be set}"

echo "Applying database migrations..."
alembic upgrade head

workers="${UVICORN_WORKERS:-1}"
if [ "$workers" -gt 1 ]; then
    echo "warning: rate limits and the recognition cooldown are per process; use one worker unless a shared store is added." >&2
fi

echo "Starting API on port ${PORT:-8000} with ${workers} worker(s)..."
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT:-8000}" \
    --workers "$workers" \
    --proxy-headers \
    --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-*}"
