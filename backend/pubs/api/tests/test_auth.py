"""
Tests for the user-accounts auth layer (pubs.api.auth_views + pubs.accounts).

These exercise the credential / social / linking / reset / verification / deletion
flows end-to-end through the DRF endpoints under /v1/auth and DELETE /v1/account/me.

OAuth is mocked at the ``pubs.oauth`` module boundary (the service layer calls
``oauth.verify_google_id_token`` etc. by attribute lookup at call time, so patching
the module attribute is sufficient — no real network). Test ID tokens encode the
asserted identity as a string ``"google:SUB:email"`` / ``"apple:SUB:email"`` so a
test can drive any (sub, email) it wants. Transactional emails are mocked at the
``pubs.emailer`` boundary to capture the raw one-time-token codes and to assert
sends happen.

The auth endpoints are scope-throttled (``auth`` 20/min, ``auth_email`` 5/min) on a
shared per-IP counter stored in the Django cache, so an autouse fixture clears the
cache around every test (same pattern as test_account.py). Individual tests keep
``auth_email`` calls under 5.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

import pubs.accounts as accounts
import pubs.emailer as emailer
import pubs.oauth as oauth
from pubs.accounts import _delete_or_move_account_rows
from pubs.beer_photo_deletions import retry_beer_photo_file_deletion
from pubs.models import (
    Account,
    AccountMergeOperation,
    AuthIdentity,
    AuthToken,
    BeerCheckIn,
    BeerCheckInReaction,
    BeerPhoto,
    BeerPhotoDeletionTombstone,
    BeerPhotoFileDeletion,
    DrinkLog,
    EmailCredential,
    FeedbackReport,
    Follow,
    OneTimeToken,
    PartyEvening,
    PartyEveningDrink,
    PartyEveningMember,
    PartyGame,
    PartyGameEvent,
    PhotoContest,
    PhotoContestEntry,
    PhotoContestVote,
    PubAmenity,
    PubAmenityVote,
    PublishedNight,
    PublishedNightComment,
    PubVisit,
    PushDevice,
    account_merge_fingerprint,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    # The auth endpoints are ScopedRateThrottle'd ("auth" 20/min, "auth_email"
    # 5/min) on a shared per-IP (127.0.0.1) counter stored in the default cache.
    # Clear it around every test so the counter never bleeds across tests.
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def tmp_media(tmp_path, settings):
    media_root = tmp_path / "media"
    media_root.mkdir()
    settings.MEDIA_ROOT = str(media_root)
    return media_root


@pytest.fixture
def fake_oauth(monkeypatch):
    """Patch the OAuth provider verifiers + Apple code-exchange / revoke.

    The verifiers parse a test token of the form ``"<provider>:<sub>:<email>"``.
    ``exchange_apple_auth_code`` is stubbed to a fixed refresh token. Apple revoke
    records every revoked token so tests can assert revocation happened on
    unlink / deletion.
    """
    revoked: list[str] = []

    def fake_google(token: str) -> dict:
        _, sub, email = token.split(":")
        return {"sub": sub, "email": email, "email_verified": True}

    def fake_apple(token: str) -> dict:
        _, sub, email = token.split(":")
        return {"sub": sub, "email": email, "email_verified": True}

    def fake_exchange(code: str) -> dict:
        return {"refresh_token": "rt_test"}

    def fake_revoke(token: str, token_type_hint: str = "refresh_token") -> None:
        revoked.append(token)

    monkeypatch.setattr(oauth, "verify_google_id_token", fake_google)
    monkeypatch.setattr(oauth, "verify_apple_identity_token", fake_apple)
    monkeypatch.setattr(oauth, "exchange_apple_auth_code", fake_exchange)
    monkeypatch.setattr(oauth, "revoke_apple_token", fake_revoke)
    return {"revoked": revoked}


@pytest.fixture
def sent_emails(monkeypatch):
    """Capture transactional emails (which are otherwise a dev no-op).

    Records one dict per send with the function tag + kwargs so tests can pull
    the raw one-time-token ``code`` out of verification / reset emails.
    """
    sent: list[dict] = []

    def make_recorder(tag: str):
        def recorder(to, **kwargs):
            sent.append({"tag": tag, "to": to, **kwargs})
            return True

        return recorder

    monkeypatch.setattr(emailer, "send_verification_email", make_recorder("verify"))
    monkeypatch.setattr(emailer, "send_password_reset_email", make_recorder("reset"))
    monkeypatch.setattr(
        emailer, "send_account_deletion_scheduled_email", make_recorder("deletion_scheduled")
    )
    monkeypatch.setattr(emailer, "send_account_deleted_email", make_recorder("deleted"))
    return sent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _bootstrap_anon(client) -> tuple[str, str]:
    """Create an anonymous device account; return (raw_token, account_public_id)."""
    resp = client.post(
        "/v1/account", data={"device_id": str(uuid.uuid4())}, format="json"
    )
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()
    return body["token"], body["id"]


def _auth(token: str) -> dict:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _register(client, email: str, password: str = "Tr0ub4dor&3", *, token: str | None = None):
    """POST /v1/auth/register, optionally claiming the anon account behind ``token``."""
    extra = _auth(token) if token else {}
    return client.post(
        "/v1/auth/register",
        data={"email": email, "password": password},
        format="json",
        **extra,
    )


def _register_and_token(client, email: str, password: str = "Tr0ub4dor&3") -> tuple[APIClient, str]:
    """Register a fresh email account; return (client, working session token)."""
    resp = _register(client, email, password)
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    return client, resp.json()["token"]


def _merge_body(operation_id: uuid.UUID, **values) -> dict:
    return {**values, "merge_operation_id": str(operation_id)}


def _verify_code(sent_emails, tag: str) -> str:
    """Pull the raw one-time token out of the most recent captured email."""
    for record in reversed(sent_emails):
        if record["tag"] == tag:
            return record["code"]
    raise AssertionError(f"no {tag} email captured in {sent_emails!r}")


def _email_record(sent_emails, tag: str) -> dict:
    """Pull the most recent captured email record for a tag."""
    for record in reversed(sent_emails):
        if record["tag"] == tag:
            return record
    raise AssertionError(f"no {tag} email captured in {sent_emails!r}")


def _seed_amenity_vote(account: Account) -> PubAmenity:
    cache_key = "u2fkbnhz"
    pub_identity_key = f"{cache_key}::u vystreleneho oka"
    PubAmenityVote.objects.create(
        account=account,
        cache_key=cache_key,
        pub_identity_key=pub_identity_key,
        amenity_key="seating_garden",
        name="U Vystřelenýho oka",
        lat=50.08,
        lng=14.45,
        value=PubAmenityVote.Value.YES,
        client_updated_at=timezone.now(),
    )
    return PubAmenity.objects.create(
        cache_key=cache_key,
        pub_identity_key=pub_identity_key,
        amenity_key="seating_garden",
        name="U Vystřelenýho oka",
        lat=50.08,
        lng=14.45,
        yes_count=1,
        distinct_voter_count=1,
        first_mapper=account,
    )


def _published_night(
    account: Account,
    *,
    client_id: str,
    drinking_day,
    participant_ids: list[str] | None = None,
    photo_ids: list[str] | None = None,
    game_ids: list[str] | None = None,
) -> PublishedNight:
    now = timezone.now()
    return PublishedNight.objects.create(
        account=account,
        client_id=client_id,
        drinking_day=drinking_day,
        started_at=now,
        ended_at=now,
        beer_count=2,
        wine_count=0,
        soft_drink_count=0,
        shot_count=0,
        participant_ids=participant_ids or [],
        photo_ids=photo_ids or [],
        game_ids=game_ids or [],
        visibility=PublishedNight.Visibility.PUBLIC,
        updated_at=now,
    )


# ===========================================================================
# 1. Register (email + password) — claims the anon account
# ===========================================================================


@pytest.mark.django_db
def test_register_claims_anonymous_account_and_preserves_data(client, sent_emails):
    token, anon_id = _bootstrap_anon(client)
    # Seed data on the anonymous account so we can prove it survives the claim.
    account = Account.objects.get(public_id=anon_id)
    drink = DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbnhz",
        name="U Vystřelenýho oka",
        lat=50.08,
        lng=14.45,
        beer_name="Plzeň",
        price_czk=55,
        drank_at="2026-06-01T18:00:00Z",
    )

    resp = _register(client, "claim@x.cz", token=token)

    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()
    assert body["created"] is True
    assert body["token"]
    # Same logical account: the credential attached to the existing row.
    assert body["id"] == anon_id
    assert Account.objects.count() == 1
    # The drink still belongs to the (now claimed) account.
    drink.refresh_from_db()
    assert drink.account_id == account.id


@pytest.mark.django_db
def test_register_returns_working_token_with_email_provider(client, sent_emails):
    token, _ = _bootstrap_anon(client)
    resp = _register(client, "me@x.cz", token=token)
    session = resp.json()["token"]

    me = client.get("/v1/account/me", **_auth(session))
    assert me.status_code == status.HTTP_200_OK
    body = me.json()
    assert body["is_anonymous"] is False
    assert body["providers"] == ["email"]
    assert body["email"] == "me@x.cz"


@pytest.mark.django_db
def test_register_without_bearer_creates_fresh_account(client, sent_emails):
    resp = _register(client, "nobearer@x.cz")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    assert resp.json()["created"] is True
    assert EmailCredential.objects.filter(email="nobearer@x.cz").exists()


@pytest.mark.django_db
def test_register_ignores_invalid_optional_bearer(client, sent_emails):
    resp = _register(client, "stale-bearer@x.cz", token="stale-token")

    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()
    assert body["created"] is True
    assert body["token"]
    assert EmailCredential.objects.filter(email="stale-bearer@x.cz").exists()


@pytest.mark.django_db
def test_register_duplicate_email_returns_409_email_taken(client, sent_emails):
    _register(client, "dup@x.cz")
    resp = _register(APIClient(), "dup@x.cz")
    assert resp.status_code == status.HTTP_409_CONFLICT
    assert resp.json()["code"] == "email_taken"


@pytest.mark.django_db
def test_register_weak_password_returns_400(client):
    # "123" is too short, all-numeric, and a common password.
    resp = client.post(
        "/v1/auth/register",
        data={"email": "weak@x.cz", "password": "123"},
        format="json",
    )
    # The serializer enforces min_length=8 (400) before the service-layer
    # weak_password check; either way it is a 400 rejection.
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert not EmailCredential.objects.filter(email="weak@x.cz").exists()


@pytest.mark.django_db
def test_register_weak_password_passes_serializer_but_fails_validator(client, sent_emails):
    # 8+ chars (clears the serializer) but all-numeric + common → weak_password.
    resp = client.post(
        "/v1/auth/register",
        data={"email": "weak2@x.cz", "password": "12345678"},
        format="json",
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "weak_password"


@pytest.mark.django_db
def test_register_when_account_already_has_password_returns_409(client, sent_emails):
    _, token = _register_and_token(client, "first@x.cz")
    # Re-register on the SAME (now claimed) account.
    resp = _register(client, "second@x.cz", token=token)
    assert resp.status_code == status.HTTP_409_CONFLICT
    assert resp.json()["code"] == "already_has_password"


# ===========================================================================
# 2. Login (email + password)
# ===========================================================================


@pytest.mark.django_db
def test_login_correct_credentials_returns_working_token(client, sent_emails):
    _register(client, "login@x.cz", "Tr0ub4dor&3")

    resp = client.post(
        "/v1/auth/login",
        data={"email": "login@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    session = resp.json()["token"]
    me = client.get("/v1/account/me", **_auth(session))
    assert me.status_code == status.HTTP_200_OK
    assert me.json()["providers"] == ["email"]


@pytest.mark.django_db
def test_login_with_anonymous_bearer_merges_progress_into_existing_account(
    client, sent_emails
):
    _register(client, "merge-login@x.cz", "Tr0ub4dor&3")
    target = EmailCredential.objects.get(email="merge-login@x.cz").account

    anon_token, anon_id = _bootstrap_anon(client)
    anon = Account.objects.get(public_id=anon_id)
    drink = DrinkLog.objects.create(
        account=anon,
        client_id=uuid.uuid4(),
        cache_key="u2fkbnhz",
        name="U Vystřelenýho oka",
        lat=50.08,
        lng=14.45,
        beer_name="Plzeň",
        price_czk=55,
        drank_at="2026-06-01T18:00:00Z",
    )
    push_device = PushDevice.objects.create(
        account=anon,
        push_token="ExponentPushToken[mergeLogin]",
        platform=PushDevice.Platform.IOS,
        permission_status=PushDevice.PermissionStatus.GRANTED,
        enabled=True,
    )

    resp = client.post(
        "/v1/auth/login",
        data={"email": "merge-login@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
        **_auth(anon_token),
    )

    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["id"] == str(target.public_id)
    assert Account.objects.count() == 1
    drink.refresh_from_db()
    assert drink.account_id == target.id
    push_device.refresh_from_db()
    assert push_device.account_id == target.id


@pytest.mark.django_db
def test_login_merge_preserves_three_zero_owner_rows_and_party_tree(client, sent_emails):
    _register(client, "merge-owner-data@x.cz", "Tr0ub4dor&3")
    target = EmailCredential.objects.get(email="merge-owner-data@x.cz").account
    anon_token, anon_id = _bootstrap_anon(client)
    source = Account.objects.get(public_id=anon_id)

    checkin = BeerCheckIn.objects.create(
        account=source,
        client_id=uuid.uuid4(),
        beer_name="Plzeň",
        beer_key="plzen",
    )
    evening = PartyEvening.objects.create(
        host=source,
        client_id=uuid.uuid4(),
        join_code="MERGE301",
        pub_name="U Tří růží",
    )
    membership = PartyEveningMember.objects.create(
        evening=evening,
        account=source,
    )
    shared_drink = PartyEveningDrink.objects.create(
        evening=evening,
        account=source,
        client_id=uuid.uuid4(),
        beer_name="Ležák",
    )
    game = PartyGame.objects.create(
        evening=evening,
        started_by=source,
        client_id=uuid.uuid4(),
        catalog_key="dice-duel",
        name="Kostky",
        roster_account_ids=[str(source.public_id)],
    )
    game_event = PartyGameEvent.objects.create(
        game=game,
        account=source,
        subject=source,
        client_id=uuid.uuid4(),
        kind=PartyGameEvent.Kind.SCORE,
        delta=1,
    )
    photo = BeerPhoto.objects.create(
        account=source,
        party_evening=evening,
        client_id=uuid.uuid4(),
        image=f"beer-photos/{source.public_id}/merge-owner.webp",
    )
    night = _published_night(
        target,
        client_id="target-night-for-comment",
        drinking_day=timezone.localdate(),
    )
    comment = PublishedNightComment.objects.create(
        account=source,
        night=night,
        client_id=uuid.uuid4(),
        body="Tohle si pamatuju.",
    )

    response = client.post(
        "/v1/auth/login",
        data={"email": "merge-owner-data@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
        **_auth(anon_token),
    )

    assert response.status_code == status.HTTP_200_OK, response.content
    assert not Account.objects.filter(pk=source.pk).exists()
    for row in (checkin, membership, shared_drink, photo, comment):
        row.refresh_from_db()
        assert row.account_id == target.pk
    evening.refresh_from_db()
    game.refresh_from_db()
    game_event.refresh_from_db()
    assert evening.host_id == target.pk
    assert game.evening_id == evening.pk
    assert game.started_by_id == target.pk
    assert game.roster_account_ids == [str(target.public_id)]
    assert game_event.account_id == target.pk
    assert game_event.subject_id == target.pk
    assert photo.party_evening_id == evening.pk


@pytest.mark.django_db
def test_login_merge_deduplicates_three_zero_parents_without_losing_children(client, sent_emails):
    _register(client, "merge-conflicts@x.cz", "Tr0ub4dor&3")
    target = EmailCredential.objects.get(email="merge-conflicts@x.cz").account
    anon_token, anon_id = _bootstrap_anon(client)
    source = Account.objects.get(public_id=anon_id)
    reactor_a = Account.objects.create(device_id="merge-reactor-a")
    reactor_b = Account.objects.create(device_id="merge-reactor-b")

    checkin_client_id = uuid.uuid4()
    target_checkin = BeerCheckIn.objects.create(
        account=target,
        client_id=checkin_client_id,
        beer_name="Cílové pivo",
        beer_key="cilove-pivo",
    )
    source_checkin = BeerCheckIn.objects.create(
        account=source,
        client_id=checkin_client_id,
        beer_name="Duplicitní pivo",
        beer_key="duplicitni-pivo",
    )
    BeerCheckInReaction.objects.create(checkin=target_checkin, account=reactor_a)
    BeerCheckInReaction.objects.create(checkin=source_checkin, account=reactor_a)
    BeerCheckInReaction.objects.create(checkin=source_checkin, account=reactor_b)

    evening_client_id = uuid.uuid4()
    target_evening = PartyEvening.objects.create(
        host=target,
        client_id=evening_client_id,
        join_code="TARGET30",
        pub_name="Cílová hospoda",
    )
    source_evening = PartyEvening.objects.create(
        host=source,
        client_id=evening_client_id,
        join_code="SOURCE30",
        pub_name="Duplicitní hospoda",
    )
    target_membership = PartyEveningMember.objects.create(
        evening=target_evening,
        account=target,
        active=False,
        left_at=timezone.now(),
    )
    PartyEveningMember.objects.create(evening=source_evening, account=source)
    source_drink = PartyEveningDrink.objects.create(
        evening=source_evening,
        account=source,
        client_id=uuid.uuid4(),
        beer_name="Zdrojový ležák",
    )

    game_client_id = uuid.uuid4()
    target_game = PartyGame.objects.create(
        evening=target_evening,
        started_by=target,
        client_id=game_client_id,
        catalog_key="dice-duel",
        name="Kostky",
        roster_account_ids=[str(target.public_id)],
        ended_at=timezone.now(),
    )
    source_game = PartyGame.objects.create(
        evening=source_evening,
        started_by=source,
        client_id=game_client_id,
        catalog_key="dice-duel",
        name="Kostky retry",
        roster_account_ids=[str(source.public_id), str(target.public_id)],
        ended_at=timezone.now(),
    )
    target_event = PartyGameEvent.objects.create(
        game=target_game,
        account=target,
        client_id=uuid.uuid4(),
        kind=PartyGameEvent.Kind.SCORE,
        delta=1,
    )
    source_event = PartyGameEvent.objects.create(
        game=source_game,
        account=source,
        subject=source,
        client_id=uuid.uuid4(),
        kind=PartyGameEvent.Kind.SCORE,
        delta=2,
    )

    # Two phones may have started the same catalogue game with different
    # client UUIDs before the anonymous evening is claimed. The genuinely
    # first row (here the source row) is canonical, including its frozen lobby.
    first_started_at = timezone.now() - timedelta(hours=1)
    first_catalog_game = PartyGame.objects.create(
        evening=source_evening,
        started_by=source,
        client_id=uuid.uuid4(),
        catalog_key="quiz",
        name="První kvíz",
        roster_account_ids=[str(source.public_id), str(reactor_a.public_id)],
        started_at=first_started_at,
    )
    later_catalog_game = PartyGame.objects.create(
        evening=target_evening,
        started_by=target,
        client_id=uuid.uuid4(),
        catalog_key="quiz",
        name="Pozdější kvíz",
        roster_account_ids=[str(target.public_id), str(reactor_b.public_id)],
        started_at=first_started_at + timedelta(minutes=5),
    )
    duplicate_event_client_id = uuid.uuid4()
    canonical_quiz_event = PartyGameEvent.objects.create(
        game=first_catalog_game,
        account=source,
        client_id=duplicate_event_client_id,
        kind=PartyGameEvent.Kind.ANSWER,
        payload={"questionId": "q1", "option": 0},
    )
    PartyGameEvent.objects.create(
        game=later_catalog_game,
        account=target,
        client_id=duplicate_event_client_id,
        kind=PartyGameEvent.Kind.ANSWER,
        payload={"questionId": "q1", "option": 1},
    )
    moved_quiz_event = PartyGameEvent.objects.create(
        game=later_catalog_game,
        account=target,
        client_id=uuid.uuid4(),
        kind=PartyGameEvent.Kind.SCORE,
        subject=target,
        delta=1,
    )

    photo_client_id = uuid.uuid4()
    target_photo = BeerPhoto.objects.create(
        account=target,
        client_id=photo_client_id,
        image=f"beer-photos/{target.public_id}/target.webp",
    )
    source_photo = BeerPhoto.objects.create(
        account=source,
        party_evening=source_evening,
        client_id=photo_client_id,
        image=f"beer-photos/{source.public_id}/source.webp",
        caption="Fotka od stolu",
    )
    now = timezone.now()
    contest = PhotoContest.objects.create(
        period_start=now - timedelta(days=1),
        period_end=now + timedelta(days=1),
    )
    target_entry = PhotoContestEntry.objects.create(
        contest=contest,
        photo=target_photo,
        account=target,
    )
    source_entry = PhotoContestEntry.objects.create(
        contest=contest,
        photo=source_photo,
        account=source,
    )
    source_entry_vote = PhotoContestVote.objects.create(
        contest=contest,
        entry=source_entry,
        voter=reactor_b,
    )

    drinking_day = timezone.localdate()
    target_night = _published_night(
        target,
        client_id="target-night",
        drinking_day=drinking_day,
        participant_ids=[str(target.public_id)],
        photo_ids=[str(target_photo.public_id)],
        game_ids=[str(target_game.public_id)],
    )
    source_night = _published_night(
        source,
        client_id="source-night",
        drinking_day=drinking_day,
        participant_ids=[str(source.public_id)],
        photo_ids=[str(source_photo.public_id)],
        game_ids=[str(source_game.public_id)],
    )
    source_comment = PublishedNightComment.objects.create(
        account=source,
        night=source_night,
        client_id=uuid.uuid4(),
        body="Komentář z anonymního účtu",
    )
    foreign_comment = PublishedNightComment.objects.create(
        account=reactor_b,
        night=source_night,
        client_id=uuid.uuid4(),
        body="Komentář kamaráda",
    )
    foreign_game_story = _published_night(
        reactor_b,
        client_id="foreign-game-story",
        drinking_day=drinking_day - timedelta(days=1),
        game_ids=[str(later_catalog_game.public_id)],
    )

    response = client.post(
        "/v1/auth/login",
        data={"email": "merge-conflicts@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
        **_auth(anon_token),
    )

    assert response.status_code == status.HTTP_200_OK, response.content
    assert not Account.objects.filter(pk=source.pk).exists()
    assert BeerCheckIn.objects.filter(account=target, client_id=checkin_client_id).count() == 1
    assert set(target_checkin.reactions.values_list("account_id", flat=True)) == {
        reactor_a.pk,
        reactor_b.pk,
    }
    assert PartyEvening.objects.filter(host=target, client_id=evening_client_id).count() == 1
    target_membership.refresh_from_db()
    source_drink.refresh_from_db()
    assert target_membership.active is True
    assert target_membership.left_at is None
    assert source_drink.account_id == target.pk
    assert source_drink.evening_id == target_evening.pk
    assert PartyGame.objects.filter(evening=target_evening, client_id=game_client_id).count() == 1
    target_game.refresh_from_db()
    assert target_game.roster_account_ids == [str(target.public_id)]
    assert set(target_game.events.values_list("pk", flat=True)) == {
        target_event.pk,
        source_event.pk,
    }
    source_event.refresh_from_db()
    assert source_event.account_id == target.pk
    assert source_event.subject_id == target.pk
    assert PartyGame.objects.filter(evening=target_evening, catalog_key="quiz").count() == 1
    first_catalog_game.refresh_from_db()
    assert first_catalog_game.evening_id == target_evening.pk
    assert first_catalog_game.ended_at is None
    assert first_catalog_game.roster_account_ids == [
        str(target.public_id),
        str(reactor_a.public_id),
    ]
    assert set(first_catalog_game.events.values_list("pk", flat=True)) == {
        canonical_quiz_event.pk,
        moved_quiz_event.pk,
    }
    moved_quiz_event.refresh_from_db()
    assert moved_quiz_event.game_id == first_catalog_game.pk
    foreign_game_story.refresh_from_db()
    assert foreign_game_story.game_ids == [str(first_catalog_game.public_id)]
    assert BeerPhoto.objects.filter(account=target, client_id=photo_client_id).count() == 1
    target_photo.refresh_from_db()
    assert target_photo.party_evening_id == target_evening.pk
    assert target_photo.caption == "Fotka od stolu"
    assert not PhotoContestEntry.objects.filter(pk=source_entry.pk).exists()
    source_entry_vote.refresh_from_db()
    assert source_entry_vote.entry_id == target_entry.pk
    target_night.refresh_from_db()
    assert "source-night" in target_night.client_aliases
    assert target_night.participant_ids == [str(target.public_id)]
    assert target_night.photo_ids == [str(target_photo.public_id)]
    assert target_night.game_ids == [str(target_game.public_id)]
    source_comment.refresh_from_db()
    foreign_comment.refresh_from_db()
    assert source_comment.account_id == target.pk
    assert source_comment.night_id == target_night.pk
    assert foreign_comment.night_id == target_night.pk


@pytest.mark.django_db(transaction=True)
def test_photo_merge_rollback_keeps_file_and_database_row(
    tmp_media,
    monkeypatch,
):
    target = Account.objects.create(device_id="photo-rollback-target")
    source = Account.objects.create(device_id="photo-rollback-source")
    client_id = uuid.uuid4()
    BeerPhotoDeletionTombstone.objects.create(account=target, client_id=client_id)
    photo = BeerPhoto.objects.create(
        account=source,
        client_id=client_id,
        image=SimpleUploadedFile("rollback.webp", b"rollback-image"),
    )
    stored = photo.image.path

    def fail_after_photo_merge(_source):
        raise RuntimeError("force merge rollback")

    monkeypatch.setattr(accounts, "_assert_no_cascade_rows_for_source", fail_after_photo_merge)

    with pytest.raises(RuntimeError, match="force merge rollback"):
        with transaction.atomic():
            accounts._merge_anonymous_account(source, target)

    photo.refresh_from_db()
    assert photo.account_id == source.pk
    assert Path(stored).exists()
    assert Account.objects.filter(pk=source.pk).exists()
    assert not BeerPhotoFileDeletion.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_photo_merge_locks_accounts_and_cleans_duplicate_file_after_commit(
    tmp_media,
    monkeypatch,
):
    target = Account.objects.create(device_id="photo-cleanup-target")
    source = Account.objects.create(device_id="photo-cleanup-source")
    client_id = uuid.uuid4()
    target_photo = BeerPhoto.objects.create(
        account=target,
        client_id=client_id,
        image=SimpleUploadedFile("target.webp", b"target-image"),
    )
    source_photo = BeerPhoto.objects.create(
        account=source,
        client_id=client_id,
        image=SimpleUploadedFile("source.webp", b"source-image"),
    )
    target_path = target_photo.image.path
    source_path = source_photo.image.path
    original_select_for_update = Account.objects.select_for_update
    lock_calls = []

    def select_for_update_spy(*args, **kwargs):
        lock_calls.append((args, kwargs))
        return original_select_for_update(*args, **kwargs)

    monkeypatch.setattr(Account.objects, "select_for_update", select_for_update_spy)

    with transaction.atomic():
        accounts._merge_anonymous_account(source, target)

    assert lock_calls == [((), {})]
    assert not Account.objects.filter(pk=source.pk).exists()
    assert BeerPhoto.objects.filter(account=target, client_id=client_id).count() == 1
    assert Path(target_path).exists()
    assert not Path(source_path).exists()
    assert not BeerPhotoFileDeletion.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_anonymous_merge_enqueues_durable_source_avatar_cleanup(tmp_media, monkeypatch):
    source = Account.objects.create(device_id="avatar-merge-source")
    target = Account.objects.create(device_id="avatar-merge-target")
    source.avatar = SimpleUploadedFile("avatar.webp", b"anonymous-avatar-bytes")
    source.save(update_fields=["avatar"])
    avatar_name = source.avatar.name
    avatar_path = Path(source.avatar.path)
    storage = Account._meta.get_field("avatar").storage
    original_delete = storage.delete

    def failing_delete(_name):
        raise OSError("media unavailable")

    # Force the post-commit cleanup to fail so the outbox row survives for the
    # worker-retry assertions below instead of vanishing on commit.
    monkeypatch.setattr(storage, "delete", failing_delete)

    with transaction.atomic():
        accounts._merge_anonymous_account(source, target)

    assert not Account.objects.filter(pk=source.pk).exists()
    assert avatar_path.exists()
    pending = BeerPhotoFileDeletion.objects.get(
        image_name=avatar_name,
        file_kind=BeerPhotoFileDeletion.FileKind.AVATAR,
        client_id=None,
        photo_public_id=None,
    )
    # The row must survive the source-account CASCADE as a durable pointer.
    assert pending.account_id is None

    monkeypatch.setattr(storage, "delete", original_delete)
    assert retry_beer_photo_file_deletion(pending.pk)
    assert not avatar_path.exists()
    assert not BeerPhotoFileDeletion.objects.exists()

    # A second worker attempt after the row is gone stays idempotent.
    assert retry_beer_photo_file_deletion(pending.pk)


@pytest.mark.django_db(transaction=True)
def test_avatar_merge_rollback_keeps_file_and_leaves_no_orphan_job(
    tmp_media,
    monkeypatch,
):
    source = Account.objects.create(device_id="avatar-rollback-source")
    target = Account.objects.create(device_id="avatar-rollback-target")
    source.avatar = SimpleUploadedFile("avatar.webp", b"rollback-avatar-bytes")
    source.save(update_fields=["avatar"])
    avatar_path = Path(source.avatar.path)

    def fail_source_delete(self, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        raise RuntimeError("forced merge rollback")

    monkeypatch.setattr(Account, "delete", fail_source_delete)

    with pytest.raises(RuntimeError, match="forced merge rollback"):
        with transaction.atomic():
            accounts._merge_anonymous_account(source, target)

    source.refresh_from_db()
    assert Path(avatar_path).exists()
    assert not BeerPhotoFileDeletion.objects.exists()


@pytest.mark.django_db
def test_login_merge_does_not_broaden_private_duplicate_story_data(client, sent_emails):
    _register(client, "merge-privacy@x.cz", "Tr0ub4dor&3")
    target = EmailCredential.objects.get(email="merge-privacy@x.cz").account
    anon_token, anon_id = _bootstrap_anon(client)
    source = Account.objects.get(public_id=anon_id)

    photo_client_id = uuid.uuid4()
    target_photo = BeerPhoto.objects.create(
        account=target,
        client_id=photo_client_id,
        image=f"beer-photos/{target.public_id}/visible.webp",
        visibility=BeerPhoto.Visibility.FRIENDS,
    )
    BeerPhoto.objects.create(
        account=source,
        client_id=photo_client_id,
        image=f"beer-photos/{source.public_id}/private.webp",
        visibility=BeerPhoto.Visibility.PRIVATE,
        caption="Soukromý popisek",
        pub_name="Soukromá hospoda",
    )
    drinking_day = timezone.localdate()
    target_night = _published_night(
        target,
        client_id="public-target-night",
        drinking_day=drinking_day,
    )
    source_night = _published_night(
        source,
        client_id="friends-source-night",
        drinking_day=drinking_day,
        participant_ids=[str(source.public_id)],
        photo_ids=[str(uuid.uuid4())],
        game_ids=[str(uuid.uuid4())],
    )
    source_night.visibility = PublishedNight.Visibility.FRIENDS
    source_night.save(update_fields=["visibility"])
    private_photo_night = _published_night(
        source,
        client_id="private-photo-source-night",
        drinking_day=drinking_day - timedelta(days=1),
        photo_ids=[str(BeerPhoto.objects.get(account=source).public_id)],
    )
    private_photo_night.visibility = PublishedNight.Visibility.FRIENDS
    private_photo_night.save(update_fields=["visibility"])

    response = client.post(
        "/v1/auth/login",
        data={"email": "merge-privacy@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
        **_auth(anon_token),
    )

    assert response.status_code == status.HTTP_200_OK, response.content
    target_photo.refresh_from_db()
    target_night.refresh_from_db()
    private_photo_night.refresh_from_db()
    assert target_photo.caption == ""
    assert target_photo.pub_name == ""
    assert target_night.participant_ids == []
    assert target_night.photo_ids == []
    assert target_night.game_ids == []
    assert private_photo_night.photo_ids != [str(target_photo.public_id)]


@pytest.mark.django_db
def test_login_merge_recounts_existing_amenity_aggregate(client, sent_emails):
    _register(client, "merge-amenity@x.cz", "Tr0ub4dor&3")
    target = EmailCredential.objects.get(email="merge-amenity@x.cz").account
    anon_token, anon_id = _bootstrap_anon(client)
    anon = Account.objects.get(public_id=anon_id)
    aggregate = _seed_amenity_vote(anon)

    resp = client.post(
        "/v1/auth/login",
        data={"email": "merge-amenity@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
        **_auth(anon_token),
    )

    assert resp.status_code == status.HTTP_200_OK, resp.content
    vote = PubAmenityVote.objects.get()
    assert vote.account == target
    aggregate.refresh_from_db()
    assert aggregate.yes_count == 1
    assert aggregate.distinct_voter_count == 1


@pytest.mark.django_db
def test_login_merge_failure_rolls_back_source_token_and_can_retry(
    client, sent_emails, monkeypatch
):
    _register(client, "merge-retry@x.cz", "Tr0ub4dor&3")
    anon_token, anon_id = _bootstrap_anon(client)
    anon = Account.objects.get(public_id=anon_id)
    _seed_amenity_vote(anon)
    original_recount = accounts._recount_amenity_aggregate

    def fail_recount(*_args):
        raise RuntimeError("forced recount failure")

    monkeypatch.setattr(accounts, "_recount_amenity_aggregate", fail_recount)
    failed = client.post(
        "/v1/auth/login",
        data={"email": "merge-retry@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
        **_auth(anon_token),
    )

    assert failed.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert Account.objects.filter(pk=anon.pk).exists()
    assert AuthToken.objects.filter(account_id=anon.pk).exists()
    assert PubAmenityVote.objects.filter(account_id=anon.pk).exists()

    monkeypatch.setattr(
        accounts, "_recount_amenity_aggregate", original_recount
    )
    retry = client.post(
        "/v1/auth/login",
        data={"email": "merge-retry@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
        **_auth(anon_token),
    )
    assert retry.status_code == status.HTTP_200_OK, retry.content
    assert not Account.objects.filter(pk=anon.pk).exists()


@pytest.mark.django_db(transaction=True)
def test_merge_copies_ugc_proof_from_anonymous_source_to_unproven_target():
    target = Account.objects.create(device_id="merge-ugc-target")
    EmailCredential.objects.create(
        account=target,
        email=f"merge-ugc-{uuid.uuid4().hex}@x.cz",
        password=make_password("Tr0ub4dor&3"),
    )
    source_timestamp = timezone.now() - timedelta(days=1)
    source = Account.objects.create(
        device_id="merge-ugc-source",
        ugc_terms_version=settings.UGC_POLICY_VERSION,
        ugc_terms_accepted_at=source_timestamp,
    )

    with transaction.atomic():
        accounts._merge_anonymous_account(source, target)

    assert not Account.objects.filter(pk=source.pk).exists()
    target.refresh_from_db()
    assert target.ugc_terms_version == settings.UGC_POLICY_VERSION
    assert target.ugc_terms_accepted_at == source_timestamp


@pytest.mark.django_db(transaction=True)
def test_merge_keeps_existing_target_ugc_proof_over_source_proof():
    target_timestamp = timezone.now() - timedelta(days=2)
    target = Account.objects.create(
        device_id="merge-ugc-keep-target",
        ugc_terms_version=settings.UGC_POLICY_VERSION,
        ugc_terms_accepted_at=target_timestamp,
    )
    EmailCredential.objects.create(
        account=target,
        email=f"merge-ugc-keep-{uuid.uuid4().hex}@x.cz",
        password=make_password("Tr0ub4dor&3"),
    )
    source = Account.objects.create(
        device_id="merge-ugc-keep-source",
        ugc_terms_version=settings.UGC_POLICY_VERSION,
        ugc_terms_accepted_at=timezone.now() - timedelta(days=1),
    )

    with transaction.atomic():
        accounts._merge_anonymous_account(source, target)

    assert not Account.objects.filter(pk=source.pk).exists()
    target.refresh_from_db()
    assert target.ugc_terms_version == settings.UGC_POLICY_VERSION
    assert target.ugc_terms_accepted_at == target_timestamp


@pytest.mark.django_db(transaction=True)
def test_merge_requires_atomic_transaction():
    source = Account.objects.create(device_id="merge-guard-source")
    target = Account.objects.create(device_id="merge-guard-target")

    with pytest.raises(RuntimeError, match=r"transaction\.atomic"):
        accounts._merge_anonymous_account(source, target)

    assert Account.objects.filter(pk=source.pk).exists()


@pytest.mark.django_db(transaction=True)
def test_merge_preserves_public_outgoing_follows_and_drops_private_incoming_follows():
    source = Account.objects.create(device_id="merge-follow-source")
    target = Account.objects.create(device_id="merge-follow-target", is_public=False)
    public = Account.objects.create(device_id="merge-follow-public", is_public=True)
    follower = Account.objects.create(device_id="merge-follow-follower", is_public=True)
    Follow.objects.create(follower=source, target=public)
    Follow.objects.create(follower=follower, target=source)

    with transaction.atomic():
        accounts._merge_anonymous_account(source, target)

    assert Follow.objects.filter(follower=target, target=public).exists()
    assert not Follow.objects.filter(follower=follower, target=target).exists()


@pytest.mark.django_db(transaction=True)
def test_merge_participants_are_locked_in_primary_key_order(monkeypatch):
    first = Account.objects.create(device_id="merge-lock-first")
    second = Account.objects.create(device_id="merge-lock-second")
    order_by_calls: list[tuple[str, ...]] = []
    queryset_type = type(Account.objects.all())
    original_order_by = queryset_type.order_by

    def order_by_spy(queryset, *fields):
        if queryset.model is Account and queryset.query.select_for_update:
            order_by_calls.append(fields)
        return original_order_by(queryset, *fields)

    monkeypatch.setattr(queryset_type, "order_by", order_by_spy)

    with transaction.atomic():
        locked_source, locked_target = accounts._lock_merge_participants(
            second,
            first,
        )

    assert order_by_calls == [("pk",)]
    assert locked_source is not None
    assert locked_source.pk == second.pk
    assert locked_target.pk == first.pk


@pytest.mark.django_db
def test_merge_row_helper_preloads_target_conflicts(django_assert_num_queries):
    source = Account.objects.create(device_id="merge-source")
    target = Account.objects.create(device_id="merge-target")
    conflict_id = uuid.uuid4()
    moved_id_a = uuid.uuid4()
    moved_id_b = uuid.uuid4()

    def drink(account: Account, client_id: uuid.UUID, name: str) -> None:
        DrinkLog.objects.create(
            account=account,
            client_id=client_id,
            cache_key="u2fkbnhz",
            name=name,
            lat=50.08,
            lng=14.45,
            beer_name="Plzeň",
            price_czk=55,
            drank_at="2026-06-01T18:00:00Z",
        )

    drink(target, conflict_id, "Target")
    drink(source, conflict_id, "Source conflict")
    for client_id in (moved_id_a, moved_id_b):
        drink(source, client_id, "Source moved")

    with django_assert_num_queries(5):
        _delete_or_move_account_rows(
            DrinkLog,
            source=source,
            target=target,
            unique_fields=("client_id",),
        )

    assert DrinkLog.objects.filter(account=source).count() == 0
    assert DrinkLog.objects.filter(account=target, client_id=conflict_id).count() == 1
    assert DrinkLog.objects.filter(account=target, client_id__in=[moved_id_a, moved_id_b]).count() == 2


@pytest.mark.django_db
def test_login_ignores_invalid_optional_bearer(client, sent_emails):
    _register(client, "invalid-hint@x.cz", "Tr0ub4dor&3")

    resp = client.post(
        "/v1/auth/login",
        data={"email": "invalid-hint@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
        HTTP_AUTHORIZATION="Bearer not-a-real-token",
    )

    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["providers"] == ["email"]


@pytest.mark.django_db
def test_login_wrong_password_returns_401_invalid_credentials(client, sent_emails):
    _register(client, "login2@x.cz", "Tr0ub4dor&3")
    resp = client.post(
        "/v1/auth/login",
        data={"email": "login2@x.cz", "password": "WrongPassword!9"},
        format="json",
    )
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    assert resp.json()["code"] == "invalid_credentials"


@pytest.mark.django_db
def test_login_unknown_email_returns_401_same_code_no_enumeration(client):
    resp = client.post(
        "/v1/auth/login",
        data={"email": "ghost@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
    )
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    # Same generic code as a wrong password → no account enumeration.
    assert resp.json()["code"] == "invalid_credentials"


@pytest.mark.django_db
def test_register_merge_operation_replays_same_claim_and_rejects_other_target(
    client,
    sent_emails,
):
    anon_token, anon_id = _bootstrap_anon(client)
    operation_id = uuid.uuid4()
    body = _merge_body(
        operation_id,
        email="operation-register@x.cz",
        password="Tr0ub4dor&3",
    )

    first = client.post(
        "/v1/auth/register",
        data=body,
        format="json",
        **_auth(anon_token),
    )
    replay = client.post(
        "/v1/auth/register",
        data=body,
        format="json",
        **_auth(anon_token),
    )

    assert first.status_code == status.HTTP_201_CREATED, first.content
    assert replay.status_code == status.HTTP_201_CREATED, replay.content
    assert first.json()["id"] == anon_id
    assert replay.json()["id"] == anon_id
    assert AccountMergeOperation.objects.filter(operation_id=operation_id).count() == 1
    assert EmailCredential.objects.filter(email="operation-register@x.cz").count() == 1

    _register(client, "operation-other@x.cz")
    other = EmailCredential.objects.get(email="operation-other@x.cz").account
    tokens_before = AuthToken.objects.filter(account=other).count()
    conflict = client.post(
        "/v1/auth/login",
        data=_merge_body(
            operation_id,
            email="operation-other@x.cz",
            password="Tr0ub4dor&3",
        ),
        format="json",
        **_auth(anon_token),
    )

    assert conflict.status_code == status.HTTP_409_CONFLICT, conflict.content
    assert conflict.json()["code"] == "merge_operation_target_mismatch"
    assert AuthToken.objects.filter(account=other).count() == tokens_before


@pytest.mark.django_db
def test_login_merge_operation_survives_lost_response_and_blocks_target_substitution(
    client,
    sent_emails,
):
    _register(client, "operation-target@x.cz")
    target = EmailCredential.objects.get(email="operation-target@x.cz").account
    _register(client, "operation-wrong-target@x.cz")
    wrong_target = EmailCredential.objects.get(email="operation-wrong-target@x.cz").account
    anon_token, anon_id = _bootstrap_anon(client)
    operation_id = uuid.uuid4()
    body = _merge_body(
        operation_id,
        email="operation-target@x.cz",
        password="Tr0ub4dor&3",
    )

    first = client.post(
        "/v1/auth/login",
        data=body,
        format="json",
        **_auth(anon_token),
    )
    second_operation_id = uuid.uuid4()
    target_tokens_after_first = AuthToken.objects.filter(account=target).count()
    competing_retry = client.post(
        "/v1/auth/login",
        data=_merge_body(
            second_operation_id,
            email="operation-target@x.cz",
            password="Tr0ub4dor&3",
        ),
        format="json",
        **_auth(anon_token),
    )
    # Simulate a lost first response: the device retries with its now-revoked A
    # bearer. The operation row is enough to prove the already-committed target.
    replay = client.post(
        "/v1/auth/login",
        data=body,
        format="json",
        **_auth(anon_token),
    )

    assert first.status_code == status.HTTP_200_OK, first.content
    assert competing_retry.status_code == status.HTTP_409_CONFLICT, competing_retry.content
    assert competing_retry.json()["code"] == "merge_operation_source_missing"
    assert not AccountMergeOperation.objects.filter(
        operation_id=second_operation_id
    ).exists()
    assert AuthToken.objects.filter(account=target).count() == target_tokens_after_first + 1
    assert replay.status_code == status.HTTP_200_OK, replay.content
    assert first.json()["id"] == str(target.public_id)
    assert replay.json()["id"] == str(target.public_id)
    assert not Account.objects.filter(public_id=anon_id).exists()
    assert AccountMergeOperation.objects.filter(operation_id=operation_id).count() == 1

    tokens_before = AuthToken.objects.filter(account=wrong_target).count()
    conflict = client.post(
        "/v1/auth/login",
        data=_merge_body(
            operation_id,
            email="operation-wrong-target@x.cz",
            password="Tr0ub4dor&3",
        ),
        format="json",
        **_auth(anon_token),
    )
    assert conflict.status_code == status.HTTP_409_CONFLICT, conflict.content
    assert conflict.json()["code"] == "merge_operation_target_mismatch"
    assert AuthToken.objects.filter(account=wrong_target).count() == tokens_before


@pytest.mark.django_db
def test_new_merge_operation_requires_live_anonymous_source(client, sent_emails):
    _register(client, "operation-source-required@x.cz")

    response = client.post(
        "/v1/auth/login",
        data=_merge_body(
            uuid.uuid4(),
            email="operation-source-required@x.cz",
            password="Tr0ub4dor&3",
        ),
        format="json",
    )

    assert response.status_code == status.HTTP_409_CONFLICT, response.content
    assert response.json()["code"] == "merge_operation_source_missing"
    assert not AccountMergeOperation.objects.exists()


@pytest.mark.django_db
def test_new_merge_operation_rejects_claimed_source_without_rekey_receipt(
    client,
    sent_emails,
):
    claimed = _register(client, "operation-claimed-source@x.cz")
    claimed_token = claimed.json()["token"]
    claimed_account = EmailCredential.objects.get(
        email="operation-claimed-source@x.cz"
    ).account
    _register(client, "operation-claimed-target@x.cz")
    target = EmailCredential.objects.get(email="operation-claimed-target@x.cz").account
    target_tokens_before = AuthToken.objects.filter(account=target).count()
    operation_id = uuid.uuid4()

    response = client.post(
        "/v1/auth/login",
        data=_merge_body(
            operation_id,
            email="operation-claimed-target@x.cz",
            password="Tr0ub4dor&3",
        ),
        format="json",
        **_auth(claimed_token),
    )

    assert response.status_code == status.HTTP_409_CONFLICT, response.content
    assert response.json()["code"] == "merge_operation_source_claimed"
    assert Account.objects.filter(pk=claimed_account.pk).exists()
    assert not AccountMergeOperation.objects.filter(operation_id=operation_id).exists()
    assert AuthToken.objects.filter(account=target).count() == target_tokens_before


@pytest.mark.django_db
def test_new_merge_operation_rejects_source_that_became_inactive(sent_emails):
    target = Account.objects.create(device_id="operation-inactive-target")
    EmailCredential.objects.create(
        account=target,
        email="operation-inactive-target@x.cz",
        password=make_password("Tr0ub4dor&3"),
    )
    source = Account.objects.create(device_id="operation-inactive-source")
    stale_source = Account.objects.get(pk=source.pk)
    Account.objects.filter(pk=source.pk).update(
        status=Account.Status.PENDING_DELETION,
        deleted_at=timezone.now(),
    )
    operation_id = uuid.uuid4()
    target_tokens_before = AuthToken.objects.filter(account=target).count()

    with pytest.raises(accounts.AccountError) as raised:
        accounts.login_email(
            email="operation-inactive-target@x.cz",
            password="Tr0ub4dor&3",
            current_account=stale_source,
            merge_operation_id=operation_id,
        )

    assert raised.value.code == "merge_operation_source_inactive"
    assert not AccountMergeOperation.objects.filter(operation_id=operation_id).exists()
    assert AuthToken.objects.filter(account=target).count() == target_tokens_before


@pytest.mark.django_db
def test_social_operation_target_mismatch_does_not_reactivate_email_match():
    source = Account.objects.create(device_id="social-operation-source")
    bound_target = Account.objects.create(device_id="social-operation-bound-target")
    email_match = Account.objects.create(
        device_id="social-operation-email-match",
        status=Account.Status.PENDING_DELETION,
        deleted_at=timezone.now(),
    )
    AuthIdentity.objects.create(
        account=email_match,
        provider=AuthIdentity.Provider.GOOGLE,
        subject="SOCIAL-OPERATION-GOOGLE",
        email="social-operation-match@x.cz",
    )
    operation_id = uuid.uuid4()
    AccountMergeOperation.objects.create(
        operation_id=operation_id,
        source_account_fingerprint=account_merge_fingerprint(source.public_id),
        target_account_fingerprint=account_merge_fingerprint(bound_target.public_id),
    )

    with pytest.raises(accounts.AccountError) as raised:
        accounts.resolve_social(
            source,
            provider=AuthIdentity.Provider.APPLE,
            claims={
                "sub": "SOCIAL-OPERATION-APPLE",
                "email": "social-operation-match@x.cz",
                "email_verified": True,
            },
            apple_refresh_token="refresh-token",
            merge_operation_id=operation_id,
        )

    assert raised.value.code == "merge_operation_target_mismatch"
    email_match.refresh_from_db()
    assert email_match.status == Account.Status.PENDING_DELETION
    assert email_match.deleted_at is not None
    assert not AuthIdentity.objects.filter(
        provider=AuthIdentity.Provider.APPLE,
        subject="SOCIAL-OPERATION-APPLE",
    ).exists()


@pytest.mark.django_db
def test_merge_failure_rolls_back_new_operation_receipt_and_token(
    client,
    sent_emails,
    monkeypatch,
):
    _register(client, "operation-rollback-target@x.cz")
    target = EmailCredential.objects.get(email="operation-rollback-target@x.cz").account
    source_token, source_id = _bootstrap_anon(client)
    operation_id = uuid.uuid4()
    target_tokens_before = AuthToken.objects.filter(account=target).count()
    sentinel = f"operation={operation_id} email=private@example.cz bearer=secret"
    logged: list[tuple[tuple, dict]] = []

    def fail_merge(_source, _target):
        raise RuntimeError(sentinel)

    def capture_error(*args, **kwargs):
        logged.append((args, kwargs))

    monkeypatch.setattr(accounts, "_merge_anonymous_account", fail_merge)
    monkeypatch.setattr("pubs.api.auth_views.logger.error", capture_error)
    response = client.post(
        "/v1/auth/login",
        data=_merge_body(
            operation_id,
            email="operation-rollback-target@x.cz",
            password="Tr0ub4dor&3",
        ),
        format="json",
        **_auth(source_token),
    )

    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert Account.objects.filter(public_id=source_id).exists()
    assert not AccountMergeOperation.objects.filter(operation_id=operation_id).exists()
    assert AuthToken.objects.filter(account=target).count() == target_tokens_before
    assert logged
    assert sentinel not in repr(logged)
    assert all("exc_info" not in kwargs for _args, kwargs in logged)


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("endpoint", "body"),
    [
        (
            "/v1/auth/register",
            {"email": "uuid-version@x.cz", "password": "Tr0ub4dor&3"},
        ),
        (
            "/v1/auth/login",
            {"email": "uuid-version@x.cz", "password": "Tr0ub4dor&3"},
        ),
        ("/v1/auth/google", {"id_token": "unused"}),
        ("/v1/auth/apple", {"identity_token": "unused"}),
    ],
)
def test_merge_capable_auth_rejects_non_v4_operation_id(client, endpoint, body):
    response = client.post(
        endpoint,
        data={**body, "merge_operation_id": str(uuid.uuid1())},
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST, response.content
    assert "merge_operation_id" in response.json()


@pytest.mark.django_db
def test_login_reactivates_pending_deletion_account(client, fake_oauth, sent_emails):
    _, token = _register_and_token(client, "reactivate@x.cz", "Tr0ub4dor&3")
    account = EmailCredential.objects.get(email="reactivate@x.cz").account

    # Schedule deletion.
    deleted = client.delete("/v1/account/me", **_auth(token))
    assert deleted.status_code == status.HTTP_204_NO_CONTENT
    account.refresh_from_db()
    assert account.status == Account.Status.PENDING_DELETION

    # Logging back in within the grace window reactivates the account.
    resp = client.post(
        "/v1/auth/login",
        data={"email": "reactivate@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    account.refresh_from_db()
    assert account.status == Account.Status.ACTIVE
    assert account.deleted_at is None


# ===========================================================================
# 3. Google sign-in
# ===========================================================================


@pytest.mark.django_db
def test_google_new_identity_no_bearer_creates_account(client, fake_oauth):
    resp = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-SUB-1:g1@x.cz"},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["created"] is True
    assert body["providers"] == ["google"]
    assert body["token"]
    me = client.get("/v1/account/me", **_auth(body["token"]))
    assert me.status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_google_new_identity_with_anon_bearer_claims_it(client, fake_oauth):
    token, anon_id = _bootstrap_anon(client)
    resp = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-SUB-2:g2@x.cz"},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["created"] is False  # claimed, not created
    assert body["id"] == anon_id
    assert Account.objects.count() == 1


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("endpoint", "first_body", "conflict_body", "conflict_provider", "conflict_subject"),
    [
        (
            "/v1/auth/google",
            {"id_token": "google:G-OPERATION:operation-google@x.cz"},
            {"id_token": "google:G-OPERATION-WRONG:wrong-google@x.cz"},
            "google",
            "G-OPERATION-WRONG",
        ),
        (
            "/v1/auth/apple",
            {
                "identity_token": "apple:A-OPERATION:operation-apple@x.cz",
                "authorization_code": "apple-auth-code",
            },
            {
                "identity_token": "apple:A-OPERATION-WRONG:wrong-apple@x.cz",
                "authorization_code": "apple-auth-code",
            },
            "apple",
            "A-OPERATION-WRONG",
        ),
    ],
)
def test_social_merge_operation_replays_and_rejects_different_identity(
    client,
    fake_oauth,
    endpoint,
    first_body,
    conflict_body,
    conflict_provider,
    conflict_subject,
):
    anon_token, anon_id = _bootstrap_anon(client)
    operation_id = uuid.uuid4()

    first = client.post(
        endpoint,
        data=_merge_body(operation_id, **first_body),
        format="json",
        **_auth(anon_token),
    )
    replay = client.post(
        endpoint,
        data=_merge_body(operation_id, **first_body),
        format="json",
        **_auth(anon_token),
    )

    assert first.status_code == status.HTTP_200_OK, first.content
    assert replay.status_code == status.HTTP_200_OK, replay.content
    assert first.json()["id"] == anon_id
    assert replay.json()["id"] == anon_id
    account_count = Account.objects.count()

    conflict = client.post(
        endpoint,
        data=_merge_body(operation_id, **conflict_body),
        format="json",
        **_auth(anon_token),
    )

    assert conflict.status_code == status.HTTP_409_CONFLICT, conflict.content
    assert conflict.json()["code"] == "merge_operation_target_mismatch"
    assert Account.objects.count() == account_count
    assert not AuthIdentity.objects.filter(
        provider=conflict_provider,
        subject=conflict_subject,
    ).exists()


@pytest.mark.django_db
def test_google_signin_ignores_invalid_optional_bearer(client, fake_oauth):
    resp = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-STALE:stale@x.cz"},
        format="json",
        **_auth("stale-token"),
    )

    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["created"] is True
    assert body["providers"] == ["google"]
    assert body["token"]


@pytest.mark.django_db
def test_google_returning_sub_signs_into_same_account(client, fake_oauth):
    first = client.post(
        "/v1/auth/google", data={"id_token": "google:G-SUB-3:g3@x.cz"}, format="json"
    )
    first_id = first.json()["id"]

    second = client.post(
        "/v1/auth/google", data={"id_token": "google:G-SUB-3:g3@x.cz"}, format="json"
    )
    assert second.status_code == status.HTTP_200_OK
    body = second.json()
    assert body["created"] is False
    assert body["id"] == first_id
    assert Account.objects.count() == 1
    assert AuthIdentity.objects.filter(provider="google", subject="G-SUB-3").count() == 1


@pytest.mark.django_db
def test_google_returning_sub_merges_anonymous_progress(client, fake_oauth):
    first = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-RETURN-MERGE:return-google@x.cz"},
        format="json",
    )
    target = AuthIdentity.objects.get(
        provider="google", subject="G-RETURN-MERGE"
    ).account

    anon_token, anon_id = _bootstrap_anon(client)
    anon = Account.objects.get(public_id=anon_id)
    drink = DrinkLog.objects.create(
        account=anon,
        client_id=uuid.uuid4(),
        cache_key="u2fkbnhz",
        name="U Vystřelenýho oka",
        lat=50.08,
        lng=14.45,
        beer_name="Plzeň",
        price_czk=55,
        drank_at="2026-06-01T18:00:00Z",
    )
    visit = PubVisit.objects.create(
        account=anon,
        client_id=uuid.uuid4(),
        cache_key="u2fkbnhz",
        name="U Vystřelenýho oka",
        lat=50.08,
        lng=14.45,
        started_at="2026-06-01T18:00:00Z",
        client_updated_at="2026-06-01T18:00:00Z",
    )
    push_device = PushDevice.objects.create(
        account=anon,
        push_token="ExponentPushToken[returningGoogle]",
        platform=PushDevice.Platform.IOS,
        permission_status=PushDevice.PermissionStatus.GRANTED,
        enabled=True,
    )

    returning = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-RETURN-MERGE:return-google@x.cz"},
        format="json",
        **_auth(anon_token),
    )

    assert first.status_code == status.HTTP_200_OK, first.content
    assert returning.status_code == status.HTTP_200_OK, returning.content
    assert returning.json()["id"] == str(target.public_id)
    assert returning.json()["created"] is False
    assert Account.objects.count() == 1
    drink.refresh_from_db()
    assert drink.account_id == target.id
    visit.refresh_from_db()
    assert visit.account_id == target.id
    push_device.refresh_from_db()
    assert push_device.account_id == target.id


@pytest.mark.django_db
def test_apple_signin_merges_into_existing_google_account_by_verified_email(client, fake_oauth):
    google = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-MERGE:same@x.cz"},
        format="json",
    )
    google_id = google.json()["id"]

    token, anon_id = _bootstrap_anon(client)
    anon = Account.objects.get(public_id=anon_id)
    drink = DrinkLog.objects.create(
        account=anon,
        client_id=uuid.uuid4(),
        cache_key="u2fkbnhz",
        name="U Vystřelenýho oka",
        lat=50.08,
        lng=14.45,
        beer_name="Plzeň",
        price_czk=55,
        drank_at="2026-06-01T18:00:00Z",
    )

    apple = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-MERGE:same@x.cz",
            "authorization_code": "apple-auth-code",
        },
        format="json",
        **_auth(token),
    )

    assert apple.status_code == status.HTTP_200_OK, apple.content
    body = apple.json()
    assert body["id"] == google_id
    assert body["created"] is False
    assert sorted(body["providers"]) == ["apple", "google"]
    assert Account.objects.count() == 1
    assert AuthIdentity.objects.filter(provider="google", subject="G-MERGE").exists()
    assert AuthIdentity.objects.filter(provider="apple", subject="A-MERGE").exists()
    drink.refresh_from_db()
    assert str(drink.account.public_id) == google_id


# ===========================================================================
# 4. Apple sign-in
# ===========================================================================


@pytest.mark.django_db
def test_apple_new_identity_no_bearer_creates_account(client, fake_oauth):
    resp = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-SUB-1:a1@x.cz",
            "authorization_code": "apple-auth-code",
        },
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["created"] is True
    assert body["providers"] == ["apple"]


@pytest.mark.django_db
def test_apple_new_identity_requires_refresh_token_capture(client, fake_oauth):
    resp = client.post(
        "/v1/auth/apple",
        data={"identity_token": "apple:A-NO-REFRESH:no-refresh@x.cz"},
        format="json",
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "apple_refresh_required"
    assert not AuthIdentity.objects.filter(provider="apple", subject="A-NO-REFRESH").exists()


@pytest.mark.django_db
def test_apple_stores_refresh_token_from_authorization_code(client, fake_oauth):
    resp = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-SUB-2:a2@x.cz",
            "authorization_code": "apple-auth-code",
        },
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    identity = AuthIdentity.objects.get(provider="apple", subject="A-SUB-2")
    assert identity.apple_refresh_token == "rt_test"


@pytest.mark.django_db
def test_apple_full_name_stored_as_display_name_on_first_signin(client, fake_oauth):
    resp = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-SUB-3:a3@x.cz",
            "authorization_code": "apple-auth-code",
            "full_name": "Tomáš Macháček",
        },
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["display_name"] == "Tomáš Macháček"
    account = AuthIdentity.objects.get(provider="apple", subject="A-SUB-3").account
    assert account.display_name == "Tomáš Macháček"


@pytest.mark.django_db
def test_apple_returning_sub_merges_anonymous_progress(client, fake_oauth):
    first = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-RETURN-MERGE:return-apple@x.cz",
            "authorization_code": "apple-auth-code",
        },
        format="json",
    )
    target = AuthIdentity.objects.get(
        provider="apple", subject="A-RETURN-MERGE"
    ).account

    anon_token, anon_id = _bootstrap_anon(client)
    anon = Account.objects.get(public_id=anon_id)
    drink = DrinkLog.objects.create(
        account=anon,
        client_id=uuid.uuid4(),
        cache_key="u2fkbnhz",
        name="U Vystřelenýho oka",
        lat=50.08,
        lng=14.45,
        beer_name="Plzeň",
        price_czk=55,
        drank_at="2026-06-01T18:00:00Z",
    )
    visit = PubVisit.objects.create(
        account=anon,
        client_id=uuid.uuid4(),
        cache_key="u2fkbnhz",
        name="U Vystřelenýho oka",
        lat=50.08,
        lng=14.45,
        started_at="2026-06-01T18:00:00Z",
        client_updated_at="2026-06-01T18:00:00Z",
    )
    push_device = PushDevice.objects.create(
        account=anon,
        push_token="ExponentPushToken[returningApple]",
        platform=PushDevice.Platform.IOS,
        permission_status=PushDevice.PermissionStatus.GRANTED,
        enabled=True,
    )

    returning = client.post(
        "/v1/auth/apple",
        data={"identity_token": "apple:A-RETURN-MERGE:return-apple@x.cz"},
        format="json",
        **_auth(anon_token),
    )

    assert first.status_code == status.HTTP_200_OK, first.content
    assert returning.status_code == status.HTTP_200_OK, returning.content
    assert returning.json()["id"] == str(target.public_id)
    assert returning.json()["created"] is False
    assert Account.objects.count() == 1
    drink.refresh_from_db()
    assert drink.account_id == target.id
    visit.refresh_from_db()
    assert visit.account_id == target.id
    push_device.refresh_from_db()
    assert push_device.account_id == target.id


@pytest.mark.django_db
def test_google_signin_merges_into_existing_apple_account_by_verified_email(client, fake_oauth):
    apple = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-MERGE-FIRST:both@x.cz",
            "authorization_code": "apple-auth-code",
        },
        format="json",
    )
    apple_id = apple.json()["id"]

    google = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-MERGE-SECOND:both@x.cz"},
        format="json",
    )

    assert google.status_code == status.HTTP_200_OK, google.content
    body = google.json()
    assert body["id"] == apple_id
    assert body["created"] is False
    assert sorted(body["providers"]) == ["apple", "google"]
    assert Account.objects.count() == 1


# ===========================================================================
# 5. Email-collision guard (anti account-takeover)
# ===========================================================================


@pytest.mark.django_db
def test_social_signin_rejects_email_belonging_to_password_account(client, fake_oauth, sent_emails):
    # Password account owns a@x.cz.
    _register(client, "a@x.cz", "Tr0ub4dor&3")

    # A NEW google sub asserting the same email, no bearer → must be rejected,
    # never merged onto the password account.
    resp = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-COLLIDE:a@x.cz"},
        format="json",
    )
    assert resp.status_code == status.HTTP_409_CONFLICT
    assert resp.json()["code"] == "email_exists"
    # No identity was created and no extra account was made.
    assert not AuthIdentity.objects.filter(subject="G-COLLIDE").exists()
    assert Account.objects.count() == 1


# ===========================================================================
# 6. Linking a provider to the authenticated account
# ===========================================================================


@pytest.mark.django_db
def test_link_google_to_email_account(client, fake_oauth, sent_emails):
    _, token = _register_and_token(client, "link@x.cz", "Tr0ub4dor&3")

    resp = client.post(
        "/v1/auth/link",
        data={"provider": "google", "id_token": "google:G-LINK:link@x.cz"},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    assert sorted(resp.json()["providers"]) == ["email", "google"]


@pytest.mark.django_db
def test_link_google_already_linked_elsewhere_returns_409(client, fake_oauth, sent_emails):
    # Account B already owns google sub G-OTHER.
    client.post("/v1/auth/google", data={"id_token": "google:G-OTHER:b@x.cz"}, format="json")

    # Account A (email) tries to link the SAME sub.
    _, token = _register_and_token(client, "a2@x.cz", "Tr0ub4dor&3")
    resp = client.post(
        "/v1/auth/link",
        data={"provider": "google", "id_token": "google:G-OTHER:b@x.cz"},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_409_CONFLICT
    assert resp.json()["code"] == "provider_linked_elsewhere"


@pytest.mark.django_db
def test_link_google_when_already_have_google_returns_409(client, fake_oauth, sent_emails):
    _, token = _register_and_token(client, "a3@x.cz", "Tr0ub4dor&3")
    # First link succeeds.
    first = client.post(
        "/v1/auth/link",
        data={"provider": "google", "id_token": "google:G-FIRST:a3@x.cz"},
        format="json",
        **_auth(token),
    )
    assert first.status_code == status.HTTP_200_OK

    # Second link with a DIFFERENT google sub on the same account → rejected.
    second = client.post(
        "/v1/auth/link",
        data={"provider": "google", "id_token": "google:G-SECOND:a3@x.cz"},
        format="json",
        **_auth(token),
    )
    assert second.status_code == status.HTTP_409_CONFLICT
    assert second.json()["code"] == "provider_already_linked"


@pytest.mark.django_db
def test_link_requires_authentication(client, fake_oauth):
    resp = client.post(
        "/v1/auth/link",
        data={"provider": "google", "id_token": "google:G-NOAUTH:x@x.cz"},
        format="json",
    )
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


# ===========================================================================
# 7. Unlinking
# ===========================================================================


@pytest.mark.django_db
def test_unlink_google_from_email_plus_google_account(client, fake_oauth, sent_emails):
    _, token = _register_and_token(client, "u@x.cz", "Tr0ub4dor&3")
    client.post(
        "/v1/auth/link",
        data={"provider": "google", "id_token": "google:G-UNLINK:u@x.cz"},
        format="json",
        **_auth(token),
    )

    resp = client.post(
        "/v1/auth/unlink", data={"provider": "google"}, format="json", **_auth(token)
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["providers"] == ["email"]


@pytest.mark.django_db
def test_unlink_last_method_returns_400_last_credential(client, fake_oauth):
    # Google-only account: google is the only sign-in method.
    resp = client.post(
        "/v1/auth/google", data={"id_token": "google:G-ONLY:o@x.cz"}, format="json"
    )
    token = resp.json()["token"]

    unlink = client.post(
        "/v1/auth/unlink", data={"provider": "google"}, format="json", **_auth(token)
    )
    assert unlink.status_code == status.HTTP_400_BAD_REQUEST
    assert unlink.json()["code"] == "last_credential"


@pytest.mark.django_db
def test_unlink_apple_revokes_apple_token(client, fake_oauth, sent_emails):
    _, token = _register_and_token(client, "ua@x.cz", "Tr0ub4dor&3")
    # Link apple WITH an authorization_code so a refresh token gets stored.
    client.post(
        "/v1/auth/link",
        data={
            "provider": "apple",
            "identity_token": "apple:A-UNLINK:ua@x.cz",
            "authorization_code": "code",
        },
        format="json",
        **_auth(token),
    )
    identity = AuthIdentity.objects.get(provider="apple", subject="A-UNLINK")
    assert identity.apple_refresh_token == "rt_test"

    unlink = client.post(
        "/v1/auth/unlink", data={"provider": "apple"}, format="json", **_auth(token)
    )
    assert unlink.status_code == status.HTTP_200_OK
    assert "rt_test" in fake_oauth["revoked"]
    assert not AuthIdentity.objects.filter(subject="A-UNLINK").exists()


@pytest.mark.django_db
def test_unlink_apple_keeps_identity_when_revocation_fails(
    client, fake_oauth, sent_emails, monkeypatch
):
    _, token = _register_and_token(client, "ua-fail@x.cz", "Tr0ub4dor&3")
    client.post(
        "/v1/auth/link",
        data={
            "provider": "apple",
            "identity_token": "apple:A-UNLINK-FAIL:ua-fail@x.cz",
            "authorization_code": "code",
        },
        format="json",
        **_auth(token),
    )

    def fail_revoke(token: str, token_type_hint: str = "refresh_token") -> None:
        raise oauth.OAuthError("apple down")

    monkeypatch.setattr(oauth, "revoke_apple_token", fail_revoke)

    unlink = client.post(
        "/v1/auth/unlink", data={"provider": "apple"}, format="json", **_auth(token)
    )

    assert unlink.status_code == status.HTTP_502_BAD_GATEWAY
    assert unlink.json()["code"] == "apple_revoke_failed"
    identity = AuthIdentity.objects.get(subject="A-UNLINK-FAIL")
    assert identity.apple_refresh_token == "rt_test"


# ===========================================================================
# 8. set-password (escape hatch for social-only accounts)
# ===========================================================================


@pytest.mark.django_db
def test_set_password_on_google_account_enables_email_login(client, fake_oauth, sent_emails):
    resp = client.post(
        "/v1/auth/google", data={"id_token": "google:G-SETPW:sp@x.cz"}, format="json"
    )
    token = resp.json()["token"]

    setpw = client.post(
        "/v1/auth/set-password",
        data={"password": "Tr0ub4dor&3", "email": "sp@x.cz"},
        format="json",
        **_auth(token),
    )
    assert setpw.status_code == status.HTTP_200_OK
    assert sorted(setpw.json()["providers"]) == ["email", "google"]

    # Now email+password login works.
    login = client.post(
        "/v1/auth/login",
        data={"email": "sp@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
    )
    assert login.status_code == status.HTTP_200_OK


# ===========================================================================
# 9. Logout (single token / all)
# ===========================================================================


@pytest.mark.django_db
def test_logout_revokes_current_token(client, sent_emails):
    _, token = _register_and_token(client, "logout@x.cz", "Tr0ub4dor&3")
    assert client.get("/v1/account/me", **_auth(token)).status_code == status.HTTP_200_OK

    resp = client.post("/v1/auth/logout", data={}, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["ok"] is True

    # Old token no longer authenticates.
    assert client.get("/v1/account/me", **_auth(token)).status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_logout_all_revokes_every_token(client, sent_emails):
    _, token1 = _register_and_token(client, "all@x.cz", "Tr0ub4dor&3")
    # Second device: a fresh login issues another token for the same account.
    login = client.post(
        "/v1/auth/login",
        data={"email": "all@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
    )
    token2 = login.json()["token"]
    assert token1 != token2

    resp = client.post("/v1/auth/logout", data={"all": True}, format="json", **_auth(token1))
    assert resp.status_code == status.HTTP_200_OK

    # Both devices' tokens stop working.
    assert client.get("/v1/account/me", **_auth(token1)).status_code == status.HTTP_401_UNAUTHORIZED
    assert client.get("/v1/account/me", **_auth(token2)).status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_logout_all_cannot_recover_claimed_account_from_public_device_id(
    client,
    sent_emails,
):
    device_token, account_id = _bootstrap_anon(client)
    account = Account.objects.get(public_id=account_id)
    session = _register(
        client,
        "logout-device-recovery@x.cz",
        token=device_token,
    ).json()["token"]

    logged_out = client.post(
        "/v1/auth/logout",
        data={"all": True},
        format="json",
        **_auth(session),
    )
    recovered = client.post(
        "/v1/account",
        data={"device_id": account.device_id},
        format="json",
    )

    assert logged_out.status_code == status.HTTP_200_OK
    assert recovered.status_code == status.HTTP_401_UNAUTHORIZED
    assert "token" not in recovered.json()
    assert not AuthToken.objects.filter(account=account).exists()


# --- Logout must also disable push devices (defense-in-depth privacy) ------
#
# PushDevice rows carry no session/token reference, so a single-token logout
# cannot tell WHICH device presented the token. Per the accepted trade-off,
# single-token logout disables ALL of the account's push devices rather than
# risk a logged-out phone keep receiving party pushes. The mobile app
# re-registers its token via PUT /v1/push-device on the next launch.


def _push_device(account: Account, push_token: str) -> PushDevice:
    return PushDevice.objects.create(
        account=account,
        push_token=push_token,
        platform=PushDevice.Platform.IOS,
        permission_status=PushDevice.PermissionStatus.GRANTED,
        enabled=True,
    )


def _deliverable_push_tokens(account: Account) -> list[str]:
    # Mirrors the party-push fan-out selection (enabled + permission granted),
    # proving disabled devices are no longer selected for delivery.
    return list(
        PushDevice.objects.filter(
            account=account,
            enabled=True,
            permission_status=PushDevice.PermissionStatus.GRANTED,
        ).values_list("push_token", flat=True)
    )


@pytest.mark.django_db
def test_logout_disables_all_account_push_devices_because_no_safe_session_correlation_exists(
    client, sent_emails
):
    email = "logout-push@x.cz"
    _, token = _register_and_token(client, email)
    account = EmailCredential.objects.get(email=email).account
    _push_device(account, "ExpoToken[logout-a]")
    _push_device(account, "ExpoToken[logout-b]")

    resp = client.post("/v1/auth/logout", data={}, format="json", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"ok": True}
    assert not account.push_devices.filter(enabled=True).exists()
    assert account.push_devices.filter(enabled=False).count() == 2


@pytest.mark.django_db
def test_logout_all_disables_all_account_push_devices(client, sent_emails):
    email = "logout-all-push@x.cz"
    _, token = _register_and_token(client, email)
    account = EmailCredential.objects.get(email=email).account
    _push_device(account, "ExpoToken[all-a]")
    _push_device(account, "ExpoToken[all-b]")

    resp = client.post("/v1/auth/logout", data={"all": True}, format="json", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"ok": True}
    assert not account.push_devices.filter(enabled=True).exists()


@pytest.mark.django_db
def test_logout_is_idempotent_for_push_devices_and_safe_with_none_registered(client, sent_emails):
    email = "logout-idem@x.cz"
    _, token = _register_and_token(client, email)
    account = EmailCredential.objects.get(email=email).account
    device = _push_device(account, "ExpoToken[idem-a]")

    first = client.post("/v1/auth/logout", data={}, format="json", **_auth(token))
    assert first.status_code == status.HTTP_200_OK
    device.refresh_from_db()
    assert device.enabled is False

    # A repeat logout attempt can no longer authenticate (token revoked) and a
    # second call with no enabled devices would be a no-op update.
    assert client.get("/v1/account/me", **_auth(token)).status_code == status.HTTP_401_UNAUTHORIZED

    _, token2 = _register_and_token(client, "logout-nopush@x.cz")
    empty = client.post("/v1/auth/logout", data={}, format="json", **_auth(token2))
    assert empty.status_code == status.HTTP_200_OK
    assert empty.json() == {"ok": True}


@pytest.mark.django_db
def test_logout_disabling_push_devices_rolls_back_together_with_token_revocation_on_failure(
    client, sent_emails, monkeypatch
):
    from pubs.api import auth_views

    email = "logout-rollback@x.cz"
    _, token = _register_and_token(client, email)
    account = EmailCredential.objects.get(email=email).account
    device = _push_device(account, "ExpoToken[rollback-a]")

    def boom(_account):
        raise RuntimeError("simulated db failure")

    monkeypatch.setattr(auth_views, "_disable_account_push_devices", boom)
    resp = client.post("/v1/auth/logout", data={}, format="json", **_auth(token))

    # Atomic operation: the failed push-device disable rolls the token
    # revocation back too — either both happen or neither does.
    assert resp.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert client.get("/v1/account/me", **_auth(token)).status_code == status.HTTP_200_OK
    device.refresh_from_db()
    assert device.enabled is True


@pytest.mark.django_db
def test_push_fanout_no_longer_selects_disabled_devices_after_logout_but_other_accounts_untouched(
    client, sent_emails
):
    email = "logout-fanout@x.cz"
    _, token = _register_and_token(client, email)
    account = EmailCredential.objects.get(email=email).account
    other_email = "logout-fanout-other@x.cz"
    _, other_token = _register_and_token(client, other_email)
    other_account = EmailCredential.objects.get(email=other_email).account

    _push_device(account, "ExpoToken[fanout-mine]")
    _push_device(other_account, "ExpoToken[fanout-other]")

    client.post("/v1/auth/logout", data={}, format="json", **_auth(token))

    assert _deliverable_push_tokens(account) == []
    # Other accounts' devices stay deliverable; logout never touches them.
    assert _deliverable_push_tokens(other_account) == ["ExpoToken[fanout-other]"]
    assert client.get("/v1/account/me", **_auth(other_token)).status_code == status.HTTP_200_OK


# ===========================================================================
# 10. Password reset (request + consume)
# ===========================================================================


@pytest.mark.django_db
def test_request_password_reset_known_email_sends_web_link_and_creates_token(client, monkeypatch):
    captured: dict[str, str | None] = {}

    def fake_send_email(to, subject, html, *, text=None, attachments=None):
        captured["html"] = html
        captured["text"] = text
        return True

    monkeypatch.setattr(emailer, "send_email", fake_send_email)
    _register(client, "reset@x.cz", "Tr0ub4dor&3")
    captured.clear()

    resp = client.post(
        "/v1/auth/request-password-reset", data={"email": "reset@x.cz"}, format="json"
    )
    assert resp.status_code == status.HTTP_202_ACCEPTED
    html = captured["html"] or ""
    text = captured["text"] or ""
    assert 'href="http://testserver/v1/auth/reset?token=' in html
    assert "napivo://" not in html
    link_start = html.index('href="http://testserver/v1/auth/reset?token=') + len('href="')
    link = html[link_start : html.index('"', link_start)]
    raw = link.removeprefix("http://testserver/v1/auth/reset?token=")
    assert link in text
    assert raw in html
    assert raw in text
    assert OneTimeToken.objects.filter(
        purpose=OneTimeToken.Purpose.RESET_PASSWORD
    ).count() == 1


@pytest.mark.django_db
def test_reset_password_landing_page_opens_app(client):
    resp = client.get("/v1/auth/reset?token=abc")

    assert resp.status_code == status.HTTP_200_OK
    html = resp.content.decode("utf-8")
    assert 'href="napivo://auth/reset?token=abc"' in html
    assert "Nastavit nové heslo v appce" in html


@pytest.mark.django_db
def test_reset_password_landing_page_rejects_missing_token(client):
    resp = client.get("/v1/auth/reset")

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    html = resp.content.decode("utf-8")
    assert "Tenhle odkaz nefunguje" in html
    assert (
        "Odkazu chybí kód. Otevři e-mail znovu a klepni na tlačítko, "
        "nebo si v appce řekni o nový."
    ) in html


@pytest.mark.django_db
def test_reset_password_landing_page_url_encodes_token(client):
    resp = client.get("/v1/auth/reset", data={"token": "abc&next=value"})

    assert resp.status_code == status.HTTP_200_OK
    assert 'href="napivo://auth/reset?token=abc%26next%3Dvalue"' in resp.content.decode(
        "utf-8"
    )


@pytest.mark.django_db
def test_request_password_reset_unknown_email_still_202_no_token(client):
    resp = client.post(
        "/v1/auth/request-password-reset", data={"email": "nobody@x.cz"}, format="json"
    )
    assert resp.status_code == status.HTTP_202_ACCEPTED  # no enumeration
    assert OneTimeToken.objects.filter(
        purpose=OneTimeToken.Purpose.RESET_PASSWORD
    ).count() == 0


@pytest.mark.django_db
def test_reset_password_consumes_token_sets_new_and_revokes_old_sessions(client, sent_emails):
    _, old_token = _register_and_token(client, "rp@x.cz", "Tr0ub4dor&3")
    sent_emails.clear()
    client.post("/v1/auth/request-password-reset", data={"email": "rp@x.cz"}, format="json")
    raw = _verify_code(sent_emails, "reset")

    resp = client.post(
        "/v1/auth/reset-password",
        data={"token": raw, "password": "NewP@ssw0rd!"},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["token"]  # fresh session issued

    # The previously-issued session token was revoked by the reset.
    assert client.get("/v1/account/me", **_auth(old_token)).status_code == status.HTTP_401_UNAUTHORIZED

    # New password works; old one does not.
    good = client.post(
        "/v1/auth/login", data={"email": "rp@x.cz", "password": "NewP@ssw0rd!"}, format="json"
    )
    assert good.status_code == status.HTTP_200_OK
    bad = client.post(
        "/v1/auth/login", data={"email": "rp@x.cz", "password": "Tr0ub4dor&3"}, format="json"
    )
    assert bad.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_weak_password_does_not_consume_reset_link(client, sent_emails):
    _register_and_token(client, "reset-retry@x.cz", "Tr0ub4dor&3")
    sent_emails.clear()
    client.post(
        "/v1/auth/request-password-reset",
        data={"email": "reset-retry@x.cz"},
        format="json",
    )
    raw = _verify_code(sent_emails, "reset")
    reset_token = OneTimeToken.objects.get(
        token_hash=accounts.hash_account_token(raw),
        purpose=OneTimeToken.Purpose.RESET_PASSWORD,
    )

    weak = client.post(
        "/v1/auth/reset-password",
        data={"token": raw, "password": "12345678"},
        format="json",
    )
    reset_token.refresh_from_db()

    assert weak.status_code == status.HTTP_400_BAD_REQUEST
    assert weak.json()["code"] == "weak_password"
    assert reset_token.used_at is None

    strong = client.post(
        "/v1/auth/reset-password",
        data={"token": raw, "password": "FreshP@ssw0rd!"},
        format="json",
    )
    reset_token.refresh_from_db()

    assert strong.status_code == status.HTTP_200_OK, strong.content
    assert strong.json()["token"]
    assert reset_token.used_at is not None


@pytest.mark.django_db
def test_reset_password_rolls_back_every_change_when_session_issue_fails(
    client,
    sent_emails,
    monkeypatch,
):
    _, old_session = _register_and_token(
        client,
        "reset-rollback@x.cz",
        "Tr0ub4dor&3",
    )
    account = EmailCredential.objects.get(email="reset-rollback@x.cz").account
    credential = account.email_credential
    old_password_hash = credential.password
    old_verified = credential.email_verified
    old_epoch = account.deletion_epoch
    old_token_ids = set(account.auth_tokens.values_list("pk", flat=True))
    sent_emails.clear()
    client.post(
        "/v1/auth/request-password-reset",
        data={"email": "reset-rollback@x.cz"},
        format="json",
    )
    raw = _verify_code(sent_emails, "reset")
    reset_token = OneTimeToken.objects.get(
        token_hash=accounts.hash_account_token(raw),
        purpose=OneTimeToken.Purpose.RESET_PASSWORD,
    )

    def fail_issue_token(*_args, **_kwargs):
        raise RuntimeError("forced fresh-session failure")

    monkeypatch.setattr(accounts, "issue_token", fail_issue_token)
    failed = client.post(
        "/v1/auth/reset-password",
        data={"token": raw, "password": "FreshP@ssw0rd!"},
        format="json",
    )

    account.refresh_from_db()
    credential.refresh_from_db()
    reset_token.refresh_from_db()
    assert failed.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert reset_token.used_at is None
    assert credential.password == old_password_hash
    assert credential.email_verified is old_verified
    assert account.deletion_epoch == old_epoch
    assert set(account.auth_tokens.values_list("pk", flat=True)) == old_token_ids
    assert client.get("/v1/account/me", **_auth(old_session)).status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_reset_password_with_bogus_token_returns_400(client):
    resp = client.post(
        "/v1/auth/reset-password",
        data={"token": "not-a-real-token", "password": "NewP@ssw0rd!"},
        format="json",
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "token_invalid"


# ===========================================================================
# 11. Email verification (request + consume)
# ===========================================================================


@pytest.mark.django_db
def test_email_unverified_after_register_then_verifies(client, sent_emails):
    _, token = _register_and_token(client, "verify@x.cz", "Tr0ub4dor&3")
    me = client.get("/v1/account/me", **_auth(token))
    assert me.json()["email_verified"] is False

    # Register already sent one verification email; capture its code.
    raw = _verify_code(sent_emails, "verify")
    resp = client.post("/v1/auth/verify-email", data={"token": raw}, format="json")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["ok"] is True

    me2 = client.get("/v1/account/me", **_auth(token))
    assert me2.json()["email_verified"] is True


@pytest.mark.django_db
def test_request_email_verify_resends(client, sent_emails):
    _, token = _register_and_token(client, "rev@x.cz", "Tr0ub4dor&3")
    before = sum(1 for r in sent_emails if r["tag"] == "verify")

    resp = client.post("/v1/auth/request-email-verify", data={}, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_202_ACCEPTED
    after = sum(1 for r in sent_emails if r["tag"] == "verify")
    assert after == before + 1


@pytest.mark.django_db
def test_verification_email_uses_web_action_link(client, sent_emails):
    _register_and_token(client, "web-link@x.cz", "Tr0ub4dor&3")
    record = _email_record(sent_emails, "verify")

    link = record["link"]
    assert link.startswith("http://testserver/v1/auth/verify-email?")
    assert f"token={record['code']}" in link
    assert not link.startswith("napivo://")


@pytest.mark.django_db
def test_verify_email_get_link_consumes_token(client, sent_emails):
    _, token = _register_and_token(client, "web-consume@x.cz", "Tr0ub4dor&3")
    link = _email_record(sent_emails, "verify")["link"]
    parsed = urlsplit(link)

    resp = client.get(f"{parsed.path}?{parsed.query}")

    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp["Content-Type"].startswith("text/html")
    assert "E-mail ověřen" in resp.content.decode("utf-8")
    assert client.get("/v1/account/me", **_auth(token)).json()["email_verified"] is True


@pytest.mark.django_db
def test_verify_email_get_link_rejects_bad_token(client):
    resp = client.get("/v1/auth/verify-email?token=bogus")

    assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.content
    assert resp["Content-Type"].startswith("text/html")
    assert "Ověření se nezdařilo" in resp.content.decode("utf-8")


@pytest.mark.django_db
def test_verify_email_with_bogus_token_returns_400(client):
    resp = client.post("/v1/auth/verify-email", data={"token": "bogus"}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "token_invalid"


@pytest.mark.django_db
def test_verify_email_token_cannot_be_replayed(client, sent_emails):
    _, token = _register_and_token(client, "replay@x.cz", "Tr0ub4dor&3")
    raw = _verify_code(sent_emails, "verify")

    first = client.post("/v1/auth/verify-email", data={"token": raw}, format="json")
    second = client.post("/v1/auth/verify-email", data={"token": raw}, format="json")

    assert first.status_code == status.HTTP_200_OK, first.content
    assert second.status_code == status.HTTP_400_BAD_REQUEST, second.content
    assert second.json()["code"] == "token_invalid"
    account = EmailCredential.objects.get(email="replay@x.cz").account
    assert account.email_is_verified is True
    assert OneTimeToken.objects.get(account=account).used_at is not None
    assert client.get("/v1/account/me", **_auth(token)).json()["email_verified"] is True


# ===========================================================================
# 12. Account deletion (soft-delete + purge)
# ===========================================================================


@pytest.mark.django_db
def test_stale_device_token_cannot_launder_new_deletion_epoch(
    client,
    sent_emails,
):
    stale_device_token, account_id = _bootstrap_anon(client)
    account = Account.objects.get(public_id=account_id)
    stale_epoch = AuthToken.objects.get(
        account=account,
        token_hash=accounts.hash_account_token(stale_device_token),
    ).deletion_epoch

    claimed = _register(
        client,
        "epoch-laundering@x.cz",
        token=stale_device_token,
    )
    assert claimed.status_code == status.HTTP_201_CREATED, claimed.content
    account.refresh_from_db()
    assert account.deletion_epoch > stale_epoch

    rotated = client.post(
        "/v1/account",
        data={"device_id": account.device_id},
        format="json",
        **_auth(stale_device_token),
    )

    assert rotated.status_code == status.HTTP_409_CONFLICT
    assert rotated.json()["code"] == "stale_account_session"
    assert "token" not in rotated.json()
    assert not AuthToken.objects.filter(
        account=account,
        kind=AuthToken.Kind.DEVICE,
        deletion_epoch=account.deletion_epoch,
    ).exists()

    deletion = client.delete(
        "/v1/account/me",
        data={"operation_id": str(uuid.uuid4())},
        format="json",
        **_auth(stale_device_token),
    )
    assert deletion.status_code == status.HTTP_409_CONFLICT
    assert deletion.json()["code"] == "deletion_epoch_cancelled"
    account.refresh_from_db()
    assert account.status == Account.Status.ACTIVE


@pytest.mark.django_db
def test_delete_account_soft_deletes_and_revokes_token(client, fake_oauth, sent_emails):
    _, token = _register_and_token(client, "del@x.cz", "Tr0ub4dor&3")
    account = EmailCredential.objects.get(email="del@x.cz").account
    # CASCADE-bound personal data that must survive until the purge.
    drink = DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbnhz",
        name="Pub",
        lat=50.0,
        lng=14.0,
        beer_name="Plzeň",
        price_czk=50,
        drank_at="2026-06-01T18:00:00Z",
    )
    push_device = PushDevice.objects.create(
        account=account,
        push_token="ExponentPushToken[deleteAccount]",
        platform=PushDevice.Platform.IOS,
        permission_status=PushDevice.PermissionStatus.GRANTED,
        enabled=True,
    )

    resp = client.delete("/v1/account/me", **_auth(token))
    assert resp.status_code == status.HTTP_204_NO_CONTENT

    account.refresh_from_db()
    push_device.refresh_from_db()
    assert account.status == Account.Status.PENDING_DELETION
    assert account.deleted_at is not None
    assert push_device.enabled is False
    assert push_device.permission_status == PushDevice.PermissionStatus.DENIED

    # Token no longer authenticates. NOTE: schedule_deletion REVOKES (deletes)
    # all AuthToken rows before flipping status, so the presented token is gone
    # from the table → AccountTokenAuthentication answers "Invalid account token."
    # (it never reaches the "Account is no longer active." branch, which only
    # fires when a live token still points at a non-active account). Either way
    # the security guarantee — 401, no access — holds.
    me = client.get("/v1/account/me", **_auth(token))
    assert me.status_code == status.HTTP_401_UNAUTHORIZED
    assert me.json()["detail"] == "Invalid account token."

    # Tokens were revoked on schedule_deletion.
    assert AuthToken.objects.filter(account=account).count() == 0
    # CASCADE data still exists until purge.
    assert DrinkLog.objects.filter(pk=drink.pk).exists()


@pytest.mark.django_db
def test_live_token_on_non_active_account_is_rejected(client, sent_emails):
    """Directly exercise the AccountTokenAuthentication non-active guard.

    A token that outlives a status flip to PENDING_DELETION (i.e. without the
    token being revoked first) must still be refused with the dedicated message.
    """
    _, token = _register_and_token(client, "guard@x.cz", "Tr0ub4dor&3")
    account = EmailCredential.objects.get(email="guard@x.cz").account
    # Flip status WITHOUT revoking the token (bypass schedule_deletion).
    Account.objects.filter(pk=account.pk).update(status=Account.Status.PENDING_DELETION)

    me = client.get("/v1/account/me", **_auth(token))
    assert me.status_code == status.HTTP_401_UNAUTHORIZED
    assert me.json()["detail"] == "Account is no longer active."


@pytest.mark.django_db
def test_delete_account_with_apple_identity_revokes_apple_token(client, fake_oauth, sent_emails):
    # Apple-only account with a stored refresh token.
    resp = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-DEL:ad@x.cz",
            "authorization_code": "code",
        },
        format="json",
    )
    token = resp.json()["token"]
    assert AuthIdentity.objects.get(subject="A-DEL").apple_refresh_token == "rt_test"

    deleted = client.delete("/v1/account/me", **_auth(token))
    assert deleted.status_code == status.HTTP_204_NO_CONTENT
    assert "rt_test" in fake_oauth["revoked"]


@pytest.mark.django_db(transaction=True)
def test_purge_command_hard_deletes_after_grace(client, fake_oauth, sent_emails):
    _, token = _register_and_token(client, "purge@x.cz", "Tr0ub4dor&3")
    account = EmailCredential.objects.get(email="purge@x.cz").account
    account_pk = account.pk

    client.delete("/v1/account/me", **_auth(token))
    account.refresh_from_db()
    assert account.status == Account.Status.PENDING_DELETION

    # --grace-days 0 makes every pending account immediately eligible.
    call_command("purge_deleted_accounts", "--grace-days", "0")

    with pytest.raises(Account.DoesNotExist):
        Account.objects.get(pk=account_pk)
    # CASCADE wiped the credential too.
    assert not EmailCredential.objects.filter(email="purge@x.cz").exists()
    assert any(message["tag"] == "deleted" for message in sent_emails)


@pytest.mark.django_db(transaction=True)
def test_purge_command_deletes_avatar_file_after_grace(
    client, fake_oauth, sent_emails, tmp_media
):
    _, token = _register_and_token(client, "purge-avatar@x.cz", "Tr0ub4dor&3")
    account = EmailCredential.objects.get(email="purge-avatar@x.cz").account
    account_pk = account.pk
    avatars_dir = tmp_media / "avatars"
    avatars_dir.mkdir()
    avatar_path = avatars_dir / f"{account.public_id}.webp"
    avatar_path.write_bytes(b"avatar")
    account.avatar = f"avatars/{account.public_id}.webp"
    account.save(update_fields=["avatar"])

    client.delete("/v1/account/me", **_auth(token))
    assert avatar_path.exists()

    call_command("purge_deleted_accounts", "--grace-days", "0")

    assert not avatar_path.exists()
    assert not BeerPhotoFileDeletion.objects.exists()
    with pytest.raises(Account.DoesNotExist):
        Account.objects.get(pk=account_pk)


@pytest.mark.django_db(transaction=True)
def test_purge_keeps_apple_account_when_revocation_fails(
    client, fake_oauth, sent_emails, monkeypatch
):
    resp = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-PURGE-FAIL:pf@x.cz",
            "authorization_code": "code",
        },
        format="json",
    )
    token = resp.json()["token"]
    identity = AuthIdentity.objects.get(subject="A-PURGE-FAIL")
    account_pk = identity.account_id

    def fail_revoke(token: str, token_type_hint: str = "refresh_token") -> None:
        raise oauth.OAuthError("apple down")

    monkeypatch.setattr(oauth, "revoke_apple_token", fail_revoke)

    deleted = client.delete("/v1/account/me", **_auth(token))
    assert deleted.status_code == status.HTTP_204_NO_CONTENT

    call_command("purge_deleted_accounts", "--grace-days", "0")

    assert Account.objects.filter(pk=account_pk).exists()
    identity.refresh_from_db()
    assert identity.apple_refresh_token == "rt_test"


@pytest.mark.django_db(transaction=True)
def test_purge_rechecks_stale_candidate_after_concurrent_reauthentication(
    client,
    fake_oauth,
    sent_emails,
    monkeypatch,
):
    email = "purge-race@x.cz"
    password = "Tr0ub4dor&3"
    _, token = _register_and_token(client, email, password)
    account = EmailCredential.objects.get(email=email).account
    drink = DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbnhz",
        name="U zámku",
        lat=50.0,
        lng=14.0,
        beer_name="Ležák",
        price_czk=55,
        drank_at="2026-06-01T18:00:00Z",
    )
    assert client.delete("/v1/account/me", **_auth(token)).status_code == status.HTTP_204_NO_CONTENT
    account.refresh_from_db()
    stale_epoch = account.deletion_epoch
    sent_emails.clear()

    real_purge = accounts.hard_delete_expired_account
    fresh_token: list[str] = []
    interleavings = 0

    def reauthenticate_before_locked_recheck(
        account_id: int,
        *,
        cutoff,
        expected_deletion_epoch: int,
    ) -> bool:
        nonlocal interleavings
        interleavings += 1
        assert account_id == account.pk
        assert expected_deletion_epoch == stale_epoch
        login = client.post(
            "/v1/auth/login",
            data={"email": email, "password": password},
            format="json",
        )
        assert login.status_code == status.HTTP_200_OK, login.content
        fresh_token.append(login.json()["token"])
        return real_purge(
            account_id,
            cutoff=cutoff,
            expected_deletion_epoch=expected_deletion_epoch,
        )

    monkeypatch.setattr(
        accounts,
        "hard_delete_expired_account",
        reauthenticate_before_locked_recheck,
    )

    # Deterministic race ordering: command snapshots pending A, credential login
    # commits ACTIVE + epoch+1, then the purge helper locks and rechecks A.
    call_command("purge_deleted_accounts", "--grace-days", "0")

    assert interleavings == 1
    account.refresh_from_db()
    assert account.status == Account.Status.ACTIVE
    assert account.deletion_epoch > stale_epoch
    assert DrinkLog.objects.filter(pk=drink.pk, account=account).exists()
    assert client.get("/v1/account/me", **_auth(fresh_token[0])).status_code == status.HTTP_200_OK
    assert not any(message["tag"] == "deleted" for message in sent_emails)


@pytest.mark.django_db(transaction=True)
def test_hard_delete_rollback_keeps_database_files_and_confirmation_unsent(
    client,
    fake_oauth,
    sent_emails,
    tmp_media,
    monkeypatch,
):
    email = "purge-rollback@x.cz"
    _, token = _register_and_token(client, email, "Tr0ub4dor&3")
    account = EmailCredential.objects.get(email=email).account
    account.avatar = SimpleUploadedFile("avatar.webp", b"avatar-before-rollback")
    account.save(update_fields=["avatar"])
    photo = BeerPhoto.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        image=SimpleUploadedFile("beer.webp", b"photo-before-rollback"),
    )
    avatar_path = Path(account.avatar.path)
    photo_path = Path(photo.image.path)
    account_pk = account.pk

    assert client.delete("/v1/account/me", **_auth(token)).status_code == status.HTTP_204_NO_CONTENT
    account.refresh_from_db()
    sent_emails.clear()

    def fail_database_delete(self, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        raise RuntimeError("forced database delete failure")

    monkeypatch.setattr(Account, "delete", fail_database_delete)

    with pytest.raises(RuntimeError, match="forced database delete failure"):
        accounts.hard_delete_expired_account(
            account_pk,
            cutoff=timezone.now(),
            expected_deletion_epoch=account.deletion_epoch,
        )

    account.refresh_from_db()
    photo.refresh_from_db()
    assert account.status == Account.Status.PENDING_DELETION
    assert EmailCredential.objects.filter(account=account, email=email).exists()
    assert BeerPhoto.objects.filter(pk=photo.pk, account=account).exists()
    assert avatar_path.exists()
    assert photo_path.exists()
    assert not BeerPhotoFileDeletion.objects.exists()
    assert not any(message["tag"] == "deleted" for message in sent_emails)


@pytest.mark.django_db(transaction=True)
def test_hard_delete_keeps_failed_media_cleanup_durable_after_account_is_gone(
    client,
    fake_oauth,
    sent_emails,
    tmp_media,
    monkeypatch,
):
    email = "purge-media-retry@x.cz"
    _, token = _register_and_token(client, email, "Tr0ub4dor&3")
    account = EmailCredential.objects.get(email=email).account
    account.avatar = SimpleUploadedFile("avatar.webp", b"avatar-retry")
    account.save(update_fields=["avatar"])
    photo = BeerPhoto.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        image=SimpleUploadedFile("beer.webp", b"photo-retry"),
    )
    feedback = FeedbackReport.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        category=FeedbackReport.Category.OTHER,
        message="Support audit remains",
        contact_type=FeedbackReport.ContactType.EMAIL,
        contact="delete-me@example.com",
        attachment=SimpleUploadedFile("feedback.webp", b"feedback-retry"),
        attachment_url="https://media.na-pivo.cz/feedback/feedback.webp",
    )
    avatar_path = Path(account.avatar.path)
    photo_path = Path(photo.image.path)
    feedback_path = Path(feedback.attachment.path)
    feedback_pk = feedback.pk
    account_pk = account.pk
    storages = {
        id(storage): storage
        for storage in (
            Account._meta.get_field("avatar").storage,
            BeerPhoto._meta.get_field("image").storage,
            FeedbackReport._meta.get_field("attachment").storage,
        )
    }
    original_deletes = {
        storage_id: storage.delete for storage_id, storage in storages.items()
    }

    assert client.delete("/v1/account/me", **_auth(token)).status_code == status.HTTP_204_NO_CONTENT
    sent_emails.clear()
    for storage in storages.values():
        monkeypatch.setattr(
            storage,
            "delete",
            lambda _name: (_ for _ in ()).throw(OSError("media unavailable")),
        )

    call_command("purge_deleted_accounts", "--grace-days", "0")

    assert not Account.objects.filter(pk=account_pk).exists()
    assert avatar_path.exists()
    assert photo_path.exists()
    assert feedback_path.exists()
    pending = list(BeerPhotoFileDeletion.objects.order_by("file_kind"))
    assert len(pending) == 3
    assert {item.file_kind for item in pending} == {
        BeerPhotoFileDeletion.FileKind.AVATAR,
        BeerPhotoFileDeletion.FileKind.BEER_PHOTO,
        BeerPhotoFileDeletion.FileKind.FEEDBACK_ATTACHMENT,
    }
    assert all(item.account_id is None for item in pending)
    assert all(item.last_attempted_at is not None for item in pending)
    feedback_deletion = next(
        item
        for item in pending
        if item.file_kind == BeerPhotoFileDeletion.FileKind.FEEDBACK_ATTACHMENT
    )
    assert feedback_deletion.client_id is None
    assert feedback_deletion.photo_public_id is None
    assert any(message["tag"] == "deleted" for message in sent_emails)

    # The feedback report row is purged with its author; only the durable
    # failed-attachment cleanup above survives.
    assert not FeedbackReport.objects.filter(pk=feedback_pk).exists()

    for storage_id, storage in storages.items():
        monkeypatch.setattr(storage, "delete", original_deletes[storage_id])
    BeerPhotoFileDeletion.objects.update(
        last_attempted_at=timezone.now() - timedelta(minutes=16)
    )
    call_command("retry_beer_photo_deletions")

    assert not avatar_path.exists()
    assert not photo_path.exists()
    assert not feedback_path.exists()
    assert not BeerPhotoFileDeletion.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_deletion_scheduled_email_waits_for_outer_commit(
    client,
    sent_emails,
):
    email = "delete-email-rollback@x.cz"
    _, _token = _register_and_token(client, email, "Tr0ub4dor&3")
    account = EmailCredential.objects.get(email=email).account
    sent_emails.clear()

    with pytest.raises(RuntimeError, match="late transaction failure"):
        with transaction.atomic():
            accounts.schedule_deletion(account)
            raise RuntimeError("late transaction failure")

    account.refresh_from_db()
    assert account.status == Account.Status.ACTIVE
    assert account.deleted_at is None
    assert account.auth_tokens.exists()
    assert not any(message["tag"] == "deletion_scheduled" for message in sent_emails)
