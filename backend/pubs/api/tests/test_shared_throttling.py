from __future__ import annotations

import sqlite3
import threading
import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from django.db import connection
from django.test import RequestFactory
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from pubs.api.party_views import _stream_handshake
from pubs.models import ApiRateLimitBucket


@pytest.mark.django_db
def test_throttle_survives_process_local_cache_reset(monkeypatch) -> None:
    rates = dict(ScopedRateThrottle.THROTTLE_RATES)
    rates["account"] = "1/min"
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", rates)
    client = APIClient()

    first = client.post(
        "/v1/account",
        data={"device_id": str(uuid.uuid4())},
        format="json",
        REMOTE_ADDR="192.0.2.10",
    )
    second = client.post(
        "/v1/account",
        data={"device_id": str(uuid.uuid4())},
        format="json",
        REMOTE_ADDR="192.0.2.10",
    )

    assert first.status_code == status.HTTP_201_CREATED
    assert second.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert int(second["Retry-After"]) > 0
    assert ApiRateLimitBucket.objects.get().request_count == 1


@pytest.mark.django_db
def test_sse_charges_one_shared_token_per_handshake(monkeypatch) -> None:
    rates = dict(ScopedRateThrottle.THROTTLE_RATES)
    rates["friends"] = "1/min"
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", rates)
    registered = APIClient().post(
        "/v1/account",
        data={"device_id": str(uuid.uuid4())},
        format="json",
        REMOTE_ADDR="192.0.2.20",
    ).json()
    request = RequestFactory().get(
        "/v1/party-evenings/PRAH24/games/stream",
        HTTP_AUTHORIZATION=f"Bearer {registered['token']}",
        REMOTE_ADDR="192.0.2.20",
    )

    account, retry_after = _stream_handshake(request)
    same_account, throttled_retry_after = _stream_handshake(request)

    assert account is not None
    assert same_account == account
    assert retry_after is None
    assert throttled_retry_after is not None
    assert throttled_retry_after > 0
    assert ApiRateLimitBucket.objects.get(scope="friends").request_count == 1


@pytest.mark.django_db
def test_zero_rate_denies_the_first_request_without_creating_a_bucket(monkeypatch) -> None:
    rates = dict(ScopedRateThrottle.THROTTLE_RATES)
    rates["account"] = "0/min"
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", rates)

    response = APIClient().post(
        "/v1/account",
        data={"device_id": str(uuid.uuid4())},
        format="json",
        REMOTE_ADDR="192.0.2.30",
    )

    assert response.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert ApiRateLimitBucket.objects.count() == 0


@pytest.mark.django_db
def test_retry_after_rounds_up_the_remaining_fixed_window(monkeypatch) -> None:
    rates = dict(ScopedRateThrottle.THROTTLE_RATES)
    rates["account"] = "1/min"
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", rates)
    client = APIClient()
    now = datetime(2026, 8, 21, 12, 0, 58, 900_000, tzinfo=UTC)

    with patch("pubs.api.throttling.timezone.now", return_value=now):
        first = client.post(
            "/v1/account",
            data={"device_id": str(uuid.uuid4())},
            format="json",
            REMOTE_ADDR="192.0.2.31",
        )
        second = client.post(
            "/v1/account",
            data={"device_id": str(uuid.uuid4())},
            format="json",
            REMOTE_ADDR="192.0.2.31",
        )

    assert first.status_code == status.HTTP_201_CREATED
    assert second.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert second["Retry-After"] == "2"


def test_sqlite_concurrent_write_waits_before_read_then_drink_insert(tmp_path) -> None:
    if connection.vendor != "sqlite":
        pytest.skip("SQLite dev reliability regression")

    options = connection.settings_dict["OPTIONS"]
    assert options["transaction_mode"] == "IMMEDIATE"
    assert options["timeout"] >= 5
    database = tmp_path / "concurrent.sqlite3"
    setup = sqlite3.connect(database)
    setup.executescript(
        """
        CREATE TABLE account (id INTEGER PRIMARY KEY);
        CREATE TABLE rate_bucket (id INTEGER PRIMARY KEY);
        CREATE TABLE drink (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL);
        INSERT INTO account (id) VALUES (1);
        """
    )
    setup.close()
    writer_ready = threading.Event()
    release_writer = threading.Event()
    errors: list[BaseException] = []

    def hold_write_lock() -> None:
        database_connection = sqlite3.connect(database, timeout=options["timeout"])
        try:
            database_connection.execute("BEGIN IMMEDIATE")
            database_connection.execute("INSERT INTO rate_bucket (id) VALUES (1)")
            writer_ready.set()
            assert release_writer.wait(timeout=2)
            database_connection.commit()
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            database_connection.close()

    def create_drink_after_account_read() -> None:
        database_connection = sqlite3.connect(database, timeout=options["timeout"])
        try:
            assert writer_ready.wait(timeout=2)
            database_connection.execute(f"BEGIN {options['transaction_mode']}")
            assert database_connection.execute(
                "SELECT id FROM account WHERE id = 1"
            ).fetchone() == (1,)
            database_connection.execute(
                "INSERT INTO drink (id, account_id) VALUES (1, 1)"
            )
            database_connection.commit()
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            database_connection.close()

    writer = threading.Thread(target=hold_write_lock)
    contender = threading.Thread(target=create_drink_after_account_read)
    writer.start()
    contender.start()
    release_timer = threading.Timer(0.2, release_writer.set)
    release_timer.start()
    writer.join(timeout=3)
    contender.join(timeout=3)
    release_timer.cancel()

    assert not writer.is_alive()
    assert not contender.is_alive()
    assert errors == []
    verify = sqlite3.connect(database)
    try:
        assert verify.execute("SELECT COUNT(*) FROM drink").fetchone() == (1,)
    finally:
        verify.close()
