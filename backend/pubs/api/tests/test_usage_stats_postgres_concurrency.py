from __future__ import annotations

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import close_old_connections, connection, connections, transaction
from rest_framework import status
from rest_framework.test import APIClient

from pubs.accounts import issue_token
from pubs.api import views
from pubs.models import (
    Account,
    AccountUsageStats,
    AmenityKind,
    AmenityXpLedger,
    ClientEvent,
    PubAmenity,
    PubAmenityVote,
)

pytestmark = pytest.mark.skipif(
    connection.vendor != "postgresql",
    reason="PostgreSQL row locks and deferred FK checks are required",
)

_LAT = 50.0885
_LNG = 14.3984
_AMENITY = "seating_garden"


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _vote_body() -> dict:
    return {
        "votes": [
            {
                "name": "U Zámku",
                "lat": _LAT,
                "lng": _LNG,
                "city": "Praha",
                "amenity_key": _AMENITY,
                "value": "yes",
                "client_updated_at": "2026-10-01T18:30:00+02:00",
                "taxonomy_version": 1,
            }
        ]
    }


def _account_with_stats(label: str) -> tuple[Account, str]:
    # Transactional tests flush migration-seeded kinds, so own the one we vote on.
    AmenityKind.objects.get_or_create(
        key=_AMENITY,
        defaults={"label": "Zahrádka", "group": AmenityKind.Group.SEATING, "active": True},
    )
    account = Account.objects.create(device_id=f"pg-{label}-{uuid.uuid4().hex}")
    # A returning user already has counters from earlier app opens.
    AccountUsageStats.objects.create(account=account)
    return account, issue_token(account)


def _in_thread(fn):
    def run():
        close_old_connections()
        try:
            return fn()
        finally:
            connections.close_all()

    return run


def _wait_for_lock_waiters(count: int, timeout: float = 10) -> None:
    """Block until `count` other backends of this database wait on a row lock."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = current_database() AND wait_event_type = 'Lock' "
                "AND pid <> pg_backend_pid()"
            )
            if cursor.fetchone()[0] >= count:
                return
        time.sleep(0.02)
    raise AssertionError(f"expected {count} backend(s) waiting on a lock")


@pytest.mark.django_db(transaction=True)
def test_amenity_vote_and_client_event_do_not_deadlock_on_postgres(monkeypatch, caplog):
    """Reproduce the production deadlock between a vote and a client event.

    Django creates PostgreSQL foreign keys DEFERRABLE INITIALLY DEFERRED, so the
    vote's inserts request their KEY SHARE lock on pubs_account only at COMMIT.
    The vote pauses after it updated AccountUsageStats. A client event of the
    same account then locks the Account row and waits for that stats row. With
    the old order the vote's COMMIT waits for the Account and PostgreSQL aborts
    one side. With Account -> stats in both paths the event simply waits.
    """

    account, token = _account_with_stats("deadlock")
    vote_holds_stats = threading.Event()
    release_vote = threading.Event()
    real_award = views._award_mapper_xp

    def pause_after_stats_update(*args, **kwargs):
        xp = real_award(*args, **kwargs)
        if not vote_holds_stats.is_set():
            vote_holds_stats.set()
            if not release_vote.wait(timeout=10):
                raise AssertionError("client event never reached its lock wait")
        return xp

    monkeypatch.setattr(views, "_award_mapper_xp", pause_after_stats_update)
    caplog.set_level(logging.WARNING, logger=views.logger.name)

    def put_vote():
        response = APIClient().put(
            "/v1/pub-amenities/votes", data=_vote_body(), format="json", **_auth(token)
        )
        return response.status_code, response.json()

    def post_event():
        response = APIClient().post(
            "/v1/client-events", data={"event": "app_foreground"}, format="json", **_auth(token)
        )
        return response.status_code, response.json()

    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="usage-stats-lock") as executor:
        vote_future = executor.submit(_in_thread(put_vote))
        assert vote_holds_stats.wait(timeout=10)
        event_future = executor.submit(_in_thread(post_event))
        _wait_for_lock_waiters(1)
        release_vote.set()
        vote_status, vote_payload = vote_future.result(timeout=20)
        event_status, event_payload = event_future.result(timeout=20)

    assert vote_status == status.HTTP_200_OK, vote_payload
    assert event_status == status.HTTP_202_ACCEPTED, event_payload
    # The lock order itself is fixed; no request needed the deadlock retry.
    assert "rerunning transaction" not in caplog.text

    result = vote_payload["results"][0]
    assert result["applied"] is True
    assert result["xp_awarded"] > 0
    stats = AccountUsageStats.objects.get(account=account)
    assert stats.app_foreground_count == 1
    assert stats.mapper_xp == result["xp_awarded"]
    assert stats.amenity_votes_count == 1
    assert ClientEvent.objects.filter(account=account).count() == 1
    assert PubAmenityVote.objects.filter(account=account).count() == 1
    assert AmenityXpLedger.objects.filter(account=account).count() == 1
    assert PubAmenity.objects.get(amenity_key=_AMENITY).yes_count == 1


@pytest.mark.django_db(transaction=True)
def test_vote_retries_whole_transaction_after_real_deadlock(caplog):
    """A real PostgreSQL deadlock aborts the vote; the rerun pays XP once.

    Another account already created the aggregate. A blocker transaction locks
    the voter's stats row; the vote locks the aggregate and waits for the stats
    row; the blocker then asks for the aggregate. The vote waited first, so its
    deadlock check fires first and PostgreSQL aborts the vote transaction.
    """

    other, other_token = _account_with_stats("first-mapper")
    voter, voter_token = _account_with_stats("retry")
    first = APIClient().put(
        "/v1/pub-amenities/votes", data=_vote_body(), format="json", **_auth(other_token)
    )
    assert first.status_code == status.HTTP_200_OK, first.content
    aggregate = PubAmenity.objects.get(amenity_key=_AMENITY)
    caplog.set_level(logging.WARNING, logger=views.logger.name)

    blocker_holds_stats = threading.Event()
    vote_waits = threading.Event()

    def blocker():
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(
                "UPDATE pubs_accountusagestats SET app_open_count = app_open_count "
                "WHERE account_id = %s",
                [voter.pk],
            )
            blocker_holds_stats.set()
            if not vote_waits.wait(timeout=10):
                raise AssertionError("vote never waited for the stats row")
            cursor.execute("SELECT 1 FROM pubs_pubamenity WHERE id = %s FOR UPDATE", [aggregate.pk])

    def put_vote():
        response = APIClient().put(
            "/v1/pub-amenities/votes", data=_vote_body(), format="json", **_auth(voter_token)
        )
        return response.status_code, response.json()

    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="usage-stats-retry") as executor:
        blocker_future = executor.submit(_in_thread(blocker))
        assert blocker_holds_stats.wait(timeout=10)
        vote_future = executor.submit(_in_thread(put_vote))
        _wait_for_lock_waiters(1)
        vote_waits.set()
        vote_status, vote_payload = vote_future.result(timeout=20)
        blocker_future.result(timeout=20)

    assert vote_status == status.HTTP_200_OK, vote_payload
    assert "lock conflict 40P01, rerunning transaction" in caplog.text
    result = vote_payload["results"][0]
    assert result["applied"] is True
    assert result["was_first_map"] is False
    assert result["xp_awarded"] > 0
    stats = AccountUsageStats.objects.get(account=voter)
    assert stats.mapper_xp == result["xp_awarded"]
    assert stats.amenity_votes_count == 1
    assert PubAmenityVote.objects.filter(account=voter).count() == 1
    assert AmenityXpLedger.objects.filter(account=voter).count() == 1
    aggregate.refresh_from_db()
    assert aggregate.yes_count == 2
    assert aggregate.first_mapper_id == other.pk
