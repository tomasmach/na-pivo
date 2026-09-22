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

## Translations

The API serves Czech and English. Czech is the source language and stays the
msgid; English lives in `locale/en/LC_MESSAGES/django.po`, which is checked in.
The compiled `.mo` files are not: the Docker image builds them, and the test
suite rebuilds them on demand.

```bash
# after changing or adding a translatable string
uv run python manage.py makemessages -l en --no-location
# after editing the .po (needs the gettext tools, brew install gettext)
uv run python manage.py compilemessages
```

Per request the language comes from `Accept-Language`. Outside a request (push
notifications, e-mails, cron) it comes from the locale stored on the account or
on its push devices; `pubs/i18n.py` holds those helpers. The amenity catalogue
and release notes are DB-backed content, so their English copy lives in data
migrations rather than in the `.po`.

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

### Recover tasks stranded by the Firmy.cz daily limit

`refresh_hours` stops on the shared daily cap without using a task retry, even
if the cap is reached between search and detail. Other failures still consume
retries and respect `FIRMY_ERROR_RETRY_COOLDOWN_MINUTES`. The existing request cap
and minimum interval are unchanged.

After deploying this fix, preview and recover tasks stranded by the old worker:

```bash
python manage.py recover_hours_budget_tasks
python manage.py recover_hours_budget_tasks --apply
```

The default is read-only. Each run is bounded to 1000 rows (`--limit`, maximum
10000). Only unfinished tasks with `attempts == max_attempts > 0` and the exact
historical daily-cap error qualify. Apply restores one retry, retaining prior
failures, timestamps, and all pub data. It makes no external requests and reruns
are idempotent. The normal worker then handles them under the existing budget;
rows that already have fresh hours close without fetching. Run against the
intended database after stopping the old worker, never against an older release.

`refresh_hours --dry-run` is different: it fetches live data and reserves request
budget, while leaving hours and tasks unchanged.

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
| `PUBLIC_WEB_ORIGIN` | `https://na-pivo.cz` | Canonical origin for invite links and Open Graph metadata |
| `PUBLIC_API_ORIGIN` | `http://localhost:8012` (dev), `https://api.na-pivo.cz` (prod) | Bare API origin (`scheme://host`, no path/query) used when the backend links to itself |
| `ANDROID_APP_LINK_CERT_FINGERPRINTS` | _(unset)_ | Comma-separated SHA-256 fingerprints served via `/.well-known/assetlinks.json`; production value is the Play App Signing cert from Google Play Console > App integrity > App signing key certificate (EAS/local `keytool` show the upload cert and may differ). Extra entries cover preview/internal/direct-distribution builds. Unset/malformed serves no association (fail closed) and the production deploy check refuses to pass |
| `DATABASE_URL` | SQLite | dj-database-url connection string |
| `DB_POOL_MAX_SIZE` | `20` | Postgres connections one process may hold. Every process has its own pool (2 gunicorn workers, the worker container, any manual `manage.py`), so the sum has to stay under the db container's `max_connections` (100); the defaults leave the two web workers up to 40. Ignored on SQLite |
| `DB_POOL_MIN_SIZE` | `2` | Connections kept warm per process; clamped into `0..DB_POOL_MAX_SIZE` |
| `DB_POOL_TIMEOUT` | `10` | Seconds a request waits for a free pooled connection; past this it fails with HTTP 500 (`psycopg_pool.PoolTimeout`), which the app's offline queues retry rather than drop |
| `DB_POOL_MAX_IDLE` | `60` | Seconds unused before the pool retires a connection. It retires at most one per window, so psycopg's 600 s default would keep a peak's connections open for hours |
| `FIRMY_PROXY_URL` | _(unset)_ | Residential proxy for Firmy.cz requests |
| `FIRMY_USER_AGENT` | mobile Chrome UA | User-Agent header for Firmy.cz |
| `FIRMY_MIN_INTERVAL_SEC` | `3` | Min seconds between Firmy.cz requests |
| `FIRMY_DAILY_CAP` | `2000` | Shared DB-backed daily request cap across web and worker processes |
| `HOURS_TTL_DAYS` | `30` | Days before cached hours are refreshed |
| `SYNC_ENRICH_BUDGET` | `3` in dev, forced `0` in production | Max pubs enriched synchronously per API call; production cache misses always return pending and leave enrichment to the worker |
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
| `LEADERBOARD_BEER_RED_DAY` | `25` | Raw beers that exclude that drinking day from beer leaderboard scores; other days still count |
| `LEADERBOARD_BEER_RED_BURSTS` | `12` | Burst-flagged beers that exclude that drinking day from beer leaderboard scores; other days still count |
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

Unresolved addresses submitted when creating or editing a pub are cached for one
hour in `PubGeocodingMiss`, shared across backend processes. Only an HMAC of the
normalized address/city and its expiry are stored; `prune_operational_data`
removes expired rows. Corrections are looked up immediately. Provider errors and
exhausted budgets are not cached. Logs distinguish fresh and cached misses with
`event=pub_address_lookup`, `result=no_match` and `cached=true/false`.
Responses remain HTTP 503 so released clients retain the pending write; this
reduces paid lookups, not the number of retry responses. Concurrent first misses
can each call Google before a cached result exists.

The worker refreshes Google-derived community pub coordinates after 25 days.
Place-ID lookups use the single-result Geocoding v4 contract (root field mask,
no `results` wrapper). An unsuccessful refresh waits 24 hours before retrying;
the delay is stored on the pub and survives worker restarts. Other eligible pubs
can still refresh. Exhausting the shared Google daily cap stops the batch without
delaying an unattempted pub. Successful refreshes clear the retry delay and retain
the user-submitted name and address.

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

`docker-entrypoint.sh` runs `manage.py check --deploy` before applying migrations
or collecting static files. Invalid production configuration therefore stops the
new container before it changes the database. A deploy is pull + rebuild.

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

Tag the verified commit as `api-YYYY.MM.DD.N` (from `dev`, or from the last
deployed tag for a hotfix), push the tag, then on the VPS. Review migrations for
compatibility with the previous release first: old and new web processes overlap
briefly. A schema change that cannot support both releases needs its own plan.

```bash
cd /opt/na-pivo
git fetch origin --tags --filter=blob:none
git checkout --detach api-YYYY.MM.DD.N
cd backend
python3 deploy.py
docker compose -p na-pivo ps
docker compose -p na-pivo logs --tail=30 napivo-web
```

`deploy.py` archives the database, current logs, Caddyfile and previous image IDs
under `/opt/na-pivo/backups/rollout-*` with owner-only permissions. It builds a
tagged image, stops the worker, and starts a temporary `napivo-web-next` instance.
Only after HTTP, migration, database and proxy-network checks pass does it reload
the two Na Pivo upstreams in the shared Caddy. Other sites remain unchanged.
After a 30-second drain it replaces the canonical web, checks it, switches back,
and starts and checks the worker. A final drain precedes temporary-instance cleanup.
Long-lived SSE connections can reconnect during proxy reload or web shutdown;
this procedure does not promise uninterrupted individual streams.

Run only one deploy at a time. The script holds `/var/lock/napivo-deploy.lock` and
refuses an existing temporary instance. It requires the current production
topology: `culinair-caddy-1`, `/opt/culinair/Caddyfile`, and exactly two
`reverse_proxy napivo-web:8000` lines. It writes that bind-mounted file in place,
refusing concurrent edits, and reloads the validated staged copy without restarting
Caddy. Do not use `compose up --build` for routine production replacement: it
removes the serving web before the replacement is ready.

On failure, read the final message and `state.json` in the printed backup directory.
Before canonical replacement, traffic remains on or returns to the previous web.
If canonical readiness fails after the first switch, **keep `napivo-web-next`
running**: it serves traffic until the canonical instance is repaired and checked.
If both proxy reload and rollback fail, both instances are retained for inspection.
The script restores the previous worker image when needed; it never rolls back the
database automatically. To restore a previous web image, use its immutable ID from
`state.json` as `NAPIVO_BACKEND_IMAGE`, include both compose files below, and verify
readiness before switching traffic. Never remove the only serving upstream.

Production logging uses `docker-compose.production.yml` with persistent host
journald storage (`/var/log/journal`). Logs survive container replacement:

```bash
journalctl CONTAINER_NAME=napivo-web --since '24 hours ago'
journalctl CONTAINER_NAME=napivo-worker --since '24 hours ago'
# For manual recovery commands, use the same image and logging override:
NAPIVO_BACKEND_IMAGE=na-pivo-backend:api-YYYY.MM.DD.N docker compose -p na-pivo \
  -f docker-compose.yml -f docker-compose.production.yml ps
```

Retention follows the host journal's disk and age limits; this does not change
other applications' retention. The first rollout also archives the previous
json-file logs before deleting old containers. Keep backup files private and
include them in the operator's normal backup-retention routine.

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
