"""
Unit tests for the community quorum-trust domain module (pubs.community_trust).

Phase A contract under test:

- ``Account.quorum_trusted_at`` is a nullable timestamp.
- ``QUORUM_TRUST_AGE`` is exactly 24 hours.
- ``mark_quorum_trusted(account_id, proven_at=None)`` sets the timestamp once
  and NEVER advances it on later calls.
- ``trusted_account_q(prefix, now)`` and ``is_quorum_trusted(...)`` require an
  ACTIVE account whose trust is at least QUORUM_TRUST_AGE old — exactly 24h
  minus one second is NOT trusted, exactly 24h IS.
- No proof path (claimed account, unverified email, plain login) implies trust
  by itself: a fresh account has ``quorum_trusted_at IS NULL``.

These are RED tests: the module and the model field do not exist yet. Time is
passed explicitly (or frozen via monkeypatching django.utils.timezone.now) so
no new dependency is needed.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone as dj_timezone

import pubs.community_trust as community_trust
from pubs.models import Account, EmailCredential

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_account(**overrides) -> Account:
    defaults = {"device_id": f"trust-unit-{Account.objects.count() + 1}"}
    defaults.update(overrides)
    return Account.objects.create(**defaults)


# ---------------------------------------------------------------------------
# Model shape
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_account_has_nullable_quorum_trusted_at_defaulting_to_none():
    field = Account._meta.get_field("quorum_trusted_at")
    assert field.null is True

    account = _make_account()
    assert account.quorum_trusted_at is None


# ---------------------------------------------------------------------------
# mark_quorum_trusted
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_mark_quorum_trusted_sets_proven_time_once_and_never_advances():
    account = _make_account()
    first_proof = dj_timezone.now() - timedelta(hours=30)

    community_trust.mark_quorum_trusted(account.pk, proven_at=first_proof)
    account.refresh_from_db()
    assert account.quorum_trusted_at == first_proof

    # A later proof attempt must never advance the original stamp.
    later_proof = dj_timezone.now()
    community_trust.mark_quorum_trusted(account.pk, proven_at=later_proof)
    account.refresh_from_db()
    assert account.quorum_trusted_at == first_proof


@pytest.mark.django_db
def test_mark_quorum_trusted_defaults_to_now(monkeypatch):
    moment = dj_timezone.now()
    monkeypatch.setattr(dj_timezone, "now", lambda: moment)

    account = _make_account()
    community_trust.mark_quorum_trusted(account.pk)
    account.refresh_from_db()
    assert account.quorum_trusted_at == moment


@pytest.mark.django_db
def test_is_quorum_trusted_uses_passed_instance_with_zero_queries(
    django_assert_num_queries,
):
    """``is_quorum_trusted`` reads only the instance it was handed — it must
    never touch the database, even at the exact 24h boundary."""
    now = dj_timezone.now()
    account = _make_account()
    community_trust.mark_quorum_trusted(
        account.pk, proven_at=now - timedelta(hours=24)
    )
    account.refresh_from_db()

    with django_assert_num_queries(0):
        assert community_trust.is_quorum_trusted(account, now=now) is True
        assert community_trust.is_quorum_trusted(None, now=now) is False


# ---------------------------------------------------------------------------
# The 24h boundary — exact seconds matter
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_is_quorum_trusted_false_one_second_before_24h():
    now = dj_timezone.now()
    account = _make_account()
    community_trust.mark_quorum_trusted(account.pk, proven_at=now - timedelta(hours=24))
    account.refresh_from_db()

    assert community_trust.is_quorum_trusted(
        account, now=now - timedelta(seconds=1)
    ) is False


@pytest.mark.django_db
def test_is_quorum_trusted_true_exactly_at_24h():
    now = dj_timezone.now()
    account = _make_account()
    community_trust.mark_quorum_trusted(account.pk, proven_at=now - timedelta(hours=24))
    account.refresh_from_db()

    assert community_trust.is_quorum_trusted(account, now=now) is True


@pytest.mark.django_db
def test_is_quorum_trusted_false_for_inactive_account_even_past_24h():
    now = dj_timezone.now()
    account = _make_account(status=Account.Status.PENDING_DELETION)
    community_trust.mark_quorum_trusted(
        account.pk, proven_at=now - timedelta(hours=48)
    )

    assert community_trust.is_quorum_trusted(account, now=now) is False


@pytest.mark.django_db
def test_is_quorum_trusted_false_without_any_stamp():
    now = dj_timezone.now()
    account = _make_account()
    assert community_trust.is_quorum_trusted(account, now=now) is False


# ---------------------------------------------------------------------------
# trusted_account_q
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_trusted_account_q_filters_on_age_and_active_status():
    now = dj_timezone.now()
    ripe = _make_account(device_id="q-ripe")
    community_trust.mark_quorum_trusted(
        ripe.pk, proven_at=now - timedelta(hours=24)
    )
    too_fresh = _make_account(device_id="q-fresh")
    community_trust.mark_quorum_trusted(
        too_fresh.pk, proven_at=now - timedelta(hours=24) + timedelta(seconds=1)
    )
    stale_but_inactive = _make_account(
        device_id="q-inactive", status=Account.Status.PENDING_DELETION
    )
    community_trust.mark_quorum_trusted(
        stale_but_inactive.pk, proven_at=now - timedelta(hours=48)
    )
    _make_account(device_id="q-unstamped")

    matched = set(Account.objects.filter(community_trust.trusted_account_q("", now)))
    assert matched == {ripe}


@pytest.mark.django_db
def test_trusted_account_q_supports_relation_prefix():
    now = dj_timezone.now()
    trusted = _make_account(device_id="q-prefix-trusted")
    community_trust.mark_quorum_trusted(
        trusted.pk, proven_at=now - timedelta(hours=24)
    )
    untrusted = _make_account(device_id="q-prefix-other")
    EmailCredential.objects.create(
        account=untrusted,
        email="q-prefix@x.cz",
        email_verified=True,
    )

    joined = EmailCredential.objects.filter(
        community_trust.trusted_account_q("account__", now)
    )
    assert list(joined) == []
