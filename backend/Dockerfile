# syntax=docker/dockerfile:1

# uv-provided image with Python 3.14 preinstalled (Debian trixie slim).
# Matches .python-version (3.14) and the uv-managed workflow used in dev.
FROM ghcr.io/astral-sh/uv:python3.14-trixie-slim

# --- Python / uv runtime behaviour ----------------------------------------
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# --- Dependency layer (cached unless lock / pyproject change) --------------
# Resolve third-party deps first so editing source doesn't bust this layer.
# --extra prod pulls gunicorn + the ASGI worker; --no-dev drops pytest/ruff.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --extra prod --no-install-project

# --- Application source -----------------------------------------------------
COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --extra prod

RUN chmod +x docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
