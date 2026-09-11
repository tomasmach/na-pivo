"""Guards for the Postgres connection pool.

The test suite runs on SQLite, so nothing else here exercises the production
database configuration. These tests read it out of a real settings import
instead: without a pool (or with persistent connections back on) every ASGI
request opens its own Postgres connection and the evening peak runs the server
out of connection slots.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]

POSTGRES_URL = "postgres://napivo:secret@db:5432/napivo"


def load_default_database(**overrides: str) -> dict:
    """Import settings in a clean subprocess and return DATABASES["default"]."""
    env = os.environ.copy()
    env["DEBUG"] = "True"
    env["DJANGO_SETTINGS_MODULE"] = "config.settings"
    for key in ("DATABASE_URL", "DB_POOL_MIN_SIZE", "DB_POOL_MAX_SIZE", "DB_POOL_TIMEOUT"):
        env.pop(key, None)
    env.update(overrides)
    code = (
        "import django, json; django.setup(); "
        "from django.conf import settings; "
        "print(json.dumps(settings.DATABASES['default'], default=str))"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return json.loads(result.stdout)


def test_postgres_pools_connections_instead_of_keeping_them_per_request():
    config = load_default_database(DATABASE_URL=POSTGRES_URL)

    # Django rejects a pool combined with persistent connections, and a
    # persistent connection on ASGI is never reused anyway: each request runs on
    # its own short-lived thread.
    assert config["CONN_MAX_AGE"] == 0
    pool = config["OPTIONS"]["pool"]
    assert pool["max_size"] == 20
    assert pool["min_size"] == 2
    assert pool["timeout"] == 10


def test_pool_size_is_configurable_and_minimum_cannot_exceed_maximum():
    config = load_default_database(
        DATABASE_URL=POSTGRES_URL,
        DB_POOL_MAX_SIZE="4",
        DB_POOL_MIN_SIZE="9",
    )

    pool = config["OPTIONS"]["pool"]
    assert pool["max_size"] == 4
    # psycopg raises on min > max, and it raises per request — clamping keeps a
    # typo in one env value from turning every endpoint into a 500.
    assert pool["min_size"] == 4


def test_sqlite_development_database_is_left_alone():
    config = load_default_database()

    assert config["ENGINE"] == "django.db.backends.sqlite3"
    assert "pool" not in config["OPTIONS"]
