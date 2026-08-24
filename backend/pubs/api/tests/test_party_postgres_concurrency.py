from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.contrib.auth.hashers import make_password
from django.db import close_old_connections, connection, connections
from rest_framework import status
from rest_framework.test import APIClient

from pubs import accounts
from pubs.accounts import issue_token
from pubs.models import Account, EmailCredential, PartyEvening, PartyEveningMember


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


@pytest.mark.django_db(transaction=True)
def test_login_merge_and_party_join_do_not_deadlock_on_postgres(monkeypatch):
    """Exercise the real Account -> PartyEvening lock order on PostgreSQL.

    The merge pauses after locking source+target accounts. A concurrent join
    then reaches its Account lock. With the old Evening -> Account join order,
    this creates a real database deadlock as soon as the merge continues. With
    the shared Account -> Evening order, the join waits, rejects its stale host,
    and succeeds when retried against the merged host.
    """

    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL row locks are required for this regression test")

    password = "Tr0ub4dor&3"
    source = Account.objects.create(device_id=f"pg-source-{uuid.uuid4().hex}")
    target = Account.objects.create(device_id=f"pg-target-{uuid.uuid4().hex}")
    joiner = Account.objects.create(device_id=f"pg-joiner-{uuid.uuid4().hex}")
    EmailCredential.objects.create(
        account=target,
        email="party-lock-order@example.test",
        password=make_password(password),
        email_verified=True,
    )
    source_token = issue_token(source)
    joiner_token = issue_token(joiner)
    evening = PartyEvening.objects.create(
        host=source,
        client_id=uuid.uuid4(),
        join_code="PGLOCK30",
        pub_name="U PostgreSQLu",
    )
    PartyEveningMember.objects.create(evening=evening, account=source)

    merge_holds_accounts = threading.Event()
    allow_merge_to_touch_evening = threading.Event()
    join_requested_account_lock = threading.Event()
    real_merge_party_evenings = accounts._merge_party_evenings
    real_account_select_for_update = Account.objects.select_for_update

    def pause_merge_after_account_locks(source_account, target_account):
        merge_holds_accounts.set()
        if not allow_merge_to_touch_evening.wait(timeout=10):
            raise AssertionError("join never reached its Account lock")
        return real_merge_party_evenings(source_account, target_account)

    def observe_account_lock(*args, **kwargs):
        if threading.current_thread().name == "party-join":
            join_requested_account_lock.set()
        return real_account_select_for_update(*args, **kwargs)

    monkeypatch.setattr(accounts, "_merge_party_evenings", pause_merge_after_account_locks)
    monkeypatch.setattr(Account.objects, "select_for_update", observe_account_lock)

    def login_and_merge() -> tuple[int, dict]:
        close_old_connections()
        try:
            response = APIClient().post(
                "/v1/auth/login",
                data={
                    "email": "party-lock-order@example.test",
                    "password": password,
                },
                format="json",
                **_auth(source_token),
            )
            return response.status_code, response.json()
        finally:
            connections.close_all()

    def join_stale_host() -> tuple[int, dict]:
        close_old_connections()
        try:
            response = APIClient().post(
                "/v1/party-evenings/PGLOCK30/join",
                **_auth(joiner_token),
            )
            return response.status_code, response.json()
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="party-lock") as executor:
        merge_future = executor.submit(login_and_merge)
        assert merge_holds_accounts.wait(timeout=10)
        # ThreadPoolExecutor's generated name is not stable enough for the
        # observer above, so rename only this worker while it runs.
        def named_join():
            threading.current_thread().name = "party-join"
            return join_stale_host()

        join_future = executor.submit(named_join)
        assert join_requested_account_lock.wait(timeout=10)
        allow_merge_to_touch_evening.set()
        merge_status, merge_payload = merge_future.result(timeout=15)
        join_status, join_payload = join_future.result(timeout=15)

    assert merge_status == status.HTTP_200_OK, merge_payload
    assert merge_payload["id"] == str(target.public_id)
    assert join_status == status.HTTP_404_NOT_FOUND
    assert join_payload["code"] == "party_not_found"
    evening.refresh_from_db()
    assert evening.host_id == target.pk

    retried = APIClient().post(
        "/v1/party-evenings/PGLOCK30/join",
        **_auth(joiner_token),
    )
    assert retried.status_code == status.HTTP_200_OK, retried.content
