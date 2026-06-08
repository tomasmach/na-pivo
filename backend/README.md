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
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | Comma-separated allowed hosts |
| `DATABASE_URL` | SQLite | dj-database-url connection string |
| `FIRMY_PROXY_URL` | _(unset)_ | Residential proxy for Firmy.cz requests |
| `FIRMY_USER_AGENT` | mobile Chrome UA | User-Agent header for Firmy.cz |
| `FIRMY_MIN_INTERVAL_SEC` | `3` | Min seconds between Firmy.cz requests |
| `FIRMY_DAILY_CAP` | `2000` | Hard daily request cap |
| `HOURS_TTL_DAYS` | `30` | Days before cached hours are refreshed |
| `SYNC_ENRICH_BUDGET` | `3` | Max pubs enriched synchronously per API call |
| `CORS_ALLOWED_ORIGINS` | Expo localhost | Comma-separated CORS origins |

---

## Deploy to Hetzner VPS

### Prerequisites

- Hetzner VPS (CX22 or better), Ubuntu 24.04
- Domain / subdomain pointing to the VPS IP
- A residential proxy subscription (e.g. Bright Data, Oxylabs) — see legal note above

### Steps

```bash
# On the VPS
apt update && apt install -y python3.14 python3.14-venv postgresql nginx certbot python3-certbot-nginx

# Create a postgres database
sudo -u postgres psql -c "CREATE USER napivo WITH PASSWORD 'strong-pass';"
sudo -u postgres psql -c "CREATE DATABASE napivo OWNER napivo;"

# Clone repo, create venv
git clone ... /srv/na-pivo/backend
cd /srv/na-pivo/backend
pip install uv
uv sync --extra prod

# Configure environment
cp .env.example .env
# Edit .env: SECRET_KEY, DEBUG=False, ALLOWED_HOSTS=yourdomain.com,
#            DATABASE_URL=postgres://napivo:strong-pass@localhost/napivo,
#            FIRMY_PROXY_URL=http://user:pass@proxy:port

# Migrate & collect static
uv run python manage.py migrate
uv run python manage.py collectstatic --no-input

# Gunicorn systemd service
# Create /etc/systemd/system/na-pivo.service (see below), then:
systemctl enable --now na-pivo

# Nginx reverse-proxy + TLS
certbot --nginx -d yourdomain.com
```

**Systemd unit (`/etc/systemd/system/na-pivo.service`):**

```ini
[Unit]
Description=na-pivo backend
After=network.target postgresql.service

[Service]
User=www-data
WorkingDirectory=/srv/na-pivo/backend
EnvironmentFile=/srv/na-pivo/backend/.env
ExecStart=/srv/na-pivo/backend/.venv/bin/gunicorn config.wsgi:application \
    --workers 2 --bind 127.0.0.1:8000
Restart=always

[Install]
WantedBy=multi-user.target
```

**Cron for background enrichment** (add to `crontab -e` as www-data):

```cron
*/5 * * * * cd /srv/na-pivo/backend && .venv/bin/python manage.py refresh_hours --limit 50
```
