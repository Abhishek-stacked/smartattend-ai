# syntax=docker/dockerfile:1
# Single-container image for hosts that expose one port (Render, and similar PaaS).
# Caddy serves the built SPA and proxies /api to uvicorn on 127.0.0.1:8000.
# Caddy listens on $PORT, which those hosts assign at runtime.

FROM node:24-alpine AS web

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.10-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    CADDY_VERSION=2.8.4

# libglib2.0-0 satisfies OpenCV's headless build; libgomp1 is required by onnxruntime.
RUN apt-get update \
    && apt-get install --no-install-recommends -y libglib2.0-0 libgomp1 curl ca-certificates \
    && curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" \
       | tar -xz -C /usr/local/bin caddy \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt supervisor

COPY backend/ /app/backend/
COPY ai_service/ /app/ai_service/
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY deploy/web/supervisord.conf /etc/supervisord.conf
COPY --from=web /app/dist /srv/web

# YuNet and SFace are fetched from OpenCV Zoo and checked against pinned hashes;
# only the small converted liveness model travels with the source tree.
RUN python /app/ai_service/scripts/fetch_models.py

RUN groupadd --system app \
    && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app \
    && chown -R app:app /app /srv/web /etc/caddy /etc/supervisord.conf
USER app

# The host injects PORT; 7860 is only the fallback baked into the Caddyfile.
EXPOSE 7860

CMD ["supervisord", "-c", "/etc/supervisord.conf"]
