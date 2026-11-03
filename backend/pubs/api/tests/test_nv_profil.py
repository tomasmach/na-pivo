"""Contracts the new-look profile reads: XP history, invite preview, party evenings."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.api.profile_helpers import (
    PRAGUE_TZ,
    derive_account_badge_progress,
    derive_account_profile_stats,
)
from pubs.api.stats import drinking_day
from pubs.models import (
    Account,
    FriendBlock,
    FriendInviteCode,
    Friendship,
    PartyEvening,
    PartyEveningMember,
    PublishedNight,
    PubVisit,
    XpEvent,
)

_LAT = 50.0876
_LNG = 14.4214


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient, nickname: str = "", *, is_public: bool = True) -> tuple[str, Account]:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    account = Account.objects.get(public_id=resp.json()["id"])
    if nickname:
        account.nickname = nickname
        account.is_public = is_public
        account.save(update_fields=["nickname", "is_public"])
    return resp.json()["token"], account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _befriend(a: Account, b: Account) -> None:
    Friendship.objects.create(requester=a, recipient=b, status=Friendship.Status.ACCEPTED)


def _visit(account: Account, at: datetime, cache_key: str = "u2fkbn1z") -> None:
    PubVisit.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name="U Zlatého tygra",
        lat=_LAT,
        lng=_LNG,
        city="Praha",
        started_at=at,
        client_updated_at=at,
    )


def _drink_payload() -> dict:
    # The released counter's payload: no field added for the XP log.
    return {
        "client_id": str(uuid.uuid4()),
        "name": "U Zlatého tygra",
        "lat": _LAT,
        "lng": _LNG,
        "city": "Praha",
        "external_id": "mapy:50.08755,14.42141",
        "beer": {"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500},
        "drank_at": timezone.now().replace(microsecond=0).isoformat(),
    }


# --- XP history -------------------------------------------------------------


@pytest.mark.django_db
def test_released_drink_payload_still_logs_and_explains_its_xp(client):
    token, _account = _register(client)
    logged = client.post("/v1/drinks", data=_drink_payload(), format="json", **_auth(token))
    assert logged.status_code == status.HTTP_201_CREATED
    awarded = logged.json()["pivar"]["xp_awarded"]
    assert awarded > 0

    response = client.get("/v1/account/me/xp-events", **_auth(token))

    assert response.status_code == status.HTTP_200_OK
    [event] = response.json()["events"]
    assert event["reason"] == "drink"
    assert event["amount"] == awarded
    assert event["pub_name"] == "U Zlatého tygra"
    assert set(event) == {"reason", "amount", "cache_key", "pub_name", "created_at"}


@pytest.mark.django_db
def test_xp_events_since_filters_and_prunes_old_rows(client):
    token, account = _register(client)
    now = timezone.now()
    XpEvent.objects.create(account=account, reason="mapping", amount=20, created_at=now - timedelta(days=200))
    XpEvent.objects.create(account=account, reason="mapping", amount=15, created_at=now - timedelta(days=2))
    XpEvent.objects.create(account=account, reason="photo", amount=10, created_at=now - timedelta(minutes=5))

    since = (now - timedelta(days=1)).isoformat()
    recent = client.get("/v1/account/me/xp-events", {"since": since}, **_auth(token))
    everything = client.get("/v1/account/me/xp-events", {"since": "not-a-date"}, **_auth(token))

    assert [e["amount"] for e in recent.json()["events"]] == [10]
    assert [e["amount"] for e in everything.json()["events"]] == [10, 15]
    assert XpEvent.objects.filter(account=account).count() == 2


@pytest.mark.django_db
def test_xp_events_are_private_to_the_owner(client):
    assert client.get("/v1/account/me/xp-events").status_code == status.HTTP_401_UNAUTHORIZED
    _owner_token, owner = _register(client)
    XpEvent.objects.create(account=owner, reason="drink", amount=50)
    other_token, _other = _register(client)

    response = client.get("/v1/account/me/xp-events", **_auth(other_token))

    assert response.json() == {"events": []}


# --- Night summary (receipt) ------------------------------------------------

# What the drink write answered before the night summary existed.
_RELEASED_DRINK_RESPONSE_KEYS = {
    "accepted",
    "duplicate",
    "limited",
    "cache_key",
    "place_context",
    "serving_type",
    "menu_updated",
    "pivar",
}
_RELEASED_PIVAR_KEYS = {"level", "title", "xp", "xp_awarded", "xp_for_next_level", "xp_into_level"}


def _drink_at(at: datetime, *, pub: str = "U Zlatého tygra", lat: float = _LAT) -> dict:
    return {
        **_drink_payload(),
        "name": pub,
        "lat": lat,
        "external_id": f"mapy:{lat},{_LNG}",
        "drank_at": at.replace(microsecond=0).isoformat(),
    }


def _prague(day: date, hour: int) -> datetime:
    return datetime(day.year, day.month, day.day, hour, tzinfo=PRAGUE_TZ)


@pytest.mark.django_db
def test_released_drink_payload_answers_as_before_and_feeds_the_night_xp(client):
    token, _account = _register(client)
    logged = client.post("/v1/drinks", data=_drink_payload(), format="json", **_auth(token))

    assert logged.status_code == status.HTTP_201_CREATED
    body = logged.json()
    # Released apps read these keys; the XP stored on the drink stays server-side.
    assert set(body) == _RELEASED_DRINK_RESPONSE_KEYS
    assert set(body["pivar"]) == _RELEASED_PIVAR_KEYS
    day = drinking_day(timezone.now())
    summary = client.get("/v1/account/me/night-summary", {"day": day.isoformat()}, **_auth(token))
    assert summary.status_code == status.HTTP_200_OK
    assert summary.json()["day"] == day.isoformat()
    assert summary.json()["xp"] == body["pivar"]["xp_awarded"] > 0


@pytest.mark.django_db
def test_night_summary_counts_a_backfilled_beer_on_its_own_night(client):
    token, _account = _register(client)
    night = drinking_day(timezone.now()) - timedelta(days=2)
    late = _prague(night + timedelta(days=1), 2)  # 2 a.m. still belongs to the night before
    logged = client.post("/v1/drinks", data=_drink_at(late), format="json", **_auth(token))
    assert logged.status_code == status.HTTP_201_CREATED

    that_night = client.get("/v1/account/me/night-summary", {"day": night.isoformat()}, **_auth(token))
    next_day = client.get(
        "/v1/account/me/night-summary", {"day": (night + timedelta(days=1)).isoformat()}, **_auth(token)
    )

    assert that_night.json()["xp"] == logged.json()["pivar"]["xp_awarded"] > 0
    assert next_day.json()["xp"] == 0


@pytest.mark.django_db
def test_night_summary_shows_badge_progress_before_and_after_the_night(client):
    token, account = _register(client)
    first = drinking_day(timezone.now()) - timedelta(days=3)
    night = first + timedelta(days=1)
    for at, pub, lat in (
        (_prague(first, 20), "U Zlatého tygra", _LAT),
        (_prague(night, 19), "Lokál Dlouhá", 50.0903),
        (_prague(night, 21), "U Pinkasů", 50.0832),
        (_prague(night + timedelta(days=1), 20), "U Fleků", 50.0789),
    ):
        response = client.post("/v1/drinks", data=_drink_at(at, pub=pub, lat=lat), format="json", **_auth(token))
        assert response.status_code == status.HTTP_201_CREATED

    body = client.get("/v1/account/me/night-summary", {"day": night.isoformat()}, **_auth(token)).json()

    assert (body["badge_progress_before"]["beers"], body["badge_progress"]["beers"]) == (1, 3)
    assert (body["badge_progress_before"]["distinct_pubs"], body["badge_progress"]["distinct_pubs"]) == (1, 3)
    # Same keys as the profile's badge_progress, so the app reuses its tier math.
    assert set(body["badge_progress"]) == set(body["badge_progress_before"]) == set(
        derive_account_badge_progress(derive_account_profile_stats(account))
    )


@pytest.mark.django_db
def test_night_summary_is_private_and_needs_a_day(client):
    day = drinking_day(timezone.now()).isoformat()
    assert client.get("/v1/account/me/night-summary", {"day": day}).status_code == status.HTTP_401_UNAUTHORIZED
    owner_token, _owner = _register(client)
    client.post("/v1/drinks", data=_drink_payload(), format="json", **_auth(owner_token))
    other_token, _other = _register(client)

    other = client.get("/v1/account/me/night-summary", {"day": day}, **_auth(other_token))
    malformed = client.get("/v1/account/me/night-summary", {"day": "včera"}, **_auth(other_token))

    assert other.json()["xp"] == 0
    assert other.json()["badge_progress"]["beers"] == 0
    assert malformed.status_code == status.HTTP_400_BAD_REQUEST


# --- Invite preview ---------------------------------------------------------


def _invite(account: Account) -> str:
    code = FriendInviteCode.objects.create(
        account=account, code=uuid.uuid4().hex[:12], expires_at=timezone.now() + timedelta(days=7)
    )
    return code.code


@pytest.mark.django_db
def test_invite_resolve_adds_public_stats_and_mutual_friends(client):
    _inviter_token, inviter = _register(client, "klara")
    token, me = _register(client, "tomas")
    _, jirka = _register(client, "jirka")
    _, marek = _register(client, "marek")
    _, stranger = _register(client, "cizi")
    _, blocked = _register(client, "troll")
    for friend in (jirka, marek, blocked):
        _befriend(inviter, friend)
        _befriend(me, friend)
    _befriend(inviter, stranger)
    FriendBlock.objects.create(blocker=me, blocked=blocked)
    now = timezone.now()
    PublishedNight.objects.create(
        account=inviter,
        client_id=str(uuid.uuid4()),
        visibility=PublishedNight.Visibility.PUBLIC,
        drinking_day=now.date(),
        started_at=now - timedelta(hours=3),
        ended_at=now,
        beer_count=4,
        wine_count=0,
        soft_drink_count=0,
        shot_count=0,
        pub_names=["U Pinkasů"],
        updated_at=now,
    )

    response = client.get(f"/v1/friends/invite/{_invite(inviter)}", **_auth(token))

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    # The released claim screen reads exactly these.
    assert body["valid"] is True and body["expired"] is False
    assert body["inviter"]["nickname"] == "klara"
    assert body["public_stats"]["total_beers"] == 4
    assert body["public_stats"]["distinct_pubs"] == 1
    assert body["public_stats"]["badge_progress"]["beers"] == 4
    assert body["mutual_friends"]["count"] == 2
    assert [p["nickname"] for p in body["mutual_friends"]["profiles"]] == ["jirka", "marek"]


@pytest.mark.django_db
def test_invite_resolve_hides_stats_of_a_private_profile(client):
    _, inviter = _register(client, "klara", is_public=False)
    token, _me = _register(client, "tomas")

    body = client.get(f"/v1/friends/invite/{_invite(inviter)}", **_auth(token)).json()

    assert body["public_stats"] is None
    assert body["mutual_friends"] == {"count": 0, "profiles": []}


# --- Večer s partou ---------------------------------------------------------


@pytest.mark.django_db
def test_party_evenings_count_days_shared_with_a_friend(client):
    _, me = _register(client, "tomas")
    _, friend = _register(client, "jirka")
    _, stranger = _register(client, "cizi")
    _befriend(me, friend)
    evening = datetime.fromisoformat("2026-06-12T19:00:00+00:00")
    # Same pub, same drinking day (the friend arrives after midnight).
    _visit(me, evening)
    _visit(friend, evening + timedelta(hours=5))
    # Same pub, but the stranger is not a friend.
    _visit(me, evening + timedelta(days=3))
    _visit(stranger, evening + timedelta(days=3))
    # Friend at a different pub that day.
    _visit(me, evening + timedelta(days=5))
    _visit(friend, evening + timedelta(days=5), cache_key="u2fkbn2a")
    # A shared party table on another day.
    table = PartyEvening.objects.create(
        client_id=uuid.uuid4(),
        join_code="ABCD1234",
        host=friend,
        pub_name="U Pinkasů",
        started_at=evening + timedelta(days=7),
    )
    PartyEveningMember.objects.create(evening=table, account=me)
    PartyEveningMember.objects.create(evening=table, account=friend)

    progress = derive_account_badge_progress(derive_account_profile_stats(me))

    assert progress["party_evenings"] == 2


@pytest.mark.django_db
def test_night_summary_counts_party_evenings_only_up_to_the_night(client):
    token, me = _register(client, "tomas")
    _, friend = _register(client, "jirka")
    _befriend(me, friend)
    night = drinking_day(timezone.now()) - timedelta(days=5)
    # The night itself, with the friend arriving after midnight.
    _visit(me, _prague(night, 20))
    _visit(friend, _prague(night + timedelta(days=1), 1))
    # A later shared night must not leak into this night's receipt.
    _visit(me, _prague(night + timedelta(days=2), 20))
    _visit(friend, _prague(night + timedelta(days=2), 21))
    later_table = PartyEvening.objects.create(
        client_id=uuid.uuid4(),
        join_code="LATER123",
        host=friend,
        pub_name="U Pinkasů",
        started_at=_prague(night + timedelta(days=3), 20),
    )
    PartyEveningMember.objects.create(evening=later_table, account=me)
    PartyEveningMember.objects.create(evening=later_table, account=friend)

    body = client.get("/v1/account/me/night-summary", {"day": night.isoformat()}, **_auth(token)).json()

    assert body["badge_progress_before"]["party_evenings"] == 0
    assert body["badge_progress"]["party_evenings"] == 1
    assert derive_account_badge_progress(derive_account_profile_stats(me))["party_evenings"] == 3


@pytest.mark.django_db
def test_account_me_sends_party_evenings_additively(client):
    token, _me = _register(client)

    body = client.get("/v1/account/me", **_auth(token)).json()

    assert body["badge_progress"]["party_evenings"] == 0
    assert body["badge_progress"]["friends"] == 0
