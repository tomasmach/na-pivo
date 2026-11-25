"""GET /v1/drinks and /v1/pub-visits with ``?since=``: only what changed since the app's last read.

Released apps never send ``since`` and must keep getting the same full snapshot.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from pubs.enrichment import geohash8
from pubs.models import (
    Account,
    CanonicalPub,
    DrinkLog,
    EmailCredential,
    OfflineMutationTombstone,
    PubAlias,
    PubVisit,
)

_NAME = "U Zlatého tygra"
_LAT = 50.0876
_LNG = 14.4214
_KEY = geohash8(_LAT, _LNG)
_RELEASED_HEADERS = {"HTTP_X_NA_PIVO_APP_VERSION": "2.4.0", "HTTP_X_NA_PIVO_PLATFORM": "ios"}


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def client():
    return APIClient()


def _anonymous(client: APIClient) -> tuple[str, Account]:
    response = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert response.status_code == 201
    return response.json()["token"], Account.objects.get(public_id=response.json()["id"])


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}", **_RELEASED_HEADERS}


def _drink(client, token, client_id=None, **beer):
    """The payload a released 2.x counter queues for a pub beer."""
    client_id = client_id or str(uuid.uuid4())
    response = client.post(
        "/v1/drinks",
        data={
            "client_id": client_id,
            "name": _NAME,
            "lat": _LAT,
            "lng": _LNG,
            "city": "Praha",
            "external_id": "mapy:1",
            "beer": {"name": "Plzeň", "price_czk": 62, "volume_ml": 500, **beer},
            "drank_at": (timezone.now() - timedelta(hours=1)).isoformat(),
        },
        format="json",
        **_auth(token),
    )
    assert response.status_code in (200, 201), response.content
    return client_id


def _visit(client, token, client_id=None, *, revision_minutes=0):
    client_id = client_id or str(uuid.uuid4())
    started = timezone.now() - timedelta(hours=2)
    response = client.post(
        "/v1/pub-visits",
        data={
            "client_id": client_id,
            "name": _NAME,
            "lat": _LAT,
            "lng": _LNG,
            "city": "Praha",
            "started_at": started.isoformat(),
            "ended_at": None,
            "closed_at": None,
            "updated_at": (started + timedelta(minutes=revision_minutes)).isoformat(),
        },
        format="json",
        **_auth(token),
    )
    assert response.status_code in (200, 201), response.content
    return client_id


def _age_everything(account: Account) -> None:
    """Make every existing row look written an hour ago, before the next read."""
    hour_ago = timezone.now() - timedelta(hours=1)
    DrinkLog.objects.filter(account=account).update(updated_at=hour_ago)
    PubVisit.objects.filter(account=account).update(updated_at=hour_ago)
    OfflineMutationTombstone.objects.filter(account=account).update(deleted_at=hour_ago)


def _ids_hash(ids) -> str:
    return f"{sum(uuid.UUID(str(client_id)).int >> 96 for client_id in ids) % 2**32:08x}"


def _read(client, token, path, since):
    response = client.get(f"{path}?since={since}", **_auth(token))
    assert response.status_code == 200, response.content
    return response.json()


@pytest.mark.django_db
def test_released_app_without_since_keeps_the_exact_full_snapshot(client):
    token, account = _anonymous(client)
    drink_id = _drink(client, token)
    visit_id = _visit(client, token)

    drinks = client.get("/v1/drinks", **_auth(token)).json()
    visits = client.get("/v1/pub-visits", **_auth(token)).json()

    assert set(drinks) == {"drinks"}
    assert [item["client_id"] for item in drinks["drinks"]] == [drink_id]
    assert set(drinks["drinks"][0]) == {
        "client_id", "evening_client_id", "cache_key", "name", "lat", "lng", "city",
        "external_id", "place_context", "drink_type", "beer", "drank_at", "is_suspect",
    }
    assert set(visits) == {"visits"}
    assert [item["client_id"] for item in visits["visits"]] == [visit_id]
    assert set(visits["visits"][0]) == {
        "client_id", "cache_key", "name", "lat", "lng", "city", "external_id",
        "started_at", "ended_at", "closed_at", "updated_at", "party_code",
    }


@pytest.mark.django_db
@pytest.mark.parametrize("path,key", [("/v1/drinks", "drinks"), ("/v1/pub-visits", "visits")])
@pytest.mark.parametrize("since", ["", "garbage", "-5", "²", "9" * 18, "9" * 19, "{future}"])
def test_first_unreadable_or_future_since_answers_everything(client, path, key, since):
    token, account = _anonymous(client)
    ids = [_drink(client, token), _drink(client, token)] if key == "drinks" else [_visit(client, token)]
    future = (timezone.now() + timedelta(days=1) - timezone.datetime(1970, 1, 1, tzinfo=timezone.UTC))
    since = since.replace("{future}", str(future // timedelta(microseconds=1)))

    body = _read(client, token, path, since)

    assert body["full"] is True
    assert sorted(item["client_id"] for item in body[key]) == sorted(ids)
    assert body["removed"] == []
    assert body["total"] == len(ids)
    assert body["ids_hash"] == _ids_hash(ids)
    assert body["next_since"].isdigit()


@pytest.mark.django_db
def test_drink_changes_bring_new_edited_and_removed_drinks_only(client):
    token, account = _anonymous(client)
    kept, renamed, repriced, removed = (_drink(client, token) for _ in range(4))
    _age_everything(account)
    since = _read(client, token, "/v1/drinks", "")["next_since"]

    added = _drink(client, token)
    _drink(client, token, client_id=added)
    assert client.patch(f"/v1/drinks/{renamed}", data={"beer_name": "Pilsner Urquell"}, format="json", **_auth(token)).status_code == 200
    assert client.patch(f"/v1/drinks/{repriced}", data={"price_czk": 70}, format="json", **_auth(token)).status_code == 200
    assert client.delete(f"/v1/drinks/{removed}", **_auth(token)).status_code == 200
    assert _drink(client, token, client_id=removed) == removed

    body = _read(client, token, "/v1/drinks", since)

    changed = {item["client_id"]: item for item in body["drinks"]}
    assert set(changed) == {added, renamed, repriced}
    assert changed[renamed]["beer"]["name"] == "Pilsner Urquell"
    assert changed[repriced]["beer"]["price_czk"] == 70
    assert body["removed"] == [removed]
    assert body["full"] is False
    assert body["total"] == 4
    assert body["ids_hash"] == _ids_hash([kept, renamed, repriced, added])


@pytest.mark.django_db
def test_unchanged_diary_answers_empty_changes(client):
    token, account = _anonymous(client)
    _drink(client, token)
    _visit(client, token)
    _age_everything(account)
    drinks_since = _read(client, token, "/v1/drinks", "")["next_since"]
    visits_since = _read(client, token, "/v1/pub-visits", "")["next_since"]

    drinks = _read(client, token, "/v1/drinks", drinks_since)
    visits = _read(client, token, "/v1/pub-visits", visits_since)

    assert (drinks["drinks"], drinks["removed"], drinks["total"]) == ([], [], 1)
    assert (visits["visits"], visits["removed"], visits["total"]) == ([], [], 1)


@pytest.mark.django_db
def test_write_saved_just_before_a_read_is_sent_again_on_the_next_one(client):
    token, account = _anonymous(client)
    late = _drink(client, token)
    _age_everything(account)
    since = _read(client, token, "/v1/drinks", "")["next_since"]
    DrinkLog.objects.filter(client_id=late).update(updated_at=timezone.now() - timedelta(minutes=5))

    assert [item["client_id"] for item in _read(client, token, "/v1/drinks", since)["drinks"]] == [late]


@pytest.mark.django_db
def test_server_side_drink_fixes_reach_the_changes(client):
    """Beer name cleanup, suspect flags and catalogue merges write in bulk."""
    token, account = _anonymous(client)
    renamed, flagged, recomputed = (_drink(client, token) for _ in range(3))
    _age_everything(account)
    since = _read(client, token, "/v1/drinks", "")["next_since"]

    DrinkLog.objects.filter(client_id=renamed).update(beer_name="Radegast Ryze hořká 12°")
    DrinkLog.objects.filter(client_id=flagged).update(is_suspect=True, suspect_reason="manual")
    row = DrinkLog.objects.get(client_id=recomputed)
    row.is_suspect = True
    DrinkLog.objects.bulk_update([row], ["is_suspect"])

    changed = {item["client_id"]: item for item in _read(client, token, "/v1/drinks", since)["drinks"]}
    assert changed[renamed]["beer"]["name"] == "Radegast Ryze hořká 12°"
    assert changed[flagged]["is_suspect"] is True
    assert changed[recomputed]["is_suspect"] is True


@pytest.mark.django_db
def test_visit_changes_cover_edits_redeletion_and_repaired_pubs(client):
    token, account = _anonymous(client)
    edited, recreated, untouched = (_visit(client, token) for _ in range(3))
    assert client.delete(f"/v1/pub-visits/{recreated}", data={"updated_at": (timezone.now() - timedelta(hours=2, minutes=-1)).isoformat()}, format="json", **_auth(token)).status_code == 200
    _visit(client, token, client_id=recreated, revision_minutes=5)
    _age_everything(account)
    since = _read(client, token, "/v1/pub-visits", "")["next_since"]

    _visit(client, token, client_id=edited, revision_minutes=10)
    deleted = client.delete(
        f"/v1/pub-visits/{recreated}",
        data={"updated_at": (timezone.now() - timedelta(hours=2, minutes=-6)).isoformat()},
        format="json",
        **_auth(token),
    )
    assert deleted.json() == {"deleted": True}

    body = _read(client, token, "/v1/pub-visits", since)
    changed = [item["client_id"] for item in body["visits"]]
    assert edited in changed
    assert recreated not in changed
    assert body["removed"] == [recreated]
    assert body["total"] == 2
    assert body["ids_hash"] == _ids_hash([edited, untouched])

    since = body["next_since"]
    _age_everything(account)
    canonical = CanonicalPub.objects.create(
        cache_key=geohash8(50.09, 14.43), name="U Zlatého tygra (Husova)",
        lat=50.09, lng=14.43, city="Praha", external_id="correct-place",
    )
    PubAlias.objects.create(canonical_pub=canonical, cache_key=_KEY, name=_NAME, lat=_LAT, lng=_LNG)

    repaired = _read(client, token, "/v1/pub-visits", since)["visits"]
    assert sorted(item["client_id"] for item in repaired) == sorted([edited, untouched])
    assert {item["cache_key"] for item in repaired} == {canonical.cache_key}


@pytest.mark.django_db
def test_claim_brings_the_anonymous_diary_to_the_signed_in_accounts_other_phone(client):
    password = f"test-{uuid.uuid4().hex}"
    registered = client.post("/v1/auth/register", data={"email": "diary@x.cz", "password": password}, format="json")
    assert registered.status_code == 201
    phone_token = registered.json()["token"]
    target = EmailCredential.objects.get(email="diary@x.cz").account
    target_drink = _drink(client, phone_token)
    _age_everything(target)
    drinks_since = _read(client, phone_token, "/v1/drinks", "")["next_since"]
    visits_since = _read(client, phone_token, "/v1/pub-visits", "")["next_since"]

    anon_token, source = _anonymous(client)
    moved_drink = _drink(client, anon_token)
    moved_visit = _visit(client, anon_token)
    _age_everything(source)
    login = client.post("/v1/auth/login", data={"email": "diary@x.cz", "password": password}, format="json", **_auth(anon_token))
    assert login.status_code == 200, login.content

    drinks = _read(client, phone_token, "/v1/drinks", drinks_since)
    visits = _read(client, phone_token, "/v1/pub-visits", visits_since)
    assert [item["client_id"] for item in drinks["drinks"]] == [moved_drink]
    assert drinks["ids_hash"] == _ids_hash([target_drink, moved_drink])
    assert [item["client_id"] for item in visits["visits"]] == [moved_visit]


@pytest.mark.django_db
def test_changes_never_show_another_accounts_diary(client):
    token, account = _anonymous(client)
    other_token, other = _anonymous(client)
    mine = _drink(client, token)
    _age_everything(account)
    since = _read(client, token, "/v1/drinks", "")["next_since"]
    theirs = _drink(client, other_token)
    assert client.delete(f"/v1/drinks/{theirs}", **_auth(other_token)).status_code == 200

    body = _read(client, token, "/v1/drinks", since)

    assert (body["drinks"], body["removed"], body["total"], body["ids_hash"]) == ([], [], 1, _ids_hash([mine]))


@pytest.mark.django_db
def test_changes_require_account_token(client):
    assert client.get("/v1/drinks?since=").status_code == 401
    assert client.get("/v1/pub-visits?since=").status_code == 401
