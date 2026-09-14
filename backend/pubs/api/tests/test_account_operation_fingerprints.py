"""Keyed vs legacy fingerprints for deletion/merge operation proofs."""

from __future__ import annotations

import hmac
import re
import uuid

import pytest
from django.db import transaction

from pubs import accounts
from pubs.models import (
    Account,
    AccountDeletionOperation,
    AccountMergeOperation,
    _legacy_account_deletion_fingerprint,
    _legacy_account_merge_fingerprint,
    account_deletion_fingerprint,
    account_deletion_fingerprint_candidates,
    account_deletion_fingerprint_matches,
    account_merge_fingerprint,
    account_merge_fingerprint_matches,
)

HEX64 = re.compile(r"^[0-9a-f]{64}$")


def _account() -> Account:
    return Account.objects.create(device_id=str(uuid.uuid4()))


def test_new_fingerprint_differs_from_legacy_format():
    public_id = uuid.uuid4()

    assert account_deletion_fingerprint(public_id) != _legacy_account_deletion_fingerprint(public_id)
    assert account_merge_fingerprint(public_id) != _legacy_account_merge_fingerprint(public_id)


def test_new_fingerprints_are_stable_on_repeat():
    public_id = uuid.uuid4()

    assert account_deletion_fingerprint(public_id) == account_deletion_fingerprint(public_id)
    assert account_merge_fingerprint(public_id) == account_merge_fingerprint(public_id)


def test_deletion_and_merge_domains_are_separated():
    public_id = uuid.uuid4()

    assert account_deletion_fingerprint(public_id) != account_merge_fingerprint(public_id)


@pytest.mark.parametrize(
    "fingerprint",
    [
        lambda pid: account_deletion_fingerprint(pid),
        lambda pid: account_merge_fingerprint(pid),
        lambda pid: _legacy_account_deletion_fingerprint(pid),
        lambda pid: _legacy_account_merge_fingerprint(pid),
    ],
)
def test_all_formats_are_lowercase_64_hex(fingerprint):
    assert HEX64.match(fingerprint(uuid.uuid4()))


def test_invalid_uuid_fails_safely():
    with pytest.raises(ValueError):
        account_deletion_fingerprint("not-a-uuid")
    with pytest.raises(ValueError):
        account_merge_fingerprint("not-a-uuid")

    assert not account_deletion_fingerprint_matches("x", "not-a-uuid")
    assert not account_merge_fingerprint_matches("x", "not-a-uuid")
    assert account_deletion_fingerprint_candidates("not-a-uuid") == []


@pytest.mark.parametrize("match_legacy", [False, True])
def test_both_candidates_always_reach_compare_digest(match_legacy, monkeypatch):
    public_id = uuid.uuid4()
    stored = (
        _legacy_account_deletion_fingerprint(public_id)
        if match_legacy
        else account_deletion_fingerprint(public_id)
    )
    calls: list[bytes] = []
    real_compare_digest = hmac.compare_digest

    def spy(a, b):
        calls.append(b if isinstance(b, bytes) else bytes(b))
        return real_compare_digest(a, b)

    monkeypatch.setattr(hmac, "compare_digest", spy)

    assert account_deletion_fingerprint_matches(stored, public_id) is True
    assert len(calls) == 2
    assert calls == [
        account_deletion_fingerprint(public_id).encode(),
        _legacy_account_deletion_fingerprint(public_id).encode(),
    ]


@pytest.mark.django_db
def test_legacy_merge_operation_validation_and_replay_stay_accepted():
    source_public_id = uuid.uuid4()
    target_public_id = uuid.uuid4()
    operation = AccountMergeOperation.objects.create(
        operation_id=uuid.uuid4(),
        source_account_fingerprint=_legacy_account_merge_fingerprint(source_public_id),
        target_account_fingerprint=_legacy_account_merge_fingerprint(target_public_id),
    )

    accounts._validate_account_merge_operation(
        operation,
        source_public_id=source_public_id,
        target_public_id=target_public_id,
    )

    # Replay after deployment writes keyed fingerprints for a fresh operation id.
    replayed = AccountMergeOperation.objects.create(
        operation_id=uuid.uuid4(),
        source_account_fingerprint=account_merge_fingerprint(source_public_id),
        target_account_fingerprint=account_merge_fingerprint(target_public_id),
    )
    accounts._validate_account_merge_operation(
        replayed,
        source_public_id=source_public_id,
        target_public_id=target_public_id,
    )


@pytest.mark.django_db
def test_legacy_merge_operation_mismatch_is_rejected():
    operation = AccountMergeOperation.objects.create(
        operation_id=uuid.uuid4(),
        source_account_fingerprint=_legacy_account_merge_fingerprint(uuid.uuid4()),
        target_account_fingerprint=_legacy_account_merge_fingerprint(uuid.uuid4()),
    )

    with pytest.raises(accounts.AccountError):
        accounts._validate_account_merge_operation(
            operation,
            source_public_id=None,
            target_public_id=uuid.uuid4(),
        )


@pytest.mark.django_db
def test_cancel_deletion_deletes_legacy_and_keyed_proofs_but_not_unrelated():
    account = _account()
    unrelated_proof = AccountDeletionOperation.objects.create(
        operation_id=uuid.uuid4(),
        account_fingerprint=_legacy_account_deletion_fingerprint(uuid.uuid4()),
    )
    AccountDeletionOperation.objects.create(
        operation_id=uuid.uuid4(),
        account_fingerprint=_legacy_account_deletion_fingerprint(account.public_id),
    )
    AccountDeletionOperation.objects.create(
        operation_id=uuid.uuid4(),
        account_fingerprint=account_deletion_fingerprint(account.public_id),
    )

    with transaction.atomic():
        assert accounts.cancel_deletion(account) is False

    remaining = list(AccountDeletionOperation.objects.all())
    assert remaining == [unrelated_proof]
