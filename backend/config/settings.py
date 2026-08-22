"""
Django settings for na-pivo backend.

All sensitive / environment-specific values are read from environment variables
(or a .env file loaded by python-dotenv at startup).  See .env.example for the
full list of available variables.
"""

import os
from pathlib import Path
from urllib.parse import urlsplit

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Base paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env from project root (silently ignored if absent — e.g. in CI)
load_dotenv(BASE_DIR / ".env")

# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------
SECRET_KEY = os.environ.get(
    "SECRET_KEY",
    "django-insecure-dev-only-change-me-before-deploying",
)

DEBUG = os.environ.get("DEBUG", "True").lower() in ("1", "true", "yes")


def _validate_production_secret_key(secret_key: str) -> None:
    markers = (
        "django-insecure",
        "change-me",
        "changeme",
        "replace-me",
        "replace_me",
        "placeholder",
        "example-secret",
        "your-secret",
        "dev-only",
    )
    lowered = secret_key.lower()
    if len(secret_key) < 50 or any(m in lowered for m in markers) or len(set(secret_key)) < 8:
        raise ImproperlyConfigured(
            "SECRET_KEY is not secure enough for production. "
            "Set a strong, unique SECRET_KEY environment variable."
        )
    for size in range(1, 17):
        prefix = secret_key[:size]
        repeated = (prefix * (len(secret_key) // size + 1))[: len(secret_key)]
        if secret_key == repeated:
            raise ImproperlyConfigured(
                "SECRET_KEY is not secure enough for production. "
                "Set a strong, unique SECRET_KEY environment variable."
            )

ENABLE_DJANGO_ADMIN = os.environ.get(
    "ENABLE_DJANGO_ADMIN",
    "True" if DEBUG else "False",
).lower() in ("1", "true", "yes")

if DEBUG:
    # Expo on a physical device reaches the dev server via the Mac's LAN IP,
    # which changes by network. Keep DEBUG-only host validation open so local
    # mobile testing does not require editing .env for every Wi-Fi.
    ALLOWED_HOSTS: list[str] = ["*"]
else:
    ALLOWED_HOSTS = [
        h.strip()
        for h in os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
        if h.strip()
    ]

# ---------------------------------------------------------------------------
# Application definition
# ---------------------------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Enables pg_trgm-backed account search (GIN indexes in migration
    # 0054). No models/migrations of its own; inert on the SQLite dev/test DB.
    "django.contrib.postgres",
    # Third-party
    "rest_framework",
    "corsheaders",
    # Local
    "pubs",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",  # must be before CommonMiddleware
    "django.middleware.security.SecurityMiddleware",
    "pubs.observability.RequestLogMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
_default_db = f"sqlite:///{BASE_DIR / 'db.sqlite3'}"
DATABASES = {
    "default": dj_database_url.config(
        env="DATABASE_URL",
        default=_default_db,
        conn_max_age=600,
    )
}
if DATABASES["default"]["ENGINE"] == "django.db.backends.sqlite3":
    # Local Expo starts an evening, visit and first drink concurrently. SQLite
    # DEFERRED transactions can read first and then fail immediately while
    # upgrading to a write lock. Acquire the write reservation at atomic-block
    # entry instead, then wait briefly for the other local request to commit.
    DATABASES["default"]["OPTIONS"] = {
        **DATABASES["default"].get("OPTIONS", {}),
        "timeout": 20,
        "transaction_mode": "IMMEDIATE",
    }

# ---------------------------------------------------------------------------
# Password validation
# ---------------------------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Argon2 first (OWASP / Django recommended) for the EmailCredential password
# hashes. PBKDF2 entries stay so any older hashes keep verifying. We use
# make_password/check_password directly (no auth.User), which honour this list.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
]

# ---------------------------------------------------------------------------
# Internationalization
# ---------------------------------------------------------------------------
LANGUAGE_CODE = "cs"
TIME_ZONE = "Europe/Prague"
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------------------
# Static files
# ---------------------------------------------------------------------------
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Canonical public website used by shareable links and their Open Graph metadata.
# Keep this separate from the API origin: production serves both hostnames through
# the same reverse proxy, while the mobile app talks only to api.na-pivo.cz.
PUBLIC_WEB_ORIGIN: str = os.environ.get("PUBLIC_WEB_ORIGIN", "https://na-pivo.cz").rstrip("/")


def _normalize_origin(env_var: str, default: str) -> str:
    parts = urlsplit(os.environ.get(env_var, default))
    if parts.scheme not in ("http", "https"):
        raise ValueError(f"{env_var} must use http or https scheme")
    if not parts.hostname:
        raise ValueError(f"{env_var} must include a hostname")
    if parts.username or parts.password:
        raise ValueError(f"{env_var} must not include credentials")
    if parts.path not in ("", "/"):
        raise ValueError(f"{env_var} must be a bare origin without a path")
    if parts.query or parts.fragment:
        raise ValueError(f"{env_var} must not include query or fragment")
    return f"{parts.scheme}://{parts.netloc}"


def _resolve_public_api_origin() -> str:
    if "PUBLIC_API_ORIGIN" not in os.environ:
        if not DEBUG:
            raise ImproperlyConfigured(
                "PUBLIC_API_ORIGIN must be set in the environment when DEBUG is false"
            )
        return _normalize_origin("PUBLIC_API_ORIGIN", "http://localhost:8012")
    return _normalize_origin("PUBLIC_API_ORIGIN", "")


PUBLIC_API_ORIGIN: str = _resolve_public_api_origin()

# ---------------------------------------------------------------------------
# Media files (user-uploaded avatars)
# ---------------------------------------------------------------------------
# Avatars are stored on the local disk under MEDIA_ROOT and served from
# MEDIA_URL. In production MEDIA_ROOT points at a Docker named volume
# (napivo_media:/data/media) and Caddy serves /media/* directly with a long
# immutable cache (Django does NOT serve media in prod). In DEBUG/tests Django
# serves it via config.urls (see static(MEDIA_URL, ...)).
MEDIA_URL = "/media/"
MEDIA_ROOT = os.environ.get("MEDIA_ROOT", str(BASE_DIR / "media"))

# Avatar upload / processing limits.
# Reject uploads larger than this BEFORE decoding (decompression-bomb guard).
AVATAR_MAX_UPLOAD_BYTES: int = int(os.environ.get("AVATAR_MAX_UPLOAD_BYTES", str(5 * 1024 * 1024)))
# Final square avatar edge in pixels (stored as webp).
AVATAR_SIZE_PX: int = int(os.environ.get("AVATAR_SIZE_PX", "256"))
# webp encoder quality for the stored avatar.
AVATAR_WEBP_QUALITY: int = int(os.environ.get("AVATAR_WEBP_QUALITY", "82"))

# In-app feedback attachments. Mobile already compresses these, while the
# server cap + re-encode protect older/tampered clients and strip EXIF/GPS.
FEEDBACK_ATTACHMENT_MAX_UPLOAD_BYTES: int = int(
    os.environ.get("FEEDBACK_ATTACHMENT_MAX_UPLOAD_BYTES", str(5 * 1024 * 1024))
)
FEEDBACK_ATTACHMENT_MAX_EDGE_PX: int = int(
    os.environ.get("FEEDBACK_ATTACHMENT_MAX_EDGE_PX", "1440")
)
FEEDBACK_ATTACHMENT_WEBP_QUALITY: int = int(
    os.environ.get("FEEDBACK_ATTACHMENT_WEBP_QUALITY", "78")
)

# ---------------------------------------------------------------------------
# Default primary key type
# ---------------------------------------------------------------------------
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------------------
# Django REST Framework
# ---------------------------------------------------------------------------

# Per-IP rate limit for the unauthenticated account-registration endpoint
# (POST /v1/account). It blunts scripted mass account creation while leaving the
# legitimate once-per-install call untouched. Format: DRF throttle rate string.
ACCOUNT_REGISTER_THROTTLE_RATE: str = os.environ.get(
    "ACCOUNT_REGISTER_THROTTLE_RATE", "120/min"
)
ACCOUNT_EXPORT_THROTTLE_RATE: str = os.environ.get(
    "ACCOUNT_EXPORT_THROTTLE_RATE", "4/day"
)
ACCOUNT_EXPORT_ASYNC: bool = os.environ.get("ACCOUNT_EXPORT_ASYNC", "1") == "1"
ACCOUNT_EXPORT_JOB_RETENTION_DAYS: int = int(
    os.environ.get("ACCOUNT_EXPORT_JOB_RETENTION_DAYS", "30")
)
ACCOUNT_EXPORT_JOB_MAX_ATTEMPTS: int = int(
    os.environ.get("ACCOUNT_EXPORT_JOB_MAX_ATTEMPTS", "8")
)
API_RATE_LIMIT_RETENTION_DAYS: int = int(
    os.environ.get("API_RATE_LIMIT_RETENTION_DAYS", "2")
)

# Per-IP rate limit for the authenticated in-app feedback endpoint
# (POST /v1/feedback). Blunts spammy submissions while leaving normal one-off
# feedback untouched. Format: DRF throttle rate string.
FEEDBACK_THROTTLE_RATE: str = os.environ.get("FEEDBACK_THROTTLE_RATE", "20/min")

# Per-IP rate limit for the authenticated community-contribution endpoint
# (POST /v1/pub-community). Blunts scripted mass contributions while leaving
# normal hand-entered submissions untouched. Format: DRF throttle rate string.
COMMUNITY_THROTTLE_RATE: str = os.environ.get("COMMUNITY_THROTTLE_RATE", "30/min")

# Per-IP rate limit for the authenticated missing-pub endpoint (POST /v1/pubs).
# Adding a pub makes it visible to everyone, so keep it tighter than passive
# reads while still allowing normal manual corrections.
ADDED_PUBS_THROTTLE_RATE: str = os.environ.get("ADDED_PUBS_THROTTLE_RATE", "20/min")

# Per-IP rate limit for add-pub autocomplete/geocoding. These are the only
# public endpoints allowed to spend Mapy.com credits, so keep their budget
# separate from the local-only nearby directory lookup.
PUB_LOCATION_LOOKUP_THROTTLE_RATE: str = os.environ.get(
    "PUB_LOCATION_LOOKUP_THROTTLE_RATE", "30/min"
)

# Per-IP rate limit for the authenticated drink-logging endpoint
# (POST /v1/drinks). The in-app beer counter can log several beers in one
# session (one POST each), so this is more generous than the community rate;
# it still blunts scripted mass logging. Format: DRF throttle rate string.
DRINKS_THROTTLE_RATE: str = os.environ.get("DRINKS_THROTTLE_RATE", "30/min")

# Drink-log plausibility thresholds. Suspicious beer rows remain in personal
# history but are excluded from public aggregates. The higher hard cap counts
# every drink type and exists only to bound abusive API/storage usage.
DRINK_FUTURE_GRACE_MINUTES: int = int(
    os.environ.get("DRINK_FUTURE_GRACE_MINUTES", "10")
)
DRINK_BACKDATE_FLAG_DAYS: int = int(os.environ.get("DRINK_BACKDATE_FLAG_DAYS", "60"))
DRINK_BURST_LIMIT: int = int(os.environ.get("DRINK_BURST_LIMIT", "8"))
DRINK_BURST_WINDOW_MINUTES: int = int(
    os.environ.get("DRINK_BURST_WINDOW_MINUTES", "10")
)
DRINK_DAILY_FLAG_CAP: int = int(os.environ.get("DRINK_DAILY_FLAG_CAP", "21"))
DRINK_DAILY_HARD_CAP: int = int(os.environ.get("DRINK_DAILY_HARD_CAP", "40"))

# A red account is temporarily omitted from the public beer leaderboard for a
# period containing an obviously implausible drinking day. This is derived at
# read time, so correcting/deleting the bad rows automatically restores it; the
# profile, private diary and the other leaderboard categories remain untouched.
LEADERBOARD_BEER_RED_DAY: int = int(
    os.environ.get("LEADERBOARD_BEER_RED_DAY", "25")
)
LEADERBOARD_BEER_RED_BURSTS: int = int(
    os.environ.get("LEADERBOARD_BEER_RED_BURSTS", "12")
)

# Per-IP rate limit for the unauthenticated beer-brand suggestion endpoint
# (GET /v1/beer-brands/suggest). The response is tiny and cacheable, but the
# autocomplete UI can call it while typing.
BEER_BRANDS_THROTTLE_RATE: str = os.environ.get("BEER_BRANDS_THROTTLE_RATE", "120/min")

# Per-IP rate limit for the authenticated pub-rating sync endpoint
# (PUT/GET/DELETE /v1/pub-ratings). A two-way sync may upsert several ratings in
# a burst when a fresh install pushes its local history, so this is generous;
# it still blunts scripted mass writes. Format: DRF throttle rate string.
PUB_RATINGS_THROTTLE_RATE: str = os.environ.get("PUB_RATINGS_THROTTLE_RATE", "120/min")

# Per-IP rate limit for the authenticated pub-visit push endpoint
# (POST/GET/DELETE /v1/pub-visits). Mirrors the rating rate for the same
# burst-on-sync reason. Format: DRF throttle rate string.
PUB_VISITS_THROTTLE_RATE: str = os.environ.get("PUB_VISITS_THROTTLE_RATE", "120/min")

# Per-IP rate limit for the unauthenticated local nearby-directory endpoint
# (GET /v1/pubs/near). This blunts scripted enumeration of the local dataset.
# Format: DRF throttle rate string.
PUBS_NEAR_THROTTLE_RATE: str = os.environ.get("PUBS_NEAR_THROTTLE_RATE", "60/min")

# Per-IP rate limit for the unauthenticated opening-hours batch endpoint
# (POST /v1/pub-hours). It protects request parsing, cache lookup, and sync
# enrichment budget from scripted bursts while keeping normal app refreshes
# unaffected. Format: DRF throttle rate string.
PUB_HOURS_THROTTLE_RATE: str = os.environ.get("PUB_HOURS_THROTTLE_RATE", "120/min")

# Per-IP rate limit for the authenticated pub-report endpoint
# (POST /v1/pub-reports). Reports affect shared search filtering, so cap write
# bursts while leaving normal manual reports untouched.
# Format: DRF throttle rate string.
PUB_REPORTS_THROTTLE_RATE: str = os.environ.get("PUB_REPORTS_THROTTLE_RATE", "30/min")
# Number of distinct active accounts that must report the same geohash-8 pub
# before it is hidden from everybody. The reporting installation already hides
# its own report locally, so a quorum protects the shared directory from a
# single mistaken or abusive report without weakening that immediate feedback.
PUB_REPORT_GLOBAL_HIDE_THRESHOLD: int = int(
    os.environ.get("PUB_REPORT_GLOBAL_HIDE_THRESHOLD", "3")
)
# Per-IP rate limit for privacy-safe client telemetry events. The client sends a
# small lifecycle/error/distance whitelist only; this cap protects the endpoint
# from noisy loops and scripted spam.
CLIENT_EVENTS_THROTTLE_RATE: str = os.environ.get("CLIENT_EVENTS_THROTTLE_RATE", "120/min")
# Raw telemetry is useful for short product funnels and diagnostics only. Keep
# long-term account counters separately and automatically prune event-level rows.
CLIENT_EVENT_RETENTION_DAYS: int = int(os.environ.get("CLIENT_EVENT_RETENTION_DAYS", "90"))
PUBLIC_READS_THROTTLE_RATE: str = os.environ.get(
    "PUBLIC_READS_THROTTLE_RATE", "120/min"
)

# Per-IP rate limit for authenticated push-token registration
# (PUT/DELETE /v1/push-device). DB-only, but can be retried on app start and
# permission changes.
PUSH_DEVICES_THROTTLE_RATE: str = os.environ.get("PUSH_DEVICES_THROTTLE_RATE", "60/min")

# Per-IP rate limit for authenticated friend/social WRITE endpoints. Friend
# activity can fan out notifications, so writes stay bounded while dashboard
# reads (the friends_dashboard scope below) get their own, larger budget.
FRIENDS_THROTTLE_RATE: str = os.environ.get("FRIENDS_THROTTLE_RATE", "120/min")
FOLLOWS_THROTTLE_RATE: str = os.environ.get("FOLLOWS_THROTTLE_RATE", "120/min")
NIGHT_COMMENTS_THROTTLE_RATE: str = os.environ.get(
    "NIGHT_COMMENTS_THROTTLE_RATE", "30/hour"
)

# Personal diary aggregates are read-only but can scan a meaningful amount of
# history. Give them dedicated per-account budgets so a polling bug does not
# contend with social writes or repeatedly rebuild the same charts.
STATS_THROTTLE_RATE: str = os.environ.get("STATS_THROTTLE_RATE", "30/min")
CHALLENGES_THROTTLE_RATE: str = os.environ.get("CHALLENGES_THROTTLE_RATE", "60/min")
# Na Pivo has no data older than this product horizon. Keeping the detailed
# aggregation window explicit bounds Python work and response period arrays
# even if malformed imports insert arbitrarily old timestamps.
STATS_HISTORY_YEARS: int = int(os.environ.get("STATS_HISTORY_YEARS", "20"))
STATS_MAX_DRINK_ROWS: int = int(os.environ.get("STATS_MAX_DRINK_ROWS", "50000"))

# --- Parta 3.0 (dashboard reads, invites, plans, reactions, push, retention) ---
# Separate, larger budget for the two friend READ paths (GET /v1/friends and
# GET /v1/friends/live). The bounded live poll (30–45s while something is live)
# makes these hot, so they must not share the write budget above.
FRIENDS_DASHBOARD_THROTTLE_RATE: str = os.environ.get(
    "FRIENDS_DASHBOARD_THROTTLE_RATE", "240/min"
)
# A visit remains eligible for the lightweight live presence slice this long
# after its latest client-confirmed timestamp.
FRIEND_PRESENCE_WINDOW_MINUTES: int = int(
    os.environ.get("FRIEND_PRESENCE_WINDOW_MINUTES", "180")
)
# How long a minted invite code stays valid (reused until it expires).
FRIEND_INVITE_TTL_DAYS: int = int(os.environ.get("FRIEND_INVITE_TTL_DAYS", "14"))
# After a declined request, block a silent re-open (anti-harassment) for this long.
FRIEND_DECLINE_COOLDOWN_DAYS: int = int(os.environ.get("FRIEND_DECLINE_COOLDOWN_DAYS", "14"))
# A plan's scheduled_for must be within this many hours from now.
FRIEND_PLAN_MAX_AHEAD_HOURS: int = int(os.environ.get("FRIEND_PLAN_MAX_AHEAD_HOURS", "24"))
# Remind the plan creator when scheduled_for is <= this many hours away.
FRIEND_PLAN_REMINDER_LEAD_HOURS: int = int(
    os.environ.get("FRIEND_PLAN_REMINDER_LEAD_HOURS", "4")
)
# Dedup reaction ("na zdraví") owner notifications within this many minutes.
FRIEND_REACTION_NOTIFY_COOLDOWN_MIN: int = int(
    os.environ.get("FRIEND_REACTION_NOTIFY_COOLDOWN_MIN", "360")
)
# Delete FriendNotification rows older than this many days (privacy + bloat).
FRIEND_NOTIFICATION_RETENTION_DAYS: int = int(
    os.environ.get("FRIEND_NOTIFICATION_RETENTION_DAYS", "45")
)
# Hard-delete FriendPubActivity rows expired more than this many days ago
# (removes name/lat/lng/geohash — privacy).
FRIEND_ACTIVITY_RETENTION_DAYS: int = int(
    os.environ.get("FRIEND_ACTIVITY_RETENTION_DAYS", "7")
)
# Batch size for Expo push fan-out (chunk the token list into POSTs of this size).
EXPO_PUSH_CHUNK_SIZE: int = int(os.environ.get("EXPO_PUSH_CHUNK_SIZE", "100"))
# Friend request/accept responses must not wait on Expo's network round-trip.
FRIEND_PUSH_ASYNC: bool = os.environ.get("FRIEND_PUSH_ASYNC", "1") != "0"
FRIEND_PUSH_WORKERS: int = int(os.environ.get("FRIEND_PUSH_WORKERS", "2"))

# Per-IP rate limit for credential auth endpoints (register / login / social /
# link / unlink / verify-email / set-password). Kept tight to blunt credential
# stuffing and enumeration while leaving a real human's few attempts untouched.
AUTH_THROTTLE_RATE: str = os.environ.get("AUTH_THROTTLE_RATE", "20/min")

# Per-IP rate limit for the email-dispatching endpoints (request password reset /
# request email verification). Tighter, because each call can send an email.
AUTH_EMAIL_THROTTLE_RATE: str = os.environ.get("AUTH_EMAIL_THROTTLE_RATE", "5/min")

# Per-IP rate limit for the nickname-availability probe
# (GET /v1/account/nickname-available). Generous, because the edit UI checks as
# the user types, but capped to blunt scripted handle enumeration.
NICKNAME_CHECK_THROTTLE_RATE: str = os.environ.get("NICKNAME_CHECK_THROTTLE_RATE", "60/min")

# Per-IP rate limit for avatar upload/delete (PUT/POST/DELETE
# /v1/account/me/avatar). Each upload re-encodes an image, so keep it modest.
AVATAR_THROTTLE_RATE: str = os.environ.get("AVATAR_THROTTLE_RATE", "10/min")

# Per-ACCOUNT rate limit for the authenticated AI menu-scan endpoint
# (POST /v1/pub-menu-scan). ScopedRateThrottle keys authenticated requests on
# request.user.pk (NOT the IP), so this is per signed-in account. Each call sends
# a photo to a metered vision model, so keep it tight — this is the first line of
# cost defence (the per-account daily cap below and the OpenRouter daily cap are
# the second and third). Format: DRF throttle rate string.
MENU_SCAN_THROTTLE_RATE: str = os.environ.get("MENU_SCAN_THROTTLE_RATE", "6/min")

# Per-account daily cap on menu scans (UTC day). Bounds how much of the shared
# OpenRouter daily pool a single actor can drain, so one account cannot deny the
# feature to everyone else for the rest of the day. Backed by the Django cache, so
# it carries the same per-process caveat as the throttles above until a shared
# cache (Redis/Memcached) is configured. 0 disables it.
MENU_SCAN_DAILY_PER_ACCOUNT_CAP: int = int(
    os.environ.get("MENU_SCAN_DAILY_PER_ACCOUNT_CAP", "100")
)

# --- Pub amenities ("Zmapuj hospodu") ---
# Per-IP rate limit for the authenticated amenity-vote sync endpoint
# (PUT/GET/DELETE /v1/pub-amenities/votes). A sync may upsert several votes in a
# burst when a fresh install pushes its local mapping; matches pub_ratings.
# Format: DRF throttle rate string.
PUB_AMENITIES_THROTTLE_RATE: str = os.environ.get("PUB_AMENITIES_THROTTLE_RATE", "120/min")
# Per-IP rate limit for the public taxonomy endpoint (GET /v1/pub-amenities/kinds).
AMENITY_KINDS_THROTTLE_RATE: str = os.environ.get("AMENITY_KINDS_THROTTLE_RATE", "120/min")
# Per-IP rate limit for the public aggregate read (GET /v1/pub-amenities). This
# is local-DB-only — DEDICATED scope, NOT pubs_near, which protects metered
# Mapy credits. Format: DRF throttle rate string.
AMENITY_READS_THROTTLE_RATE: str = os.environ.get("AMENITY_READS_THROTTLE_RATE", "60/min")
# Hard cap on cache_keys per GET /v1/pub-amenities batch read.
AMENITY_READ_MAX_KEYS: int = int(os.environ.get("AMENITY_READ_MAX_KEYS", "60"))
# Public nearby-search amenity filters stay bounded so each request performs a
# small, predictable number of indexed aggregate scans.
PUBS_NEAR_MAX_AMENITY_FILTERS: int = int(
    os.environ.get("PUBS_NEAR_MAX_AMENITY_FILTERS", "5")
)
# The redesigned pub list offers multi-select brands. Keep the OR query and
# response bounded just like amenity filters; five is already more than the
# sheet can usefully scan at a pub table.
PUBS_NEAR_MAX_BEER_FILTERS: int = int(os.environ.get("PUBS_NEAR_MAX_BEER_FILTERS", "5"))
MAP_AMENITY_CONFIDENCE_FLOOR: float = float(
    os.environ.get("MAP_AMENITY_CONFIDENCE_FLOOR", "0.5")
)
MAP_AMENITY_SCAN_LIMIT: int = int(os.environ.get("MAP_AMENITY_SCAN_LIMIT", "200"))
# Aggregation tunables (§5.4): below AMENITY_MIN_VOTES a fact stays "unknown";
# a minority share >= AMENITY_DISPUTE_RATIO marks the aggregate "disputed".
AMENITY_MIN_VOTES: int = int(os.environ.get("AMENITY_MIN_VOTES", "3"))
AMENITY_DISPUTE_RATIO: float = float(os.environ.get("AMENITY_DISPUTE_RATIO", "0.34"))
# Anti-grind: per-account daily distinct-cache_key vote cap (enforcement in step 2).
AMENITY_MAX_PUBS_PER_DAY: int = int(os.environ.get("AMENITY_MAX_PUBS_PER_DAY", "200"))
# Mapér XP constants (env-default; surfaced via GET /me xp_rules).
MAPER_XP_FIRST_FACT: int = int(os.environ.get("MAPER_XP_FIRST_FACT", "15"))
MAPER_XP_FIRST_MAPPER_BONUS: int = int(os.environ.get("MAPER_XP_FIRST_MAPPER_BONUS", "25"))
MAPER_XP_CONFIRM: int = int(os.environ.get("MAPER_XP_CONFIRM", "5"))
MAPER_XP_PUB_COMPLETE_BONUS: int = int(os.environ.get("MAPER_XP_PUB_COMPLETE_BONUS", "30"))
# Mapér level ladder (§7.2): min-XP thresholds, lowest first, env-tunable as a
# comma list so the titles/levels can be re-tuned without a code change. Levels are
# 1-indexed; titles are fixed (the client maps level→title for the level-up toast).
MAPER_LEVEL_THRESHOLDS: list[int] = [
    int(x.strip())
    for x in os.environ.get(
        "MAPER_LEVEL_THRESHOLDS",
        "0,300,900,2500,6000,12000,24000",
    ).split(",")
    if x.strip() != ""
]

# Pivař XP rewards documenting and discovery, never unbounded drink volume.
PIVAR_XP_EVENING: int = int(os.environ.get("PIVAR_XP_EVENING", "20"))
PIVAR_XP_NEW_PUB: int = int(os.environ.get("PIVAR_XP_NEW_PUB", "40"))
PIVAR_XP_NEW_BRAND: int = int(os.environ.get("PIVAR_XP_NEW_BRAND", "15"))
PIVAR_XP_EXTRA_BEER: int = int(os.environ.get("PIVAR_XP_EXTRA_BEER", "2"))
PIVAR_XP_EXTRA_BEER_DAILY_CAP: int = int(
    os.environ.get("PIVAR_XP_EXTRA_BEER_DAILY_CAP", "5")
)
PIVAR_XP_CONTEXT_FIRST: int = int(os.environ.get("PIVAR_XP_CONTEXT_FIRST", "25"))
PIVAR_XP_PHOTO: int = int(os.environ.get("PIVAR_XP_PHOTO", "10"))
PIVAR_XP_CHECKIN: int = int(os.environ.get("PIVAR_XP_CHECKIN", "5"))
PIVAR_LEVEL_THRESHOLDS: list[int] = [
    int(x.strip())
    for x in os.environ.get(
        "PIVAR_LEVEL_THRESHOLDS",
        "0,150,500,1500,4000,9000,18000",
    ).split(",")
    if x.strip() != ""
]

# --- Beer photo diary + FotoPivař photo contest ---
# Reject photo uploads larger than this BEFORE decoding (decompression-bomb guard).
BEER_PHOTO_MAX_UPLOAD_BYTES: int = int(
    os.environ.get("BEER_PHOTO_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024))
)
# Stored photo long-edge ceiling in pixels (aspect ratio kept, never cropped).
BEER_PHOTO_MAX_EDGE_PX: int = int(os.environ.get("BEER_PHOTO_MAX_EDGE_PX", "1600"))
# webp encoder quality for the stored photo.
BEER_PHOTO_WEBP_QUALITY: int = int(os.environ.get("BEER_PHOTO_WEBP_QUALITY", "80"))
# Per-account total photo cap — bounds disk usage per user (media volume cost).
BEER_PHOTO_MAX_PER_ACCOUNT: int = int(os.environ.get("BEER_PHOTO_MAX_PER_ACCOUNT", "200"))
# Per-ACCOUNT rate limit for photo uploads (POST /v1/beer-photos). Each upload
# re-encodes an image and writes to the media volume, so it is a daily budget
# rather than a per-minute burst limit. Format: DRF throttle rate string.
BEER_PHOTO_UPLOAD_THROTTLE_RATE: str = os.environ.get("BEER_PHOTO_UPLOAD_THROTTLE_RATE", "30/day")
# Per-ACCOUNT rate limit shared by the photo-contest endpoints
# (GET /v1/photo-contest, entry + vote writes). DB-only, but the contest screen
# can poll, so it gets its own hourly budget. Format: DRF throttle rate string.
PHOTO_CONTEST_THROTTLE_RATE: str = os.environ.get("PHOTO_CONTEST_THROTTLE_RATE", "120/hour")
# Anchor of the deterministic 14-day contest windows: an ISO date interpreted as
# 00:00 UTC. Changing it re-buckets ALL rounds, so treat it as immutable once live.
PHOTO_CONTEST_EPOCH: str = os.environ.get("PHOTO_CONTEST_EPOCH", "2026-01-05")
# XP paid onto AccountUsageStats.mapper_xp when a round closes (top 3 ranks).
PHOTO_CONTEST_XP_FIRST: int = int(os.environ.get("PHOTO_CONTEST_XP_FIRST", "100"))
PHOTO_CONTEST_XP_SECOND: int = int(os.environ.get("PHOTO_CONTEST_XP_SECOND", "50"))
PHOTO_CONTEST_XP_THIRD: int = int(os.environ.get("PHOTO_CONTEST_XP_THIRD", "25"))

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.AllowAny",
    ],
    # Scoped throttle rates. SharedScopedRateThrottle stores its counters in
    # the database, so adding gunicorn workers does not multiply the limits.
    "DEFAULT_THROTTLE_RATES": {
        "account": ACCOUNT_REGISTER_THROTTLE_RATE,
        "account_export": ACCOUNT_EXPORT_THROTTLE_RATE,
        "feedback": FEEDBACK_THROTTLE_RATE,
        "community": COMMUNITY_THROTTLE_RATE,
        "added_pubs": ADDED_PUBS_THROTTLE_RATE,
        "drinks": DRINKS_THROTTLE_RATE,
        "beer_brands": BEER_BRANDS_THROTTLE_RATE,
        "pub_ratings": PUB_RATINGS_THROTTLE_RATE,
        "pub_visits": PUB_VISITS_THROTTLE_RATE,
        "pubs_near": PUBS_NEAR_THROTTLE_RATE,
        "pub_location_lookup": PUB_LOCATION_LOOKUP_THROTTLE_RATE,
        "pub_hours": PUB_HOURS_THROTTLE_RATE,
        "pub_reports": PUB_REPORTS_THROTTLE_RATE,
        "client_events": CLIENT_EVENTS_THROTTLE_RATE,
        "push_devices": PUSH_DEVICES_THROTTLE_RATE,
        "friends": FRIENDS_THROTTLE_RATE,
        "follows": FOLLOWS_THROTTLE_RATE,
        "night_comments": NIGHT_COMMENTS_THROTTLE_RATE,
        "stats": STATS_THROTTLE_RATE,
        "challenges": CHALLENGES_THROTTLE_RATE,
        "friends_dashboard": FRIENDS_DASHBOARD_THROTTLE_RATE,
        "auth": AUTH_THROTTLE_RATE,
        "auth_email": AUTH_EMAIL_THROTTLE_RATE,
        "nickname_check": NICKNAME_CHECK_THROTTLE_RATE,
        "avatar": AVATAR_THROTTLE_RATE,
        "pub_amenities": PUB_AMENITIES_THROTTLE_RATE,
        "amenity_kinds": AMENITY_KINDS_THROTTLE_RATE,
        "amenity_reads": AMENITY_READS_THROTTLE_RATE,
        "menu_scan": MENU_SCAN_THROTTLE_RATE,
        "beer_photo_upload": BEER_PHOTO_UPLOAD_THROTTLE_RATE,
        "photo_contest": PHOTO_CONTEST_THROTTLE_RATE,
        "public_reads": PUBLIC_READS_THROTTLE_RATE,
    },
}

# ---------------------------------------------------------------------------
# User accounts — auth, OAuth providers, transactional email
# ---------------------------------------------------------------------------
# The app starts anonymous (device-bound Account). Registering / signing in
# attaches a credential (EmailCredential) or social identity (AuthIdentity) to
# that same Account ("claim"), so the user's data follows them. Bearer tokens
# live in the AuthToken table (multi-device, revocable). See pubs/accounts.py.

# --- Email/password & token lifetimes ---
# How long an email-verification one-time token stays valid.
EMAIL_VERIFY_TTL_HOURS: int = int(os.environ.get("EMAIL_VERIFY_TTL_HOURS", "24"))
# How long a password-reset one-time token stays valid (kept short).
PASSWORD_RESET_TTL_HOURS: int = int(os.environ.get("PASSWORD_RESET_TTL_HOURS", "1"))
# Optional absolute TTL (days) for issued session tokens. Empty/0 = no expiry
# (a native app holds a long-lived Keychain credential; revocation is by row).
_auth_token_ttl_days = os.environ.get("AUTH_TOKEN_TTL_DAYS", "").strip()
AUTH_TOKEN_TTL_DAYS: int | None = int(_auth_token_ttl_days) if _auth_token_ttl_days else None
# Soft-delete grace window before a pending-deletion account is hard-purged.
ACCOUNT_DELETION_GRACE_DAYS: int = int(os.environ.get("ACCOUNT_DELETION_GRACE_DAYS", "14"))

# --- Deep links / web fallback (used in transactional emails) ---
# Custom URL scheme of the mobile app (app.config.ts `scheme`). Password reset
# can still use napivo://auth/...; email verification uses the public HTTPS API
# endpoint when sent from a request so mail clients do not have to support custom
# schemes. The web base URL hosts the Play-required public account-deletion page.
APP_DEEP_LINK_SCHEME: str = os.environ.get("APP_DEEP_LINK_SCHEME", "napivo")
WEB_BASE_URL: str = os.environ.get("WEB_BASE_URL", "https://tomasmach.github.io/na-pivo")

# --- Google Sign-In (server-side ID-token verification) ---
# OAuth client IDs from Google Cloud Console. The web client id is what the
# mobile @react-native-google-signin lib uses, so it becomes the token `aud` on
# both platforms; the iOS/android ids are accepted too for robustness. Any token
# whose aud is in this set is trusted (after signature/exp/iss/email_verified).
GOOGLE_WEB_CLIENT_ID: str = os.environ.get("GOOGLE_WEB_CLIENT_ID", "")
GOOGLE_IOS_CLIENT_ID: str = os.environ.get("GOOGLE_IOS_CLIENT_ID", "")
GOOGLE_ANDROID_CLIENT_ID: str = os.environ.get("GOOGLE_ANDROID_CLIENT_ID", "")
GOOGLE_OAUTH_ALLOWED_AUDIENCES: set[str] = {
    cid
    for cid in (GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID)
    if cid
}

# --- Sign in with Apple (server-side identity-token verification + revoke) ---
# Native iOS Sign in with Apple mints tokens whose `aud` is the app BUNDLE ID;
# a web/Android Services-ID flow would use the SERVICES ID. Accept both.
APPLE_BUNDLE_ID: str = os.environ.get("APPLE_BUNDLE_ID", "com.tomasmach.na-pivo")
APPLE_SERVICES_ID: str = os.environ.get("APPLE_SERVICES_ID", "")
APPLE_ALLOWED_AUDIENCES: list[str] = [
    aud for aud in (APPLE_BUNDLE_ID, APPLE_SERVICES_ID) if aud
]
# client_id used when signing the Apple client-secret JWT and calling revoke —
# defaults to the bundle id (native iOS).
APPLE_CLIENT_ID: str = os.environ.get("APPLE_CLIENT_ID", APPLE_BUNDLE_ID)
# Credentials for the Apple client-secret JWT (required to revoke tokens on
# account deletion — Apple mandates revocation). The private key is the .p8
# contents; literal "\n" sequences are normalized to newlines in pubs/oauth.py.
APPLE_TEAM_ID: str = os.environ.get("APPLE_TEAM_ID", "")
APPLE_KEY_ID: str = os.environ.get("APPLE_KEY_ID", "")
APPLE_PRIVATE_KEY: str = os.environ.get("APPLE_PRIVATE_KEY", "")

# Android App Links (/.well-known/assetlinks.json). Comma-separated SHA-256
# fingerprints of the Android signing certificate(s) — from EAS credentials or
# `keytool -list -v`. Never invented by the server: unset or malformed values
# serve no association (fail closed) and the deploy check refuses to pass.
ANDROID_APP_LINK_CERT_FINGERPRINTS: str = os.environ.get(
    "ANDROID_APP_LINK_CERT_FINGERPRINTS", ""
)

# --- Resend transactional email ---
RESEND_API_KEY: str = os.environ.get("RESEND_API_KEY", "")
EMAIL_FROM: str = os.environ.get("EMAIL_FROM", "Na Pivo <noreply@napivo.cz>")
# Only actually send when explicitly enabled AND a key is present; otherwise the
# emailer logs the message (dev no-op) so flows work without Resend configured.
EMAIL_ENABLED: bool = (
    os.environ.get("EMAIL_ENABLED", "False").lower() in ("1", "true", "yes")
    and bool(RESEND_API_KEY)
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "INFO")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": "pubs.observability.JsonLogFormatter",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": LOG_LEVEL,
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        "django.server": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        "pubs": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
    },
}

# ---------------------------------------------------------------------------
# Linear integration (feedback → Linear issue sync)
# ---------------------------------------------------------------------------
# Used by the `sync_feedback_linear` management command. If either is empty the
# command is a no-op, so leaving them unset disables the sync entirely.
LINEAR_API_KEY: str = os.environ.get("LINEAR_API_KEY", "")
LINEAR_TEAM_ID: str = os.environ.get("LINEAR_TEAM_ID", "")

# ---------------------------------------------------------------------------
# CORS (django-cors-headers)
# Allow the Expo / React Native app to call the API.
# ---------------------------------------------------------------------------
_cors_origins_raw = os.environ.get(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:8081,exp://localhost:8081",
)
CORS_ALLOWED_ORIGINS: list[str] = [
    o.strip() for o in _cors_origins_raw.split(",") if o.strip()
]
# Allow all origins ONLY in DEBUG (local dev / Expo) for convenience.
# In production (DEBUG=False) this is False, so only CORS_ALLOWED_ORIGINS apply.
CORS_ALLOW_ALL_ORIGINS: bool = DEBUG

# ---------------------------------------------------------------------------
# Firmy.cz scraper settings
# ---------------------------------------------------------------------------

# Optional residential proxy for all Firmy.cz requests.
# REQUIRED in production (robots.txt bans bots — see README).
# Format: "http://user:pass@proxy-host:port" or "socks5://..."
FIRMY_PROXY_URL: str | None = os.environ.get("FIRMY_PROXY_URL") or None

# Browser-like User-Agent sent with every Firmy.cz request.
FIRMY_USER_AGENT: str = os.environ.get(
    "FIRMY_USER_AGENT",
    "Mozilla/5.0 (Linux; Android 10; Pixel 4) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
)

# Minimum seconds between consecutive Firmy.cz HTTP requests (rate limiting).
FIRMY_MIN_INTERVAL_SEC: float = float(os.environ.get("FIRMY_MIN_INTERVAL_SEC", "3"))

# Hard database-backed daily cap shared by every Firmy.cz process.
FIRMY_DAILY_CAP: int = int(os.environ.get("FIRMY_DAILY_CAP", "2000"))

# ---------------------------------------------------------------------------
# Google Maps runtime settings
# ---------------------------------------------------------------------------

# Server-only key. Never expose this key in Expo; native map rendering uses
# separate platform-restricted SDK keys in the mobile repository.
GOOGLE_MAPS_SERVER_API_KEY: str = os.environ.get(
    "GOOGLE_MAPS_SERVER_API_KEY", ""
)
GOOGLE_MAPS_TIMEOUT: int = int(os.environ.get("GOOGLE_MAPS_TIMEOUT", "8"))
# Shared database-backed cap across Google geocoding/autocomplete entry points
# and workers.
GOOGLE_MAPS_DAILY_CAP: int = int(os.environ.get("GOOGLE_MAPS_DAILY_CAP", "250"))
GOOGLE_MAPS_LOCAL_SCAN_LIMIT: int = int(
    os.environ.get("GOOGLE_MAPS_LOCAL_SCAN_LIMIT", "80")
)

# Maximum rows returned from the imported CZ/SK directory.
PUBS_NEAR_LOCAL_MAX_ITEMS: int = int(
    os.environ.get("PUBS_NEAR_LOCAL_MAX_ITEMS", "300")
)

# OpenRouter vision (POST /v1/pub-menu-scan — beer-menu photo extraction).
# The endpoint uploads a menu photo to an AI vision model and returns a parsed
# beer list for the user to review (no DB writes, no XP, no image storage). If
# OPENROUTER_API_KEY is unset the endpoint returns 503 — the feature degrades
# gracefully and NEVER blocks startup.
OPENROUTER_API_KEY: str = os.environ.get("OPENROUTER_API_KEY", "")
# Vision model id (OpenAI-compatible chat-completions). Default is a fast, cheap
# multimodal model; override to trade cost for accuracy.
OPENROUTER_MODEL: str = os.environ.get(
    "OPENROUTER_MODEL", "google/gemini-3.1-flash-lite"
)
# Per-request HTTP timeout in seconds (vision is slow).
OPENROUTER_TIMEOUT: int = int(os.environ.get("OPENROUTER_TIMEOUT", "30"))
# Hard database-backed daily cap shared by every OpenRouter process. It counts
# individual requests and resets at UTC midnight.
OPENROUTER_DAILY_CAP: int = int(os.environ.get("OPENROUTER_DAILY_CAP", "5000"))

# Menu-scan image pipeline limits (mirror the avatar guards).
# Reject image files larger than this BEFORE decoding (decompression-bomb guard).
# Mobile pre-downscales to ~1600px JPEG, but modern original phone photos can
# still be large when client-side manipulation fails, so this is intentionally
# roomier than the final image sent to the model.
MENU_SCAN_MAX_UPLOAD_BYTES: int = int(
    os.environ.get("MENU_SCAN_MAX_UPLOAD_BYTES", str(20 * 1024 * 1024))
)
# Whole multipart request cap used before touching request.FILES. Keep slightly
# above MENU_SCAN_MAX_UPLOAD_BYTES for boundaries/headers; mirror this in Caddy
# with `request_body { max_size 24MB }` so giant bodies are rejected at the edge.
MENU_SCAN_MAX_REQUEST_BYTES: int = int(
    os.environ.get("MENU_SCAN_MAX_REQUEST_BYTES", str(24 * 1024 * 1024))
)
# Longest-edge pixel cap for the JPEG sent to the model (large enough for OCR).
MENU_SCAN_IMAGE_PX: int = int(os.environ.get("MENU_SCAN_IMAGE_PX", "1600"))
# JPEG encoder quality for the downscaled menu photo.
MENU_SCAN_JPEG_QUALITY: int = int(os.environ.get("MENU_SCAN_JPEG_QUALITY", "80"))

# ---------------------------------------------------------------------------
# Enrichment / cache settings
# ---------------------------------------------------------------------------

# How many days a cached PubHours row is considered fresh before re-fetching.
HOURS_TTL_DAYS: int = int(os.environ.get("HOURS_TTL_DAYS", "30"))

# How long a transient Firmy.cz ERROR row cools down before another proxy fetch
# is attempted. This prevents a proxy outage / consent-wall bounce from burning
# residential bandwidth on every pub-hours request.
FIRMY_ERROR_RETRY_COOLDOWN_MINUTES: int = int(
    os.environ.get("FIRMY_ERROR_RETRY_COOLDOWN_MINUTES", "15")
)

# Maximum number of pubs to enrich synchronously (in-request) per POST /v1/pub-hours.
# Pubs beyond this budget get an EnrichTask and return status "pending".
SYNC_ENRICH_BUDGET: int = int(os.environ.get("SYNC_ENRICH_BUDGET", "3"))

# ---------------------------------------------------------------------------
# Production hardening (only when DEBUG is False)
# ---------------------------------------------------------------------------
# Dev (DEBUG=True) behaviour is intentionally left untouched so the test suite
# and local `runserver` keep working without TLS or a proxy. In production we
# fail fast on insecure configuration and force TLS / secure-cookie defaults.
if not DEBUG:
    _validate_production_secret_key(SECRET_KEY)

    if not FIRMY_PROXY_URL:
        raise ImproperlyConfigured(
            "FIRMY_PROXY_URL is required in production: firmy.cz bounces "
            "datacenter IPs at the consent wall, so a residential proxy must "
            "be configured. Set FIRMY_PROXY_URL (see README)."
        )

    if SYNC_ENRICH_BUDGET < 0:
        raise ImproperlyConfigured(
            "SYNC_ENRICH_BUDGET must be >= 0. With 0, cold lookups return "
            "status 'pending' and refresh_hours performs enrichment in the "
            "background."
        )

    if APPLE_ALLOWED_AUDIENCES and not all((APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY)):
        raise ImproperlyConfigured(
            "APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY are required in "
            "production so Sign in with Apple tokens can be exchanged and "
            "revoked during account deletion."
        )

    # Force HTTPS and trust the reverse-proxy's forwarded-proto header.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = True

    # HSTS — 1 year, including subdomains.
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True

    # Cookies only over TLS.
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

    # Defence-in-depth headers.
    SECURE_CONTENT_TYPE_NOSNIFF = True
