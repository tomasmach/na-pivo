"""Durable, privacy-minimal account-deletion completion proofs."""

from __future__ import annotations

import hashlib
import uuid

import pytest
from django.contrib.auth.hashers import make_password
from django.db import IntegrityError
from rest_framework import status
from rest_framework.test import APIClient

from pubs import accounts
from pubs.api import views as api_views
from pubs.models import (
    Account,
    AccountDeletionOperation,
    EmailCredential,
    account_deletion_fingerprint,
)


@pytest.fixture
def client() -> APIClient:
    return APIClient()


def _bootstrap(client: APIClient) -> tuple[Account, str]:
    response = client.post(
        "/v1/account",
        data={"device_id": str(uuid.uuid4())},
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED, response.content
    body = response.json()
    return Account.objects.get(public_id=body["id"]), body["token"]


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


@pytest.mark.django_db
@pytest.mark.parametrize("transport", ["body", "query", "idempotency_header", "named_header"])
def test_delete_accepts_uuid4_operation_id_transports_and_status_is_minimal(
    client: APIClient,
    transport: str,
):
    account, token = _bootstrap(client)
    operation_id = uuid.uuid4()

    kwargs: dict = _auth(token)
    url = "/v1/account/me"
    if transport == "body":
        kwargs.update(data={"operation_id": str(operation_id)}, format="json")
    elif transport == "query":
        url = f"{url}?operation_id={operation_id}"
    elif transport == "idempotency_header":
        kwargs["HTTP_IDEMPOTENCY_KEY"] = str(operation_id)
    else:
        kwargs["HTTP_X_ACCOUNT_DELETION_OPERATION_ID"] = str(operation_id)

    response = client.delete(url, **kwargs)

    assert response.status_code == status.HTTP_204_NO_CONTENT, response.content
    proof = AccountDeletionOperation.objects.get(operation_id=operation_id)
    assert proof.account_fingerprint == account_deletion_fingerprint(account.public_id)
    assert proof.account_fingerprint != str(account.public_id)
    assert str(operation_id) not in str(proof)
    account.refresh_from_db()
    assert account.status == Account.Status.PENDING_DELETION

    # A stale/revoked bearer must not turn the public recovery read into a 401.
    check = client.get(
        "/v1/account/deletion-status",
        {"operation_id": str(operation_id)},
        **_auth(token),
    )
    assert check.status_code == status.HTTP_200_OK
    assert check.json() == {"complete": True}


@pytest.mark.django_db
def test_legacy_delete_without_operation_id_stays_compatible(client: APIClient):
    account, token = _bootstrap(client)

    response = client.delete("/v1/account/me", **_auth(token))

    assert response.status_code == status.HTTP_204_NO_CONTENT
    account.refresh_from_db()
    assert account.status == Account.Status.PENDING_DELETION
    assert AccountDeletionOperation.objects.count() == 0


@pytest.mark.django_db
def test_legacy_delete_without_operation_id_ignores_the_new_epoch_guard(
    client: APIClient,
):
    account, legacy_token = _bootstrap(client)
    email = "legacy-deletion-epoch@example.com"
    password = "Tr0ub4dor&3"
    EmailCredential.objects.create(
        account=account,
        email=email,
        password=make_password(password),
        email_verified=True,
    )

    login = client.post(
        "/v1/auth/login",
        data={"email": email, "password": password},
        format="json",
    )
    assert login.status_code == status.HTTP_200_OK, login.content
    account.refresh_from_db()
    assert account.deletion_epoch > 0

    # Released clients neither persist nor send an operation capability. Keep
    # their historical DELETE contract until those app versions age out.
    deleted = client.delete("/v1/account/me", **_auth(legacy_token))
    assert deleted.status_code == status.HTTP_204_NO_CONTENT
    account.refresh_from_db()
    assert account.status == Account.Status.PENDING_DELETION
    assert AccountDeletionOperation.objects.count() == 0


@pytest.mark.django_db
def test_unknown_missing_and_malformed_status_are_indistinguishable(client: APIClient):
    complete_id = uuid.uuid4()
    AccountDeletionOperation.objects.create(
        operation_id=complete_id,
        account_fingerprint=account_deletion_fingerprint(uuid.uuid4()),
    )

    complete = client.get(
        "/v1/account/deletion-status",
        {"operation_id": str(complete_id)},
    )
    unknown = client.get(
        "/v1/account/deletion-status",
        {"operation_id": str(uuid.uuid4())},
    )
    malformed = client.get(
        "/v1/account/deletion-status",
        {"operation_id": "not-a-capability"},
    )
    predictable = client.get(
        "/v1/account/deletion-status",
        {"operation_id": str(uuid.uuid1())},
    )
    missing = client.get("/v1/account/deletion-status")

    assert complete.status_code == status.HTTP_200_OK
    assert complete.json() == {"complete": True}
    for response in (unknown, malformed, predictable, missing):
        assert response.status_code == status.HTTP_200_OK
        assert response.json() == {"complete": False}


@pytest.mark.django_db
def test_invalid_or_conflicting_operation_id_does_not_delete(client: APIClient):
    account, token = _bootstrap(client)

    predictable = client.delete(
        "/v1/account/me",
        data={"operation_id": str(uuid.uuid1())},
        format="json",
        **_auth(token),
    )
    conflicting = client.delete(
        "/v1/account/me",
        data={"operation_id": str(uuid.uuid4())},
        format="json",
        HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
        **_auth(token),
    )

    assert predictable.status_code == status.HTTP_400_BAD_REQUEST
    assert predictable.json()["code"] == "invalid_operation_id"
    assert conflicting.status_code == status.HTTP_400_BAD_REQUEST
    assert conflicting.json()["code"] == "invalid_operation_id"
    account.refresh_from_db()
    assert account.status == Account.Status.ACTIVE
    assert client.get("/v1/account/me", **_auth(token)).status_code == status.HTTP_200_OK
    assert AccountDeletionOperation.objects.count() == 0


@pytest.mark.django_db(transaction=True)
def test_operation_replay_runs_schedule_deletion_once(
    client: APIClient,
    monkeypatch: pytest.MonkeyPatch,
):
    _account, token = _bootstrap(client)
    operation_id = uuid.uuid4()
    calls = 0

    def schedule_once(_account: Account) -> None:
        nonlocal calls
        calls += 1

    monkeypatch.setattr(accounts, "schedule_deletion", schedule_once)

    first = client.delete(
        "/v1/account/me",
        data={"operation_id": str(operation_id)},
        format="json",
        **_auth(token),
    )
    replay = client.delete(
        "/v1/account/me",
        data={"operation_id": str(operation_id)},
        format="json",
        **_auth(token),
    )

    assert first.status_code == status.HTTP_204_NO_CONTENT
    assert replay.status_code == status.HTTP_204_NO_CONTENT
    assert calls == 1
    assert AccountDeletionOperation.objects.filter(operation_id=operation_id).count() == 1


@pytest.mark.django_db
def test_operation_id_reuse_by_another_account_is_rejected_before_deletion(
    client: APIClient,
):
    first_account, first_token = _bootstrap(client)
    second_account, second_token = _bootstrap(client)
    operation_id = uuid.uuid4()

    completed = client.delete(
        "/v1/account/me",
        data={"operation_id": str(operation_id)},
        format="json",
        **_auth(first_token),
    )
    conflict = client.delete(
        "/v1/account/me",
        data={"operation_id": str(operation_id)},
        format="json",
        **_auth(second_token),
    )

    assert completed.status_code == status.HTTP_204_NO_CONTENT
    first_account.refresh_from_db()
    assert first_account.status == Account.Status.PENDING_DELETION
    assert conflict.status_code == status.HTTP_409_CONFLICT
    assert conflict.json()["code"] == "operation_id_reused"
    second_account.refresh_from_db()
    assert second_account.status == Account.Status.ACTIVE
    assert client.get(
        "/v1/account/me", **_auth(second_token)
    ).status_code == status.HTTP_200_OK
    proof = AccountDeletionOperation.objects.get(operation_id=operation_id)
    assert proof.account_fingerprint == account_deletion_fingerprint(first_account.public_id)


@pytest.mark.django_db
def test_concurrent_operation_insert_race_returns_conflict_not_500(
    client: APIClient,
    monkeypatch: pytest.MonkeyPatch,
):
    owner, _owner_token = _bootstrap(client)
    racer, racer_token = _bootstrap(client)
    operation_id = uuid.uuid4()
    # The concurrent winner already committed a proof bound to another account.
    AccountDeletionOperation.objects.create(
        operation_id=operation_id,
        account_fingerprint=account_deletion_fingerprint(owner.public_id),
    )

    def racing_get_or_create(*args: object, **kwargs: object) -> tuple[object, bool]:
        raise IntegrityError("UNIQUE constraint failed on operation_id (simulated race)")

    monkeypatch.setattr(
        AccountDeletionOperation.objects, "get_or_create", racing_get_or_create
    )
    scheduled: list[Account] = []
    monkeypatch.setattr(accounts, "schedule_deletion", lambda a: scheduled.append(a))

    response = client.delete(
        "/v1/account/me",
        data={"operation_id": str(operation_id)},
        format="json",
        **_auth(racer_token),
    )

    assert response.status_code == status.HTTP_409_CONFLICT, response.content
    assert response.json()["code"] == "operation_id_reused"
    assert scheduled == []
    racer.refresh_from_db()
    assert racer.status == Account.Status.ACTIVE
    owner.refresh_from_db()
    assert owner.status == Account.Status.ACTIVE
    assert client.get("/v1/account/me", **_auth(racer_token)).status_code == 200
    proof = AccountDeletionOperation.objects.get(operation_id=operation_id)
    assert proof.account_fingerprint == account_deletion_fingerprint(owner.public_id)
    assert AccountDeletionOperation.objects.filter(operation_id=operation_id).count() == 1


@pytest.mark.django_db(transaction=True)
def test_partial_schedule_failure_rolls_back_and_never_marks_complete(
    client: APIClient,
    monkeypatch: pytest.MonkeyPatch,
):
    account, token = _bootstrap(client)
    operation_id = uuid.uuid4()

    def fail_after_partial_write(target: Account) -> None:
        target.status = Account.Status.PENDING_DELETION
        target.deleted_at = target.created_at
        target.save(update_fields=["status", "deleted_at"])
        # Database/storage exceptions can echo INSERT parameters. Exercise a
        # worst-case message containing the bearer-like recovery capability and
        # prove the view never copies it into production logs.
        raise RuntimeError(f"simulated partial deletion failure for {operation_id}")

    monkeypatch.setattr(accounts, "schedule_deletion", fail_after_partial_write)
    error_calls: list[tuple[tuple[object, ...], dict[str, object]]] = []
    monkeypatch.setattr(
        api_views.logger,
        "error",
        lambda *args, **kwargs: error_calls.append((args, kwargs)),
    )

    response = client.delete(
        "/v1/account/me",
        data={"operation_id": str(operation_id)},
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert error_calls == [
        (("account delete failed (%s)", "RuntimeError"), {}),
    ]
    assert str(operation_id) not in repr(error_calls)
    assert not AccountDeletionOperation.objects.filter(operation_id=operation_id).exists()
    account.refresh_from_db()
    assert account.status == Account.Status.ACTIVE
    assert account.deleted_at is None
    check = client.get(
        "/v1/account/deletion-status",
        {"operation_id": str(operation_id)},
    )
    assert check.json() == {"complete": False}


@pytest.mark.django_db
def test_reactivation_invalidates_old_proof_and_same_operation_can_delete_again(
    client: APIClient,
):
    account, token = _bootstrap(client)
    email = "reactivated-deletion-proof@example.com"
    password = "Tr0ub4dor&3"
    EmailCredential.objects.create(
        account=account,
        email=email,
        password=make_password(password),
        email_verified=True,
    )
    operation_id = uuid.uuid4()
    operation_header = {
        "HTTP_X_ACCOUNT_DELETION_OPERATION_ID": str(operation_id),
    }

    first_delete = client.delete(
        "/v1/account/me",
        **operation_header,
        **_auth(token),
    )
    assert first_delete.status_code == status.HTTP_204_NO_CONTENT
    assert client.get(
        "/v1/account/deletion-status",
        **operation_header,
    ).json() == {"complete": True}

    login = client.post(
        "/v1/auth/login",
        data={"email": email, "password": password},
        format="json",
    )
    assert login.status_code == status.HTTP_200_OK, login.content
    account.refresh_from_db()
    assert account.status == Account.Status.ACTIVE
    assert account.deleted_at is None
    assert client.get(
        "/v1/account/deletion-status",
        **operation_header,
    ).json() == {"complete": False}

    second_delete = client.delete(
        "/v1/account/me",
        **operation_header,
        **_auth(login.json()["token"]),
    )
    assert second_delete.status_code == status.HTTP_204_NO_CONTENT
    account.refresh_from_db()
    assert account.status == Account.Status.PENDING_DELETION
    assert AccountDeletionOperation.objects.filter(operation_id=operation_id).exists()
    assert client.get(
        "/v1/account/deletion-status",
        **operation_header,
    ).json() == {"complete": True}


@pytest.mark.django_db
def test_replay_of_released_v1_legacy_fingerprint_proof_is_accepted(client: APIClient):
    # Released app versions wrote proofs as
    # sha256("na-pivo:account-deletion-operation:v1:<normalized uuid>").
    # That exact legacy digest (not any private helper) must keep replaying.
    account, token = _bootstrap(client)
    operation_id = uuid.uuid4()
    normalized_uuid = str(uuid.UUID(str(account.public_id)))
    AccountDeletionOperation.objects.create(
        operation_id=operation_id,
        account_fingerprint=(
            hashlib.sha256(
                f"na-pivo:account-deletion-operation:v1:{normalized_uuid}".encode()
            ).hexdigest()
        ),
    )

    replay = client.delete(
        "/v1/account/me",
        data={"operation_id": str(operation_id)},
        format="json",
        **_auth(token),
    )

    assert replay.status_code == status.HTTP_204_NO_CONTENT, replay.content
    assert (
        AccountDeletionOperation.objects.filter(operation_id=operation_id).count() == 1
    )


@pytest.mark.django_db
def test_released_v1_legacy_fingerprint_proof_still_conflicts_for_other_account(
    client: APIClient,
):
    owner, _owner_token = _bootstrap(client)
    other, other_token = _bootstrap(client)
    operation_id = uuid.uuid4()
    normalized_uuid = str(uuid.UUID(str(owner.public_id)))
    AccountDeletionOperation.objects.create(
        operation_id=operation_id,
        account_fingerprint=(
            hashlib.sha256(
                f"na-pivo:account-deletion-operation:v1:{normalized_uuid}".encode()
            ).hexdigest()
        ),
    )

    conflict = client.delete(
        "/v1/account/me",
        data={"operation_id": str(operation_id)},
        format="json",
        **_auth(other_token),
    )

    assert conflict.status_code == status.HTTP_409_CONFLICT, conflict.content
    assert conflict.json()["code"] == "operation_id_reused"
    other.refresh_from_db()
    assert other.status == Account.Status.ACTIVE


@pytest.mark.django_db
def test_credential_auth_cancels_delete_authority_of_an_already_issued_token(
    client: APIClient,
):
    account, old_token = _bootstrap(client)
    email = "deletion-epoch@example.com"
    password = "Tr0ub4dor&3"
    EmailCredential.objects.create(
        account=account,
        email=email,
        password=make_password(password),
        email_verified=True,
    )
    operation_id = uuid.uuid4()
    operation_header = {
        "HTTP_X_ACCOUNT_DELETION_OPERATION_ID": str(operation_id),
    }

    # This credential proof advances Account.deletion_epoch before issuing the
    # new token. The older bearer remains otherwise valid, mirroring a DELETE
    # request that authenticated immediately before login and waited on the row
    # lock until immediately afterward.
    login = client.post(
        "/v1/auth/login",
        data={"email": email, "password": password},
        format="json",
    )
    assert login.status_code == status.HTTP_200_OK, login.content

    stale_delete = client.delete(
        "/v1/account/me",
        **operation_header,
        **_auth(old_token),
    )
    assert stale_delete.status_code == status.HTTP_409_CONFLICT
    assert stale_delete.json()["code"] == "deletion_epoch_cancelled"
    account.refresh_from_db()
    assert account.status == Account.Status.ACTIVE
    assert not AccountDeletionOperation.objects.filter(operation_id=operation_id).exists()

    fresh_delete = client.delete(
        "/v1/account/me",
        **operation_header,
        **_auth(login.json()["token"]),
    )
    assert fresh_delete.status_code == status.HTTP_204_NO_CONTENT
    account.refresh_from_db()
    assert account.status == Account.Status.PENDING_DELETION
    assert AccountDeletionOperation.objects.filter(operation_id=operation_id).exists()
