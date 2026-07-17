# Na pivo backend

Backend for Na pivo, a modern mobile beer diary for Czech and Slovak pubs, beers, evenings and friend groups.

Na pivo started as a compass that points users to the nearest pub. The mobile product is now moving toward a fuller beer diary: drink logs, visits, pub ratings, profiles, community data, stats, discovery, opening hours and lightweight gamification. This repository is the Django API behind that mobile app.

The backend should be boringly reliable, cheap to operate, careful with sensitive data and compatible with already released mobile builds.

---

## What this backend does

Current responsibilities include:

- anonymous device-bound accounts and bearer-token authentication;
- profile and account data controls;
- pub search, nearby pub suggestions and opening-hours enrichment;
- drink logs, visits, pub ratings and user-added pubs;
- release notes, feedback reports and pub reports;
- privacy-safe client events and usage stats;
- management commands and operational reports for debugging production behavior.

The Expo mobile app lives in `../na-pivo`.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Python 3.14, Django 6, Django REST Framework |
| DB (dev) | SQLite |
| DB (prod) | PostgreSQL via `psycopg[binary]` + `dj-database-url` |
| Package management | `uv` |
| WSGI (prod) | `gunicorn` |
| Scraping/enrichment | `requests`, Firmy.cz parsing, Mapy.cz integration |
| Opening-hours eval | `opening-hours-py` (Rust-backed OSM grammar) |
| Name/geo matching | `rapidfuzz` + haversine |

---

## Quick start

```bash
# 1. Clone and enter
git clone ... && cd na-pivo-backend

# 2. Create a .env file
cp .env.example .env
# Edit .env - at minimum set a real SECRET_KEY for non-throwaway use.

# 3. Install dependencies
uv sync

# 4. Run migrations
uv run python manage.py migrate

# 5. Optional: create a superuser
uv run python manage.py createsuperuser

# 6. Start the dev server
uv run python manage.py runserver
```

Useful local URLs:

| URL | Purpose |
|---|---|
| `http://localhost:8000/v1/health` | Health check |
| `http://localhost:8000/admin/` | Django admin when enabled |
| `http://localhost:8000/v1/pub-hours` | Opening-hours endpoint |

For local Expo testing on a physical device, bind the backend to the LAN interface:

```bash
uv run python manage.py runserver 0.0.0.0:8000
```

Then start the Expo app from `../na-pivo`:

```bash
npm run ios:local
```

In `DEBUG=True`, Django accepts LAN `Host` headers automatically. Production still uses explicit `ALLOWED_HOSTS`.

---

## Tests and checks

```bash
uv run pytest
uv run ruff check
```

Tests use an in-memory SQLite database and should not hit the network. Mock external services or use saved fixtures unless you are deliberately writing a separate live integration check.

---

## API compatibility

The backend must remain compatible with released mobile app versions. Users cannot all update immediately.

Prefer additive API changes. Do not remove response fields, request fields or existing state meanings without a migration path. If a breaking change is unavoidable, use versioning, dual behavior, a feature flag or a transition period.

---

## Privacy and sensitive data

Na pivo works with sensitive data: location, pubs, alcohol history, profiles and social activity.

Do not store raw GPS history or routes unless there is an explicit product decision. Prefer user-confirmed visits, local mobile calculations, coarse location, geohashes or aggregates where possible.

Server logs are JSON on stdout and should stay privacy-safe. They must not include request bodies, bearer tokens, cookies, proxy credentials, feedback contact data, emails or raw GPS points.

Bearer tokens are server-issued secrets and are stored as hashes. Per-user data should relate to the account model, not to token values.

---

## Costs, limits and abuse

This app has real users and the backend has real operating costs. New server features should consider:

- caching and invalidation;
- rate limits and throttling;
- database indexes and query count;
- external service costs;
- failure modes and retries;
- abuse scenarios;
- simple observability.

Do not assume proxy, scraping, map or enrichment traffic is free.

---

## Firmy.cz and external data

Opening-hours enrichment currently relies partly on **Firmy.cz** (Seznam business directory) and Mapy.cz-related data flows.

### Legal notice - Firmy.cz robots.txt

> `User-agent: *`
> `Disallow: /`

Firmy.cz's robots.txt bans all automated crawlers. Treat this part of the system as sensitive infrastructure, not as a casual scraper.

Important rules:

- Do not increase crawl volume, lower intervals, disable caps or bypass protections without an explicit product/ops decision.
- Keep results cached aggressively where possible.
- Keep jobs idempotent and resumable.
- Prefer clear logs, deduplication and failure visibility over silent best-effort scraping.
- For production scale, pursue a Seznam B2B data licence or the [Mapy.com Places API](https://developer.mapy.cz/).

### Consent cookie-wall and `FIRMY_PROXY_URL`

Firmy.cz detail pages sit behind a Seznam GDPR consent cookie-wall (`cmp.seznam.cz` / `cmp.firmy.cz`). Requests from flagged datacenter IPs can be bounced to the consent wall (`reason=missing`), so detail content is not served even with a cookie-aware session and autologin warmup.

The scraper therefore:

- seeds cookie-wall cookies via a homepage + autologin warmup on session creation;
- detects when a detail fetch was bounced to the consent wall and logs an actionable warning;
- may require `FIRMY_PROXY_URL` pointing at a residential proxy in production.

Running without a residential proxy from a datacenter IP can make detail fetches return `None` with status `unknown`. The search/matching pipeline can still be otherwise functional depending on the specific request path.

---

## Configuration reference

All settings are read from environment variables or a `.env` file. See `.env.example` for the full list.

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | insecure dev key | Django secret key |
| `DEBUG` | `True` | Enable debug mode |
| `ENABLE_DJANGO_ADMIN` | `True` in dev, `False` in prod | Register `/admin/` routes |
| `ALLOWED_HOSTS` | `*` in dev, env value in prod | Comma-separated allowed hosts |
| `DATABASE_URL` | SQLite | dj-database-url connection string |
| `FIRMY_PROXY_URL` | _(unset)_ | Residential proxy for Firmy.cz requests |
| `FIRMY_USER_AGENT` | mobile Chrome UA | User-Agent header for Firmy.cz |
| `FIRMY_MIN_INTERVAL_SEC` | `3` | Min seconds between Firmy.cz requests |
| `FIRMY_DAILY_CAP` | `2000` | Hard daily request cap |
| `HOURS_TTL_DAYS` | `30` | Days before cached hours are refreshed |
| `SYNC_ENRICH_BUDGET` | `3` | Max pubs enriched synchronously per API call; `0` makes cold lookups pending-only and leaves enrichment to the worker |
| `GOOGLE_MAPS_SERVER_API_KEY` | _(unset)_ | Backend-only, IP/API-restricted key for explicit Geocoding API v4 fallbacks; never ship it in Expo |
| `GOOGLE_MAPS_TIMEOUT` | `8` | Timeout in seconds for an explicit Google geocode |
| `GOOGLE_MAPS_DAILY_CAP` | `250` | Shared DB-backed request cap across all Google geocoding entry points and workers |
| `GOOGLE_MAPS_LOCAL_SCAN_LIMIT` | `80` | Maximum local directory candidates scanned by name lookup before trimming the response |
| `PUB_LOCATION_LOOKUP_THROTTLE_RATE` | `30/min` | Per-IP rate limit for local autocomplete and explicit geocoding |
| `PUBS_NEAR_MAX_AMENITY_FILTERS` | `5` | Maximum AND-matched amenity keys accepted by one nearby search |
| `MAP_AMENITY_CONFIDENCE_FLOOR` | `0.5` | Minimum community confidence for an amenity to qualify as a hard filter match |
| `MAP_AMENITY_SCAN_LIMIT` | `200` | Maximum nearby aggregate rows scanned per selected amenity |
| `CORS_ALLOWED_ORIGINS` | Expo localhost | Comma-separated CORS origins |
| `ACCOUNT_REGISTER_THROTTLE_RATE` | `120/min` | Per-IP rate limit for `POST /v1/account` |
| `PUBS_NEAR_THROTTLE_RATE` | `60/min` | Per-IP rate limit for `GET /v1/pubs/near` |
| `PUB_HOURS_THROTTLE_RATE` | `120/min` | Per-IP rate limit for `POST /v1/pub-hours` |
| `PUB_REPORTS_THROTTLE_RATE` | `30/min` | Per-IP rate limit for `POST /v1/pub-reports` |
| `CLIENT_EVENTS_THROTTLE_RATE` | `120/min` | Per-IP rate limit for `POST /v1/client-events` |
| `LOG_LEVEL` | `INFO` | Structured JSON log level |

---

## Anonymous device accounts

Every install currently gets an anonymous, device-bound account automatically. The mobile app generates and persists a `device_id` (UUID v4) and calls:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/account` | none for new `device_id`; Bearer required to rotate an existing account token | Ensure an account for a `device_id`; returns `{id, device_id, token, created, created_at}` on creation or authenticated rotation. |
| `GET` | `/v1/account/me` | `Authorization: Bearer <token>` | Return the calling account (`id, device_id, created_at, last_seen_at`); never echoes the token. |

The bearer token is returned once at registration and stored only as a SHA-256 hash (`token_hash`). Re-registration for an existing `device_id` rotates it only when the request already presents the valid Bearer token for that same account.

The `account` and other DRF throttles should be backed by a shared cache such as Redis or Memcached for exact global limits in production. The default `LocMemCache` is per-process, so under multiple gunicorn workers the effective limit is `rate x workers`.

---

## Observability and stats

Server logs include a privacy-safe request id, path, status, duration, app version headers and a hashed client IP.

The Expo app sends a small event whitelist to:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/client-events` | optional `Authorization: Bearer <token>` | App opens, foregrounds, counter usage, drink sync results, sanitized warnings/errors/API failures and walking-distance meter increments. |

Authenticated events update `AccountUsageStats`. Counter events are product-level only: no pub names, beer names, drink ids or GPS coordinates are accepted. Walking distance is computed on-device; the backend stores only meter increments, not coordinates or routes.

Agent-friendly reports:

```bash
uv run python manage.py observability_report --days 7 --format markdown
uv run python manage.py observability_report --days 7 --format json
```

The report includes usage totals, top walkers, client error/API-failure breakdowns and recent feedback with contact-like text redacted.

---

## Deploy (Docker Compose)

Production runs as **Docker Compose** at `/opt/na-pivo` on a Hetzner VPS (`api.na-pivo.cz`), behind a shared **Caddy** reverse proxy that terminates TLS.

Services:

- `napivo-web` - gunicorn web process;
- `worker` - background opening-hours refresh;
- `db` - PostgreSQL 17.

`docker-entrypoint.sh` applies migrations and collects static files on every start, so a deploy is pull + rebuild.

### Prerequisites

- VPS (CX22 or better), Ubuntu 24.04, with Docker Engine + the Compose plugin
- A Caddy reverse proxy on an external `caddy` Docker network routing your hostname to the `napivo-web` service
- DNS for your hostname -> the VPS IP
- Residential proxy setup if Firmy.cz detail enrichment needs it in production

The API host should reject oversized request bodies before they reach Django.
Keep the Caddy site block aligned with `MENU_SCAN_MAX_REQUEST_BYTES`:

```caddy
request_body {
    max_size 24MB
}
```

### First-time setup

```bash
# As root on the VPS. Use a read-only deploy key dedicated to THIS repo.
ssh-keygen -t ed25519 -f ~/.ssh/id_napivo -N ""
cat >> ~/.ssh/config <<'CFG'
Host github-napivo
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_napivo
  IdentitiesOnly yes
CFG

# Add ~/.ssh/id_napivo.pub as a read-only Deploy key on the GitHub repo, then:
git clone git@github-napivo:tomasmach/na-pivo-backend.git /opt/na-pivo
cd /opt/na-pivo

# Configure environment. Never commit .env.
cp .env.production.example .env
# Edit .env: SECRET_KEY, DEBUG=False, ENABLE_DJANGO_ADMIN=False,
#            ALLOWED_HOSTS=api.yourdomain.com,
#            DATABASE_URL=postgres://napivo:strong-pass@db:5432/napivo,
#            FIRMY_PROXY_URL=http://user:pass@proxy:port when needed

docker compose up -d --build
```

### Routine deploys

```bash
cd /opt/na-pivo
git pull
docker compose up -d --build
docker compose ps
docker compose logs --tail=30 napivo-web
```

Migrations run inside the container on start. `set -e` means a failed migration stops `napivo-web` before gunicorn; check `docker compose logs napivo-web` if it will not go healthy.

Tests run on SQLite, which does not create PostgreSQL `varchar_pattern_ops` `_like` indexes, so verify migrations that depend on PostgreSQL behavior before deploying.

---

## Agent instructions

Agent-facing product and engineering guidance lives in `AGENTS.md`. Claude-compatible instructions live in `CLAUDE.md` and point to the same source.
