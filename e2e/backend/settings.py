"""Fail closed before loading application settings or touching a database."""

import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

ROOT = Path(__file__).resolve().parents[2]
RUN_DIR = Path(os.environ.get("NA_PIVO_E2E_RUN_DIR", "/missing")).resolve()
if (
    os.environ.get("NA_PIVO_E2E") != "1"
    or os.environ.get("DEBUG") != "True"
    or not RUN_DIR.is_relative_to(ROOT / ".e2e" / "runs")
    or not (RUN_DIR / "owner.json").is_file()
):
    raise ImproperlyConfigured("E2E requires an owned local run directory and explicit DEBUG.")

os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ["DATABASE_URL"] = f"sqlite:///{RUN_DIR / 'test.sqlite3'}"

from config.settings import *  # noqa: E402,F403

ROOT_URLCONF = "e2e.backend.urls"
INSTALLED_APPS = [*INSTALLED_APPS, "e2e.backend.apps.LocalFixtures"]  # noqa: F405
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "testserver"]
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
EMAIL_ENABLED = False
# Exercise the real export serializer and mail delivery without a job worker.
ACCOUNT_EXPORT_ASYNC = False
RESEND_API_KEY = ""
MEDIA_ROOT = RUN_DIR / "media"
PUBLIC_WEB_ORIGIN = f"http://127.0.0.1:{os.environ['NA_PIVO_E2E_BACKEND_PORT']}"
LOGGING = {
    "version": 1,
    "disable_existing_loggers": True,
    "handlers": {"null": {"class": "logging.NullHandler"}},
    "root": {"handlers": ["null"]},
}

# No paid discovery/enrichment fallback, even if the invoking shell has keys.
for _name in list(globals()):
    if _name.endswith(("_API_KEY", "_PRIVATE_KEY", "_PROXY_URL")):
        globals()[_name] = ""
