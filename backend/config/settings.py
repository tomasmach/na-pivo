"""
Django settings for na-pivo backend.

All sensitive / environment-specific values are read from environment variables
(or a .env file loaded by python-dotenv at startup).  See .env.example for the
full list of available variables.
"""

import os
from pathlib import Path

import dj_database_url
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

# Per-IP rate limit for the authenticated drink-logging endpoint
# (POST /v1/drinks). The in-app beer counter can log several beers in one
# session (one POST each), so this is more generous than the community rate;
# it still blunts scripted mass logging. Format: DRF throttle rate string.
DRINKS_THROTTLE_RATE: str = os.environ.get("DRINKS_THROTTLE_RATE", "60/min")

# Per-IP rate limit for the authenticated pub-rating sync endpoint
# (PUT/GET/DELETE /v1/pub-ratings). A two-way sync may upsert several ratings in
# a burst when a fresh install pushes its local history, so this is generous;
# it still blunts scripted mass writes. Format: DRF throttle rate string.
PUB_RATINGS_THROTTLE_RATE: str = os.environ.get("PUB_RATINGS_THROTTLE_RATE", "120/min")

# Per-IP rate limit for the authenticated pub-visit push endpoint
# (POST/GET/DELETE /v1/pub-visits). Mirrors the rating rate for the same
# burst-on-sync reason. Format: DRF throttle rate string.
PUB_VISITS_THROTTLE_RATE: str = os.environ.get("PUB_VISITS_THROTTLE_RATE", "120/min")

# Per-IP rate limit for the unauthenticated Mapy.cz "pubs near" proxy
# (GET /v1/pubs/near). The result is shared-cached per geohash-6 cell, so the
# legitimate once-per-search call is cheap while staying local enough for dense
# city areas; this blunts scripted enumeration.
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

# Per-IP rate limit for privacy-safe client telemetry events. The client sends a
# small lifecycle/error/distance whitelist only; this cap protects the endpoint
# from noisy loops and scripted spam.
CLIENT_EVENTS_THROTTLE_RATE: str = os.environ.get("CLIENT_EVENTS_THROTTLE_RATE", "120/min")

# Per-IP rate limit for credential auth endpoints (register / login / social /
# link / unlink / verify-email / set-password). Kept tight to blunt credential
# stuffing and enumeration while leaving a real human's few attempts untouched.
AUTH_THROTTLE_RATE: str = os.environ.get("AUTH_THROTTLE_RATE", "20/min")

# Per-IP rate limit for the email-dispatching endpoints (request password reset /
# request email verification). Tighter, because each call can send an email.
AUTH_EMAIL_THROTTLE_RATE: str = os.environ.get("AUTH_EMAIL_THROTTLE_RATE", "5/min")

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
    # Scoped throttle rates. Views opt in with throttle_classes =
    # [ScopedRateThrottle] and throttle_scope.
    # NOTE: DRF throttling uses the Django cache. The default LocMemCache is
    # per-process, so under multiple gunicorn workers the effective limit is
    # rate × workers — configure a shared cache (Redis/Memcached) for an exact
    # global limit in production.
    "DEFAULT_THROTTLE_RATES": {
        "account": ACCOUNT_REGISTER_THROTTLE_RATE,
        "feedback": FEEDBACK_THROTTLE_RATE,
        "community": COMMUNITY_THROTTLE_RATE,
        "added_pubs": ADDED_PUBS_THROTTLE_RATE,
        "drinks": DRINKS_THROTTLE_RATE,
        "pub_ratings": PUB_RATINGS_THROTTLE_RATE,
        "pub_visits": PUB_VISITS_THROTTLE_RATE,
        "pubs_near": PUBS_NEAR_THROTTLE_RATE,
        "pub_hours": PUB_HOURS_THROTTLE_RATE,
        "pub_reports": PUB_REPORTS_THROTTLE_RATE,
        "client_events": CLIENT_EVENTS_THROTTLE_RATE,
        "auth": AUTH_THROTTLE_RATE,
        "auth_email": AUTH_EMAIL_THROTTLE_RATE,
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

# --- Deep links / web fallback (used in verification & reset emails) ---
# Custom URL scheme of the mobile app (app.config.ts `scheme`). Email links use
# napivo://auth/... and the web base URL is the https fallback + the Play-required
# public account-deletion page.
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

# Hard daily cap on Firmy.cz requests across the whole process.
FIRMY_DAILY_CAP: int = int(os.environ.get("FIRMY_DAILY_CAP", "2000"))

# ---------------------------------------------------------------------------
# Mapy.cz "pubs near" proxy settings
# ---------------------------------------------------------------------------

# Mapy.cz API key for the server-side /v1/suggest proxy (GET /v1/pubs/near).
# The mobile app no longer calls Mapy.cz directly (it exhausted the shared
# credit); the server fetches once per geohash-6 cell and caches the result.
# REQUIRED for the endpoint to work: if unset, /v1/pubs/near returns 503 and the
# client falls back to calling Mapy.cz directly.
MAPY_API_KEY: str = os.environ.get("MAPY_API_KEY", "")

# Hard daily cap on Mapy.cz suggest HTTP requests across the whole process
# (counts INDIVIDUAL requests, like FIRMY_DAILY_CAP — each search makes up to
# 4 term-queries × the number of bbox-widening steps it needs).
MAPY_DAILY_CAP: int = int(os.environ.get("MAPY_DAILY_CAP", "5000"))

# How many days a cached PubSearchCache row is considered fresh before the
# server re-fetches from Mapy.cz. A stale row is still served if the upstream
# fetch fails.
PUBS_NEAR_TTL_DAYS: int = int(os.environ.get("PUBS_NEAR_TTL_DAYS", "7"))

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
    from django.core.exceptions import ImproperlyConfigured

    if SECRET_KEY.startswith("django-insecure"):
        raise ImproperlyConfigured(
            "SECRET_KEY is still the insecure development default. "
            "Set a strong, unique SECRET_KEY environment variable in production."
        )

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

    # Force HTTPS and trust the reverse-proxy's forwarded-proto header.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = True

    # HSTS — 1 year, including subdomains.
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True

    # Cookies only over TLS.
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

    # Defence-in-depth headers.
    SECURE_CONTENT_TYPE_NOSNIFF = True
