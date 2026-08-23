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

The Expo mobile app is in the monorepo root (`..`).

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Python 3.14, Django 6, Django REST Framework |
| DB (dev) | SQLite |
| DB (prod) | PostgreSQL via `psycopg[binary]` + `dj-database-url` |
| Package management | `uv` |
| ASGI (prod) | `gunicorn` + `uvicorn` worker |
| Scraping/enrichment | `requests`, Firmy.cz parsing, Mapy.cz integration |
| Opening-hours eval | `opening-hours-py` (Rust-backed OSM grammar) |
| Name/geo matching | `rapidfuzz` + haversine |

---

## Quick start

```bash
# 1. Clone your fork, then open the backend directory
git clone git@github.com:YOUR-USERNAME/na-pivo.git && cd na-pivo/backend

# 2. Create a .env file
cp .env.example .env
# Edit .env - at minimum set a real SECRET_KEY for non-throwaway use.

# 3. Install dependencies
uv sync

# 4. Run migrations
uv run python manage.py migrate

# 5. Optional: create a superuser
uv run python manage.py createsuperuser

# 6. Start the ASGI dev server
uv run --extra prod uvicorn config.asgi:application --reload --no-access-log --port 8000
```

Useful local URLs:

| URL | Purpose |
|---|---|
| `http://localhost:8000/v1/health` | Health check |
| `http://localhost:8000/admin/` | Django admin when enabled |
| `http://localhost:8000/v1/pub-hours` | Opening-hours endpoint |

For local Expo testing on a physical device, bind the backend to the LAN interface:

```bash
uv run --extra prod uvicorn config.asgi:application --reload --no-access-log --host 0.0.0.0 --port 8000
```

Then start Expo from the repository root:

```bash
cd ..
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

### Linear feedback sync

Feedback reports are mirrored to a Linear team. The sync is disabled only when **both** `LINEAR_API_KEY` and `LINEAR_TEAM_ID` are unset; anything partial fails the deploy check with `pubs.E005`.

When enabled, account hard purge permanently deletes the synced feedback issues via Linear's official GraphQL `issueDelete` mutation. That requires an admin-capable API key. `python manage.py check --deploy` also requires `LINEAR_FEEDBACK_DELETE_ADMIN_CONFIRMED=true` — this is only an operator assertion that the key was verified in Linear, not a live permission probe (`pubs.E006` if missing).

If Linear is down or an issue delete fails, purge is fail-closed: the whole transaction rolls back and the account stays pending for retry. Never assume external deletion succeeded just because local data is gone.

**Unsetting both env vars stops new sync, but it is not a safe off-switch while any synced issue remains.** Hard purge of an account with a remaining `FeedbackReport.linear_issue_id` fails closed without a working admin key, so those accounts pile up pending forever. Until the backlog clears (and a durable cleanup-progress design exists), keep the verified admin key configured.

Check the backlog at any time — read-only, loads no secrets into memory beyond Django settings defaults:

```bash
uv run python manage.py shell -c "from pubs.models import FeedbackReport; print(FeedbackReport.objects.exclude(linear_issue_id='').count())"
```

If this prints anything above `0`, Linear cleanup is still owed to real accounts; do not treat sync as safely retired.

#### Before setting `LINEAR_FEEDBACK_DELETE_ADMIN_CONFIRMED=true`

Run this manual smoke once with the **production admin key**, against a sacrificial throwaway issue in the synced team:

1. Call the permanent `issueDelete` mutation (`permanentlyDelete: true`) on the sacrificial issue → the response must contain `data.issueDelete.success: true`.
2. Call the exact same delete again → the response must contain `errors[].extensions.code` equal to exactly `ENTITY_NOT_FOUND` (the only already-gone code the purge accepts).
3. If either step returns anything else (different success shape, different error code), do **not** set the flag and do **not** deploy; fix the key's scope first and repeat.

Never paste or log the API key or raw GraphQL response bodies anywhere.

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

### OpenAI UGC moderation

Server-only configuration for the Phase A moderation helper — the key must never be exposed through Expo/mobile/client config. When an endpoint integrates and calls the helper, the UGC text supplied to it and the normalized image bytes (re-encoded WebP thumbnail) are sent to OpenAI for moderation at the fixed OpenAI `POST /v1/moderations` endpoint; if OpenAI is unreachable, the call raises instead of approving content. Phase A is not integrated yet — no UGC endpoints use this helper, so nothing is moderated automatically today.

- `OPENAI_MODERATION_API_KEY` — _(unset)_; server-only OpenAI key, required in production
- `OPENAI_MODERATION_MODEL` — default `omni-moderation-latest`, required exact value
- `OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS` — default `2`, maximum `10`; connect timeout in seconds
- `OPENAI_MODERATION_READ_TIMEOUT_SECONDS` — default `5`, maximum `30`; read timeout in seconds

`manage.py check --deploy` fails with `pubs.E007` (missing production key), `pubs.E008` (wrong model) or `pubs.E009` (invalid timeout).

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | insecure dev key | Django secret key |
| `DEBUG` | `True` | Enable debug mode |
| `ENABLE_DJANGO_ADMIN` | `True` in dev, `False` in prod | Register `/admin/` routes |
| `ALLOWED_HOSTS` | `*` in dev, env value in prod | Comma-separated allowed hosts |
| `PUBLIC_WEB_ORIGIN` | `https://na-pivo.cz` | Canonical origin for invite links and Open Graph metadata |
| `PUBLIC_API_ORIGIN` | `http://localhost:8012` (dev), `https://api.na-pivo.cz` (prod) | Bare API origin (`scheme://host`, no path/query) used when the backend links to itself |
| `ANDROID_APP_LINK_CERT_FINGERPRINTS` | _(unset)_ | Comma-separated SHA-256 fingerprints served via `/.well-known/assetlinks.json`; production value is the Play App Signing cert from Google Play Console > App integrity > App signing key certificate (EAS/local `keytool` show the upload cert and may differ). Extra entries cover preview/internal/direct-distribution builds. Unset/malformed serves no association (fail closed) and the production deploy check refuses to pass |
| `DATABASE_URL` | SQLite | dj-database-url connection string |
| `FIRMY_PROXY_URL` | _(unset)_ | Residential proxy for Firmy.cz requests |
| `FIRMY_USER_AGENT` | mobile Chrome UA | User-Agent header for Firmy.cz |
| `FIRMY_MIN_INTERVAL_SEC` | `3` | Min seconds between Firmy.cz requests |
| `FIRMY_DAILY_CAP` | `2000` | Shared DB-backed daily request cap across web and worker processes |
| `HOURS_TTL_DAYS` | `30` | Days before cached hours are refreshed |
| `SYNC_ENRICH_BUDGET` | `3` | Max pubs enriched synchronously per API call; `0` makes cold lookups pending-only and leaves enrichment to the worker |
| `GOOGLE_MAPS_SERVER_API_KEY` | _(unset)_ | Backend-only, IP/API-restricted key for Geocoding API v4 and Places API (New); never ship it in Expo |
| `GOOGLE_MAPS_TIMEOUT` | `8` | Timeout in seconds for an explicit Google lookup |
| `GOOGLE_MAPS_DAILY_CAP` | `250` | Shared DB-backed request cap across Google geocoding/autocomplete entry points and workers |
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
| `PUB_REPORT_GLOBAL_HIDE_THRESHOLD` | `3` | Distinct active reporting accounts required before a pub is hidden globally |
| `CLIENT_EVENTS_THROTTLE_RATE` | `120/min` | Per-IP rate limit for `POST /v1/client-events` |
| `PUBLIC_READS_THROTTLE_RATE` | `120/min` | Per-IP rate limit for public changelog and report-filter reads |
| `API_RATE_LIMIT_RETENTION_DAYS` | `2` | Retention for expired shared throttle buckets |
| `ACCOUNT_EXPORT_JOB_RETENTION_DAYS` | `30` | Retention for delivered and terminally failed durable export jobs |
| `ACCOUNT_EXPORT_JOB_MAX_ATTEMPTS` | `8` | Maximum delivery attempts before an export job fails permanently |
| `DRINKS_THROTTLE_RATE` | `30/min` | Per-account rate limit for `POST /v1/drinks` |
| `DRINK_FUTURE_GRACE_MINUTES` | `10` | Future timestamp grace before clamping to server time |
| `DRINK_BACKDATE_FLAG_DAYS` | `60` | Age at which a drink is flagged as backdated |
| `DRINK_BURST_LIMIT` | `8` | Countable beers allowed in a 10-minute window before later beers are flagged |
| `DRINK_BURST_WINDOW_MINUTES` | `10` | Burst detection window |
| `DRINK_DAILY_FLAG_CAP` | `21` | Beer ordinal in the 04:00 drinking day at which rows become suspect |
| `DRINK_DAILY_HARD_CAP` | `40` | Existing rows of any drink type in the drinking day after which new rows are rejected |
| `LEADERBOARD_BEER_RED_DAY` | `25` | Raw beers in one drinking day that temporarily hide an account from beer leaderboards |
| `LEADERBOARD_BEER_RED_BURSTS` | `12` | Burst-flagged beers in one drinking day that temporarily hide an account from beer leaderboards |
| `LOG_LEVEL` | `INFO` | Structured JSON log level |

---

## Anonymous device accounts

Every install currently gets an anonymous, device-bound account automatically. The mobile app generates and persists a `device_id` (UUID v4) and calls:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/account` | none for new `device_id`; Bearer required to rotate an existing account token | Ensure an account for a `device_id`; returns `{id, device_id, token, created, created_at}` on creation or authenticated rotation. |
| `GET` | `/v1/account/me` | `Authorization: Bearer <token>` | Return the calling account (`id, device_id, created_at, last_seen_at`); never echoes the token. |

The bearer token is returned once at registration and stored only as a SHA-256 hash (`token_hash`). Re-registration for an existing `device_id` rotates it only when the request already presents the valid Bearer token for that same account.

The `account` and other scoped throttles use atomic PostgreSQL counters. Their limits stay exact when gunicorn adds workers; the maintenance worker removes expired buckets.

---

## Observability and stats

Structured Django logs include a privacy-safe request id, redacted path, status, duration, app version headers and a hashed client IP. Gunicorn logs only method, status and latency, so sensitive URL segments and query parameters never reach the raw access log.

The Expo app sends a small event whitelist to:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/client-events` | optional `Authorization: Bearer <token>` | App lifecycle, coarse allowlisted screen views, counter usage, drink sync results, sanitized warnings/errors/API failures and walking-distance meter increments. |

Authenticated events update `AccountUsageStats`. Product events are coarse and server-validated: dynamic pathnames, account/content ids, pub names, beer names, user text and GPS coordinates are not accepted. Walking distance is computed on-device; the backend stores only meter increments, not coordinates or routes. Event-level rows are retained for 90 days by default and pruned in bounded batches; aggregate account counters remain for the account lifetime.

Agent-friendly reports:

```bash
uv run python manage.py observability_report --days 7 --format markdown
uv run python manage.py observability_report --days 7 --format json
uv run python manage.py prune_client_events --dry-run
```

The report includes usage totals, screen popularity, top walkers, client error/API-failure breakdowns and recent feedback with contact-like text redacted.

---

## Deploy (Docker Compose)

Production runs as **Docker Compose** from `/opt/na-pivo/backend` on a Hetzner VPS (`api.na-pivo.cz`), behind a shared **Caddy** reverse proxy that terminates TLS. The same service handles the small public invite surface on `na-pivo.cz` (`/p/*`, Open Graph assets and iOS association). `/opt/na-pivo` is a sparse checkout of the monorepo (only `backend/` is materialised) pinned to a detached `api-*` tag — the backend never deploys from a branch.

Services:

- `napivo-web` - gunicorn web process;
- `worker` - background enrichment, durable account-export delivery and retention cleanup;
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

The public website host must reach the same service so share previews and the
custom-scheme fallback work. Keep the API upload limit on the API host only:

```caddy
na-pivo.cz {
    reverse_proxy napivo-web:8000
}
```

### First-time setup

```bash
# As root on the VPS. Use a dedicated read-only key with access to the monorepo.
ssh-keygen -t ed25519 -f ~/.ssh/id_napivo -N ""
cat >> ~/.ssh/config <<'CFG'
Host github-napivo
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_napivo
  IdentitiesOnly yes
CFG

# Give the key read access to the monorepo (account key or deploy key), then
# clone it sparsely — only backend/ lands on disk, pinned to an api-* tag:
git clone --filter=blob:none --no-checkout git@github-napivo:tomasmach/na-pivo.git /opt/na-pivo
cd /opt/na-pivo
git sparse-checkout set --no-cone "/backend/"
git checkout --detach api-YYYY.MM.DD.N
cd backend

# Configure environment. Never commit .env.
cp .env.production.example .env
# Edit .env: SECRET_KEY, DEBUG=False, ENABLE_DJANGO_ADMIN=False,
#            ALLOWED_HOSTS=api.na-pivo.cz,na-pivo.cz,
#            PUBLIC_WEB_ORIGIN=https://na-pivo.cz,
#            DATABASE_URL=postgres://napivo:strong-pass@db:5432/napivo,
#            FIRMY_PROXY_URL=http://user:pass@proxy:port when needed

docker compose -p na-pivo up -d --build
```

### Routine deploys

Tag the commit to deploy as `api-YYYY.MM.DD.N` (from `dev`, or from the last
deployed tag for a hotfix), push the tag, then on the VPS:

```bash
cd /opt/na-pivo
git fetch origin --tags --filter=blob:none
git checkout --detach api-YYYY.MM.DD.N
cd backend
docker compose -p na-pivo up -d --build
docker compose -p na-pivo ps
docker compose -p na-pivo logs --tail=30 napivo-web
```

Always pass `-p na-pivo`: the compose project name is pinned in
`docker-compose.yml`, but the explicit flag keeps a stray invocation from a
different directory from ever creating a parallel project with empty volumes.

Never deploy from `/opt/na-pivo.pre-monorepo-2026-07-17` — it is an archived
checkout of the old backend-only repo, and deploying it would roll production
back.

Migrations run inside the container on start. `set -e` means a failed migration stops `napivo-web` before gunicorn; check `docker compose logs napivo-web` if it will not go healthy.

Tests run on SQLite, which does not create PostgreSQL `varchar_pattern_ops` `_like` indexes, so verify migrations that depend on PostgreSQL behavior before deploying.

---

## Release checklist

Before any release that touches account deletion or Apple sign-in:

### Manual Apple revoke-twice smoke

Run once per release with a **disposable test Apple account** (never a real user's identity) and its `refresh_token`, against the production Apple revoke endpoint — the same call `oauth.revoke_apple_token` makes:

1. POST to `https://appleid.apple.com/auth/revoke` with the app's `client_id`, a fresh client-secret JWT, the disposable `refresh_token` and `token_type_hint=refresh_token` → response must be **HTTP 200**.
2. Call the exact same revoke a second time → it must also return **HTTP 200**. The helper accepts only 200 as success; there is no "already revoked" error state it tolerates.
3. If the second call is non-200, do **not** release: deletion of an account that has already had its token revoked would fail at purge time with no durable cleanup-progress design to fall back on. Fix the flow first.

Never paste or log the refresh token, the client secret or raw response bodies anywhere.

---

## Agent instructions

Agent-facing product and engineering guidance lives in `AGENTS.md`. Claude-compatible instructions live in `CLAUDE.md` and point to the same source.
