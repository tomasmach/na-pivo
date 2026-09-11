"""Guards for the Postgres connection pool.

The test suite runs on SQLite, so nothing else here exercises the production
database configuration. These tests read it out of a real settings import and
then build the pool Django would build: without a pool (or with persistent
connections back on) every ASGI request opens its own Postgres connection and
the evening peak runs the server out of connection slots.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

from psycopg_pool import ConnectionPool

BACKEND_ROOT = Path(__file__).resolve().parents[2]

POSTGRES_URL = "postgres://napivo:secret@db:5432/napivo"
SQLITE_URL = f"sqlite:///{BACKEND_ROOT / 'db.sqlite3'}"


def load_default_database(**overrides: str) -> dict:
    """Import settings in a clean subprocess and return DATABASES["default"]."""
    env = os.environ.copy()
    env["DEBUG"] = "True"
    env["DJANGO_SETTINGS_MODULE"] = "config.settings"
    for key in (
        "DB_POOL_MIN_SIZE",
        "DB_POOL_MAX_SIZE",
        "DB_POOL_TIMEOUT",
        "DB_POOL_MAX_IDLE",
    ):
        env.pop(key, None)
    # settings.py loads backend/.env, which on a developer machine may well set
    # DATABASE_URL. Always say which database this run is about.
    env["DATABASE_URL"] = SQLITE_URL
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


def build_pool(config: dict) -> ConnectionPool:
    """Build the pool Django would build for this config, without connecting.

    Django creates pools with ``open=False``, so this needs no database — but it
    does need ``psycopg[pool]`` to be installed, which is the other half of what
    can silently go missing in the container image.
    """
    from django.db.backends.postgresql.base import DatabaseWrapper

    # A private alias: DatabaseWrapper caches pools in a dict shared by the
    # whole process, and "default" belongs to the test database.
    return DatabaseWrapper(config, alias="db_pool_settings_test").pool


def test_postgres_pools_connections_instead_of_keeping_them_per_request():
    config = load_default_database(DATABASE_URL=POSTGRES_URL)

    # Django rejects a pool combined with persistent connections, and a
    # persistent connection on ASGI is never reused anyway: each request runs on
    # its own short-lived thread.
    assert config["CONN_MAX_AGE"] == 0
    assert config["CONN_HEALTH_CHECKS"] is True
    pool = config["OPTIONS"]["pool"]
    assert pool["max_size"] == 20
    assert pool["min_size"] == 2
    assert pool["timeout"] == 10
    # psycopg retires at most one connection per window; its 600 s default would
    # park a peak's worth of connections for hours.
    assert pool["max_idle"] == 60


def test_settings_produce_a_pool_psycopg_actually_accepts():
    pool = build_pool(load_default_database(DATABASE_URL=POSTGRES_URL))
    try:
        assert pool.min_size == 2
        assert pool.max_size == 20
        assert pool.timeout == 10
        assert pool.max_idle == 60
        # CONN_HEALTH_CHECKS: a connection that the server closed underneath us
        # is reconnected on checkout instead of failing somebody's request.
        assert pool._check is not None
    finally:
        pool.close()


def test_pool_size_is_configurable_and_minimum_cannot_exceed_maximum():
    config = load_default_database(
        DATABASE_URL=POSTGRES_URL,
        DB_POOL_MAX_SIZE="4",
        DB_POOL_MIN_SIZE="9",
    )

    assert config["OPTIONS"]["pool"]["max_size"] == 4
    assert config["OPTIONS"]["pool"]["min_size"] == 4
    build_pool(config).close()


def test_a_negative_pool_minimum_does_not_take_the_api_down():
    # psycopg raises "min_size cannot be negative" on the first query, not at
    # startup, so an unclamped typo would 500 every endpoint.
    config = load_default_database(DATABASE_URL=POSTGRES_URL, DB_POOL_MIN_SIZE="-1")

    assert config["OPTIONS"]["pool"]["min_size"] == 0
    build_pool(config).close()


def test_sqlite_development_database_is_left_alone():
    config = load_default_database()

    assert config["ENGINE"] == "django.db.backends.sqlite3"
    assert "pool" not in config["OPTIONS"]
