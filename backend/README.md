# na-pivo backend

Self-hosted Django + Django REST Framework service that enriches pubs with opening hours scraped from **Firmy.cz** (Seznam business directory).  The Expo mobile app sends a list of pubs (name + lat/lng + optional city) and receives back opening hours and an `isOpenNow` flag computed for the Europe/Prague timezone.

---

## Legal notice — Firmy.cz robots.txt

> `User-agent: *`  
> `Disallow: /`

Firmy.cz's robots.txt bans all automated crawlers.  This service is designed as **low-volume, lazy-fill** only:

- Each pub's hours are fetched **on user demand**, never bulk pre-crawled.
- All results are **aggressively cached** (default TTL 30 days) so the same location is fetched rarely.
- All requests are **rate-limited** (default 3 s minimum interval) and capped (default 2 000 requests/day).
- A **residential proxy** (`FIRMY_PROXY_URL` setting) should be configured in production.

**For production scale you should pursue a Seznam B2B data licence or the [Mapy.com Places API](https://developer.mapy.cz/).**  This scraper is provided for low-traffic self-hosted use only.

### Consent cookie-wall — why `FIRMY_PROXY_URL` is effectively required

Beyond robots.txt, Firmy.cz **detail pages** sit behind a Seznam GDPR consent cookie-wall (`cmp.seznam.cz` / `cmp.firmy.cz`).  Requests originating from flagged **datacenter IPs** are bounced to that consent wall (`reason=missing`) and the detail content is never served — even with a cookie-aware session and the autologin warmup.  The **search** step (matching a pub to its `firmId`) still works from any IP; only the hours-bearing detail page is gated.

The scraper therefore:

- Seeds cookie-wall cookies via a homepage + autologin warmup on session creation.
- Detects when a detail fetch was bounced to the consent wall and logs an actionable warning (instead of silently failing).
- Relies on `FIRMY_PROXY_URL` pointing at a **residential** proxy in production so that the consent handshake succeeds and detail pages are delivered.

Running without a residential proxy from a datacenter IP, the detail fetch will return `None` (status `unknown`) — the pipeline is otherwise fully functional (verified live against the search step and the real saved U Fleků detail HTML).

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Python 3.14, Django 6, Django REST Framework |
| DB (dev) | SQLite |
| DB (prod) | PostgreSQL via `psycopg[binary]` + `dj-database-url` |
| Scraping | `requests` + cookie-aware session |
| Opening-hours eval | `opening-hours-py` (Rust-backed OSM grammar) |
| Name/geo matching | `rapidfuzz` + haversine |
| Package management | `uv` |
| WSGI (prod) | `gunicorn` |

---

## Quick start (development)

```bash
# 1. Clone and enter
git clone ... && cd na-pivo/backend

# 2. Create a .env file
cp .env.example .env
# Edit .env — at minimum set a real SECRET_KEY

# 3. Install dependencies
uv sync

# 4. Run migrations
uv run python manage.py migrate

# 5. (Optional) create a superuser
uv run python manage.py createsuperuser

# 6. Start the dev server
uv run python manage.py runserver
```

API endpoint: `http://localhost:8000/v1/pub-hours`  
Admin: `http://localhost:8000/admin/`  
Health: `http://localhost:8000/v1/health`

For local Expo testing on a physical device, bind the backend to the LAN
interface:

```bash
uv run python manage.py runserver 0.0.0.0:8000
```

Then start the Expo app from `../na-pivo` with `npm run ios:local`. In
`DEBUG=True`, Django accepts LAN `Host` headers automatically; production still
uses the explicit `ALLOWED_HOSTS` setting.

---

## Running tests

```bash
uv run pytest
```

Tests use an in-memory SQLite database and **never hit the network** (all external calls are mocked or use saved HTML fixtures).

---

## Configuration reference

All settings are read from environment variables (or a `.env` file).  See `.env.example` for the full list.

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
| `MAPY_API_KEY` | _(unset)_ | Mapy.cz key for the server-side `/v1/pubs/near` suggest proxy. Unset → endpoint returns 503 and the app calls Mapy.cz directly |
| `MAPY_DAILY_CAP` | `5000` | Hard daily cap on Mapy.cz suggest HTTP requests (counts individual requests) |
| `PUBS_NEAR_TTL_DAYS` | `7` | Days before a cached `/v1/pubs/near` result is refreshed |
| `CORS_ALLOWED_ORIGINS` | Expo localhost | Comma-separated CORS origins |
| `ACCOUNT_REGISTER_THROTTLE_RATE` | `120/min` | Per-IP rate limit for `POST /v1/account` (DRF throttle rate string) |
| `PUBS_NEAR_THROTTLE_RATE` | `60/min` | Per-IP rate limit for `GET /v1/pubs/near` (DRF throttle rate string) |
| `CLIENT_EVENTS_THROTTLE_RATE` | `120/min` | Per-IP rate limit for `POST /v1/client-events` |
| `LOG_LEVEL` | `INFO` | Structured JSON log level |

---

## Anonymous device accounts

Every install gets an anonymous, device-bound account automatically — there is **no registration or login yet**. The mobile app generates and persists a `device_id` (UUID v4) and calls:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/account` | none (throttled, scope `account`) | Idempotently ensure an account for a `device_id`; returns `{id, device_id, token, created, created_at}`. |
| `GET` | `/v1/account/me` | `Authorization: Bearer <token>` | Return the calling account (`id, device_id, created_at, last_seen_at`); never echoes the token. |

- The bearer token is a server-issued secret (`secrets.token_urlsafe`), returned **once** at registration and stored only as a **SHA-256 hash** (`token_hash`) — a DB leak exposes no usable tokens. Re-registration **rotates** it (the old raw value is unrecoverable from its hash). It is never derived from client input and is excluded from `/v1/account/me`.
- **Future per-user data must FK to `Account` (its PK), not to `public_id`, and never join on `token`** — see the `Account` model docstring for the `on_delete` guidance.
- **Security TODO before attaching real credentials / personal data:** today a re-POST of a known `device_id` returns that account's token (idempotent recovery), so `device_id` is effectively a bearer-equivalent key. That is acceptable only while accounts hold nothing sensitive. Before then, registration must stop letting `device_id` unilaterally recover the token, and the `account` throttle should be backed by a **shared cache** (Redis/Memcached) — the default `LocMemCache` is per-process, so under multiple gunicorn workers the effective limit is `rate × workers`.

---

## Observability and stats

Server logs are JSON on stdout and include a privacy-safe request id, path,
status, duration, app version headers and a hashed client IP. They never log
request bodies, bearer tokens, cookies, feedback contact data or raw GPS points.

The Expo app sends a small event whitelist to:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/client-events` | optional `Authorization: Bearer <token>` | App opens, foregrounds, sanitized warnings/errors/API failures and walking-distance meter increments. |

Authenticated events update `AccountUsageStats`, which answers questions like
"how many anonymous accounts opened the app?", "how many opens were there?" and
"which anonymous account walked the most kilometers?". Walking distance is
computed on-device; the backend stores only meter increments, not coordinates or
routes.

Agent-friendly report:

```bash
uv run python manage.py observability_report --days 7 --format markdown
uv run python manage.py observability_report --days 7 --format json
```

The report includes usage totals, top walkers, client error/API-failure
breakdowns and recent feedback with contact-like text redacted.

---

## Deploy (Docker Compose)

Production runs as **Docker Compose** at `/opt/na-pivo` on a Hetzner VPS (`api.na-pivo.cz`), behind a shared **Caddy** reverse proxy that terminates TLS. Three services (see `docker-compose.yml`): `napivo-web` (gunicorn), `worker` (background opening-hours refresh — replaces the old cron), and `db` (PostgreSQL 17). `docker-entrypoint.sh` applies migrations and collects static files on every start, so a deploy is just *pull + rebuild*.

### Prerequisites

- VPS (CX22 or better), Ubuntu 24.04, with Docker Engine + the Compose plugin
- A Caddy reverse proxy on an external `caddy` Docker network routing your hostname to the `napivo-web` service
- DNS for your hostname → the VPS IP
- A residential proxy subscription (e.g. Bright Data, Oxylabs) — see legal note above

### First-time setup

```bash
# As root on the VPS. Use a read-only deploy key dedicated to THIS repo (GitHub
# allows a given deploy key on only one repository, so each repo needs its own).
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

# Configure environment (NEVER committed — .env is gitignored). See .env.production.example.
cp .env.production.example .env
# Edit .env: SECRET_KEY, DEBUG=False, ENABLE_DJANGO_ADMIN=False,
#            ALLOWED_HOSTS=api.yourdomain.com,
#            DATABASE_URL=postgres://napivo:strong-pass@db:5432/napivo,
#            FIRMY_PROXY_URL=http://user:pass@proxy:port

# Build & start. The entrypoint runs migrate + collectstatic, then gunicorn on :8000.
docker compose up -d --build
```

### Routine deploys

```bash
cd /opt/na-pivo
git pull
docker compose up -d --build      # entrypoint re-applies migrations automatically
docker compose ps                 # confirm napivo-web is healthy
docker compose logs --tail=30 napivo-web
```

> **Migrations run inside the container on start** (`docker-entrypoint.sh`), and `set -e` means a failed migration stops `napivo-web` before gunicorn — check `docker compose logs napivo-web` if it won't go healthy. Tests run on SQLite, which does **not** create PostgreSQL `varchar_pattern_ops` `_like` indexes, so verify any migration against Postgres before deploying.
