from __future__ import annotations

import io
import json
import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient

from pubs.api import party_views
from pubs.models import (
    Account,
    BeerPhoto,
    DrinkLog,
    Friendship,
    PartyEveningDrink,
    PartyGame,
    PartyGameEvent,
    PubVisit,
)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    # DRF's account-scoped cache outlives pytest's rolled-back account rows, so
    # reused primary keys must not inherit a previous test's request budget.
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def tmp_media(tmp_path, settings):
    media_root = tmp_path / "media"
    media_root.mkdir()
    settings.MEDIA_ROOT = str(media_root)
    return media_root


def _register(client: APIClient, nickname: str) -> tuple[str, Account]:
    response = client.post(
        "/v1/account",
        data={"device_id": str(uuid.uuid4())},
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED
    account = Account.objects.get(public_id=response.json()["id"])
    account.nickname = nickname
    account.display_name = nickname.capitalize()
    account.save(update_fields=["nickname", "display_name"])
    return response.json()["token"], account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _jpeg_upload() -> SimpleUploadedFile:
    image = Image.new("RGB", (120, 90), (210, 160, 40))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return SimpleUploadedFile("beer.jpg", buffer.getvalue(), content_type="image/jpeg")


@pytest.mark.django_db
def test_departed_member_recovers_record_only_after_host_ends_evening(client):
    host_token, _host = _register(client, "host")
    member_token, _member = _register(client, "member")
    stranger_token, _stranger = _register(client, "stranger")
    code = "PRAH24"
    created = client.post(
        "/v1/party-evenings",
        data={
            "client_id": str(uuid.uuid4()),
            "join_code": code,
            "pub_name": "U Zlatého tygra",
        },
        format="json",
        **_auth(host_token),
    )
    assert created.status_code == status.HTTP_201_CREATED
    assert client.post(f"/v1/party-evenings/{code}/join", **_auth(member_token)).status_code == 200
    assert (
        client.delete(f"/v1/party-evenings/{code}/join", **_auth(member_token)).status_code == 200
    )

    assert (
        client.get(f"/v1/party-evenings/{code}/record", **_auth(member_token)).status_code
        == status.HTTP_404_NOT_FOUND
    )
    assert client.post(f"/v1/party-evenings/{code}/end", **_auth(host_token)).status_code == 200

    recovered = client.get(f"/v1/party-evenings/{code}/record", **_auth(member_token))
    assert recovered.status_code == status.HTTP_200_OK
    assert recovered.json()["code"] == code
    assert (
        client.get(f"/v1/party-evenings/{code}/record", **_auth(stranger_token)).status_code
        == status.HTTP_404_NOT_FOUND
    )


@pytest.mark.django_db
def test_record_keeps_idempotent_no_drink_pub_crawl_stops(client):
    token, _account = _register(client, "host")
    base = timezone.now().replace(microsecond=0) - timedelta(hours=2)
    code = "TAH242"
    created = client.post(
        "/v1/party-evenings",
        data={
            "client_id": str(uuid.uuid4()),
            "join_code": code,
            "pub_name": "Lokál",
            "started_at": base.isoformat(),
        },
        format="json",
        **_auth(token),
    )
    assert created.status_code == status.HTTP_201_CREATED, created.content

    visits = [
        {
            "client_id": str(uuid.uuid4()),
            "name": "Lokál",
            "lat": 50.0876,
            "lng": 14.4214,
            "started_at": base.isoformat(),
            "ended_at": (base + timedelta(hours=1)).isoformat(),
            "updated_at": (base + timedelta(hours=1)).isoformat(),
            "party_code": code,
        },
        {
            "client_id": str(uuid.uuid4()),
            "name": "U Pinkasů",
            "lat": 50.0838,
            "lng": 14.4207,
            "started_at": (base + timedelta(hours=1)).isoformat(),
            "ended_at": None,
            "updated_at": (base + timedelta(hours=1)).isoformat(),
            "party_code": code,
        },
    ]
    for visit in visits:
        response = client.post("/v1/pub-visits", data=visit, format="json", **_auth(token))
        assert response.status_code == status.HTTP_201_CREATED, response.content

    retry = client.post("/v1/pub-visits", data=visits[1], format="json", **_auth(token))
    assert retry.status_code == status.HTTP_200_OK, retry.content
    assert retry.json()["duplicate"] is True

    response = client.get(f"/v1/party-evenings/{code}/record", **_auth(token))
    assert response.status_code == status.HTTP_200_OK, response.content
    record = response.json()
    assert [stop["pub_name"] for stop in record["stops"]] == ["Lokál", "U Pinkasů"]
    assert [event["kind"] for event in record["events"]].count("visit") == 2
    assert PubVisit.objects.filter(party_evening__join_code=code).count() == 2


@pytest.mark.django_db
def test_record_derives_full_private_night_and_deletes_disappear(client, tmp_media):
    host_token, host = _register(client, "host")
    guest_token, guest = _register(client, "hostka")
    base = timezone.now().replace(microsecond=0) - timedelta(hours=2)
    code = "PRAH24"

    created = client.post(
        "/v1/party-evenings",
        data={
            "client_id": str(uuid.uuid4()),
            "join_code": code,
            "pub_name": "U Zlatého tygra",
            "pub_city": "Praha",
            "started_at": base.isoformat(),
        },
        format="json",
        **_auth(host_token),
    )
    assert created.status_code == status.HTTP_201_CREATED, created.content
    joined = client.post(f"/v1/party-evenings/{code}/join", **_auth(guest_token))
    assert joined.status_code == status.HTTP_200_OK, joined.content
    host.hosted_party_evenings.get(join_code=code).memberships.update(joined_at=base)
    assert Friendship.objects.filter(status=Friendship.Status.ACCEPTED).count() == 1

    visit_id = uuid.uuid4()
    visit = client.post(
        "/v1/pub-visits",
        data={
            "client_id": str(visit_id),
            "name": "U Zlatého tygra",
            "lat": 50.0876,
            "lng": 14.4214,
            "city": "Praha",
            "started_at": base.isoformat(),
            "ended_at": (base + timedelta(hours=2)).isoformat(),
            "updated_at": (base + timedelta(hours=2)).isoformat(),
            "party_code": code,
        },
        format="json",
        **_auth(guest_token),
    )
    assert visit.status_code == status.HTTP_201_CREATED, visit.content
    cache_key = visit.json()["cache_key"]

    drink_id = uuid.uuid4()
    drink = client.post(
        "/v1/drinks",
        data={
            "client_id": str(drink_id),
            "name": "U Zlatého tygra",
            "lat": 50.0876,
            "lng": 14.4214,
            "city": "Praha",
            "drink_type": "soft_drink",
            "beer": {"name": "Kofola", "price_czk": 55, "volume_ml": 300},
            "drank_at": (base + timedelta(minutes=30)).isoformat(),
            "party_code": code,
        },
        format="json",
        **_auth(guest_token),
    )
    assert drink.status_code == status.HTTP_201_CREATED, drink.content

    legacy = client.post(
        f"/v1/party-evenings/{code}/drinks",
        data={
            "client_id": str(uuid.uuid4()),
            "beer_name": "Staropramen",
            "quantity": 2,
            "shared_at": (base + timedelta(minutes=45)).isoformat(),
        },
        format="json",
        **_auth(host_token),
    )
    assert legacy.status_code == status.HTTP_201_CREATED, legacy.content

    photo = client.post(
        "/v1/beer-photos",
        data={
            "client_id": str(uuid.uuid4()),
            "image": _jpeg_upload(),
            "caption": "Na zdraví",
            "pub_cache_key": cache_key,
            "pub_name": "U Zlatého tygra",
            "pub_city": "Praha",
            "visibility": "friends",
            "taken_at": (base + timedelta(minutes=60)).isoformat(),
            "party_code": code,
        },
        format="multipart",
        **_auth(guest_token),
    )
    assert photo.status_code == status.HTTP_201_CREATED, photo.content
    photo_id = photo.json()["photo"]["id"]

    game = client.post(
        f"/v1/party-evenings/{code}/games",
        data={
            "client_id": str(uuid.uuid4()),
            "catalog_key": "quiz",
            "name": "Pub kvíz",
            "scoring": "points",
            "started_at": (base + timedelta(minutes=70)).isoformat(),
        },
        format="json",
        **_auth(host_token),
    )
    assert game.status_code == status.HTTP_201_CREATED, game.content
    result = {"winner": "Host", "scores": [{"name": "Host", "score": 7}]}
    finished = client.post(
        f"/v1/party-evenings/{code}/games/{game.json()['id']}/events",
        data={
            "events": [
                {
                    "client_id": str(uuid.uuid4()),
                    "kind": "finish",
                    "payload": result,
                    "created_at": (base + timedelta(minutes=80)).isoformat(),
                }
            ]
        },
        format="json",
        **_auth(host_token),
    )
    assert finished.status_code == status.HTTP_201_CREATED, finished.content

    left = client.delete(f"/v1/party-evenings/{code}/join", **_auth(guest_token))
    assert left.json() == {"left": True}

    response = client.get(f"/v1/party-evenings/{code}/record", **_auth(host_token))
    assert response.status_code == status.HTTP_200_OK, response.content
    record = response.json()
    assert record["code"] == code
    assert [participant["nickname"] for participant in record["participants"]] == [
        "host",
        "hostka",
    ]
    assert record["participants"][1]["active"] is False
    assert record["participants"][1]["left_at"] is not None

    diary = next(item for item in record["drinks"] if item["source"] == "diary")
    assert diary["id"] == str(drink_id)
    assert diary["by"] == str(guest.public_id)
    assert diary["drink_type"] == "soft_drink"
    assert diary["volume_ml"] == 300
    assert diary["pub"] == {
        "cache_key": cache_key,
        "name": "U Zlatého tygra",
        "city": "Praha",
    }
    assert diary["stop_id"] == record["stops"][0]["id"]
    assert len([item for item in record["drinks"] if item["source"] == "legacy_party"]) == 2
    assert record["photos"][0]["id"] == photo_id
    assert record["photos"][0]["by"] == str(guest.public_id)
    assert record["games"][0]["result"] == result
    assert record["truncated"] == {
        "participants": False,
        "stops": False,
        "drinks": False,
        "photos": False,
        "games": False,
        "game_events": False,
        "events": False,
    }

    kinds = [event["kind"] for event in record["events"]]
    assert {"joined", "left", "drink", "photo", "visit", "game_started", "game_finished"} <= set(
        kinds
    )
    assert [event["at"] for event in record["events"]] == sorted(
        event["at"] for event in record["events"]
    )
    wire = json.dumps(record)
    assert "price_czk" not in wire
    for stop in record["stops"]:
        assert "lat" not in stop
        assert "lng" not in stop
    for item in record["drinks"]:
        assert "lat" not in item
        assert "lng" not in item

    stranger_token, _stranger = _register(client, "cizi")
    assert (
        client.get(f"/v1/party-evenings/{code}/record", **_auth(stranger_token)).status_code
        == status.HTTP_404_NOT_FOUND
    )
    assert (
        client.get(f"/v1/party-evenings/{code}/record", **_auth(guest_token)).status_code
        == status.HTTP_404_NOT_FOUND
    )

    exported = client.get("/v1/account/export", **_auth(guest_token)).json()
    assert exported["drinks"][0]["party_evening_id"] == record["id"]
    assert exported["beer_photos"][0]["party_evening_id"] == record["id"]
    assert exported["visits"][0]["party_code"] == code

    assert client.delete(f"/v1/drinks/{drink_id}", **_auth(guest_token)).status_code == 200
    assert client.delete(f"/v1/beer-photos/{photo_id}", **_auth(guest_token)).status_code == 204
    assert client.delete(f"/v1/pub-visits/{visit_id}", **_auth(guest_token)).status_code == 200
    after_delete = client.get(
        f"/v1/party-evenings/{code}/record",
        **_auth(host_token),
    ).json()
    assert not any(item["id"] == str(drink_id) for item in after_delete["drinks"])
    assert after_delete["photos"] == []
    assert after_delete["stops"] == []
    assert DrinkLog.objects.filter(client_id=drink_id).count() == 0
    assert BeerPhoto.objects.filter(public_id=photo_id).count() == 0
    assert PubVisit.objects.filter(client_id=visit_id).count() == 0


@pytest.mark.django_db
def test_record_shares_friends_photos_but_keeps_private_photos_owner_only(client, tmp_media):
    host_token, _host = _register(client, "host")
    owner_token, _owner = _register(client, "fotograf")
    code = "FUTK24"
    created = client.post(
        "/v1/party-evenings",
        data={
            "client_id": str(uuid.uuid4()),
            "join_code": code,
            "pub_name": "U Fotky",
        },
        format="json",
        **_auth(host_token),
    )
    assert created.status_code == status.HTTP_201_CREATED, created.content
    assert client.post(f"/v1/party-evenings/{code}/join", **_auth(owner_token)).status_code == 200

    photo_ids: dict[str, str] = {}
    for visibility in ("friends", "private"):
        response = client.post(
            "/v1/beer-photos",
            data={
                "client_id": str(uuid.uuid4()),
                "image": _jpeg_upload(),
                "caption": visibility,
                "visibility": visibility,
                "party_code": code,
            },
            format="multipart",
            **_auth(owner_token),
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        photo_ids[visibility] = response.json()["photo"]["id"]

    owner_record = client.get(
        f"/v1/party-evenings/{code}/record",
        **_auth(owner_token),
    ).json()
    assert {photo["id"] for photo in owner_record["photos"]} == set(photo_ids.values())
    assert {
        event["photo"]["id"] for event in owner_record["events"] if event["kind"] == "photo"
    } == set(photo_ids.values())

    host_record = client.get(
        f"/v1/party-evenings/{code}/record",
        **_auth(host_token),
    ).json()
    assert [photo["id"] for photo in host_record["photos"]] == [photo_ids["friends"]]
    assert [
        event["photo"]["id"] for event in host_record["events"] if event["kind"] == "photo"
    ] == [photo_ids["friends"]]


@pytest.mark.django_db
@pytest.mark.parametrize("guard", ["sharing_disabled", "ghost", "pending_deletion"])
def test_record_filters_preexisting_drinks_by_current_owner_privacy(client, guard):
    host_token, host = _register(client, "host")
    owner_token, owner = _register(client, "majitel")
    code = "SOUK24"
    created = client.post(
        "/v1/party-evenings",
        data={
            "client_id": str(uuid.uuid4()),
            "join_code": code,
            "pub_name": "U Soukromého stolu",
        },
        format="json",
        **_auth(host_token),
    )
    assert created.status_code == status.HTTP_201_CREATED, created.content
    assert client.post(f"/v1/party-evenings/{code}/join", **_auth(owner_token)).status_code == 200
    evening = host.hosted_party_evenings.get(join_code=code)
    legacy_id = uuid.uuid4()
    diary_id = uuid.uuid4()
    PartyEveningDrink.objects.create(
        evening=evening,
        account=owner,
        client_id=legacy_id,
        beer_name="Legacy Plzeň",
    )
    DrinkLog.objects.create(
        party_evening=evening,
        account=owner,
        client_id=diary_id,
        beer_name="Deníkový Kozel",
        drank_at=timezone.now(),
    )

    allowed = client.get(f"/v1/party-evenings/{code}/record", **_auth(host_token))
    assert allowed.status_code == status.HTTP_200_OK, allowed.content
    assert {drink["source"] for drink in allowed.json()["drinks"]} == {
        "diary",
        "legacy_party",
    }

    if guard == "sharing_disabled":
        owner.share_drinks_with_parta = False
        owner.save(update_fields=["share_drinks_with_parta"])
    elif guard == "ghost":
        owner.ghost_mode = True
        owner.save(update_fields=["ghost_mode"])
    else:
        owner.status = Account.Status.PENDING_DELETION
        owner.save(update_fields=["status"])

    hidden = client.get(f"/v1/party-evenings/{code}/record", **_auth(host_token))
    assert hidden.status_code == status.HTTP_200_OK, hidden.content
    assert hidden.json()["drinks"] == []
    assert [event for event in hidden.json()["events"] if event["kind"] == "drink"] == []

    if guard == "sharing_disabled":
        owner_record = client.get(
            f"/v1/party-evenings/{code}/record",
            **_auth(owner_token),
        )
        assert owner_record.status_code == status.HTTP_200_OK, owner_record.content
        assert {drink["source"] for drink in owner_record.json()["drinks"]} == {
            "diary",
            "legacy_party",
        }
        assert {
            event["drink"]["source"]
            for event in owner_record.json()["events"]
            if event["kind"] == "drink"
        } == {"diary", "legacy_party"}


@pytest.mark.django_db
def test_record_caps_each_section_and_reports_truncation(client, monkeypatch):
    host_token, host = _register(client, "host")
    guest_token, _guest = _register(client, "hostka")
    code = "KAPY24"
    base = timezone.now().replace(microsecond=0) - timedelta(hours=1)
    created = client.post(
        "/v1/party-evenings",
        data={
            "client_id": str(uuid.uuid4()),
            "join_code": code,
            "pub_name": "U Limitu",
            "started_at": base.isoformat(),
        },
        format="json",
        **_auth(host_token),
    )
    assert created.status_code == status.HTTP_201_CREATED, created.content
    assert client.post(f"/v1/party-evenings/{code}/join", **_auth(guest_token)).status_code == 200
    evening = host.hosted_party_evenings.get(join_code=code)

    for index in range(2):
        at = base + timedelta(minutes=index + 1)
        PubVisit.objects.create(
            account=host,
            party_evening=evening,
            client_id=uuid.uuid4(),
            cache_key=f"u2fkbn{index}",
            name=f"Hospoda {index}",
            lat=50.08,
            lng=14.42,
            started_at=at,
            ended_at=at + timedelta(minutes=10),
            client_updated_at=at,
        )
        DrinkLog.objects.create(
            account=host,
            party_evening=evening,
            client_id=uuid.uuid4(),
            cache_key=f"u2fkbn{index}",
            name=f"Hospoda {index}",
            lat=50.08,
            lng=14.42,
            beer_name=f"Pivo {index}",
            price_czk=50,
            volume_ml=500,
            drank_at=at,
        )
        BeerPhoto.objects.create(
            account=host,
            party_evening=evening,
            client_id=uuid.uuid4(),
            image=f"beer-photos/limit-{index}.webp",
            caption=f"Fotka {index}",
            visibility=BeerPhoto.Visibility.FRIENDS,
            taken_at=at,
        )

    games = [
        PartyGame.objects.create(
            evening=evening,
            started_by=host,
            client_id=uuid.uuid4(),
            catalog_key=f"game-{index}",
            name=f"Hra {index}",
            started_at=base + timedelta(minutes=10 + index),
        )
        for index in range(2)
    ]
    for index in range(2):
        PartyGameEvent.objects.create(
            game=games[0],
            account=host,
            client_id=uuid.uuid4(),
            kind=PartyGameEvent.Kind.SCORE,
            subject=host,
            delta=1,
            created_at=base + timedelta(minutes=20 + index),
        )

    monkeypatch.setattr(party_views, "PARTY_RECORD_MAX_PARTICIPANTS", 1)
    monkeypatch.setattr(party_views, "PARTY_RECORD_MAX_STOPS", 1)
    monkeypatch.setattr(party_views, "PARTY_RECORD_MAX_DRINKS", 1)
    monkeypatch.setattr(party_views, "PARTY_RECORD_MAX_PHOTOS", 1)
    monkeypatch.setattr(party_views, "PARTY_RECORD_MAX_GAMES", 1)
    monkeypatch.setattr(party_views, "PARTY_RECORD_MAX_GAME_EVENTS", 1)
    monkeypatch.setattr(party_views, "PARTY_RECORD_MAX_TIMELINE_EVENTS", 1)

    response = client.get(f"/v1/party-evenings/{code}/record", **_auth(host_token))
    assert response.status_code == status.HTTP_200_OK, response.content
    record = response.json()
    assert len(record["participants"]) == 1
    assert len(record["stops"]) == 1
    assert len(record["drinks"]) == 1
    assert len(record["photos"]) == 1
    assert len(record["games"]) == 1
    assert len(record["games"][0]["events"]) == 1
    assert len(record["events"]) == 1
    assert record["truncated"] == {
        "participants": True,
        "stops": True,
        "drinks": True,
        "photos": True,
        "games": True,
        "game_events": True,
        "events": True,
    }


@pytest.mark.django_db
def test_record_caps_legacy_quantity_expansion(client, monkeypatch):
    host_token, host = _register(client, "host")
    code = "DEVC24"
    created = client.post(
        "/v1/party-evenings",
        data={
            "client_id": str(uuid.uuid4()),
            "join_code": code,
            "pub_name": "U Legacy",
        },
        format="json",
        **_auth(host_token),
    )
    assert created.status_code == status.HTTP_201_CREATED, created.content
    evening = host.hosted_party_evenings.get(join_code=code)
    legacy_id = uuid.uuid4()
    PartyEveningDrink.objects.create(
        evening=evening,
        account=host,
        client_id=legacy_id,
        beer_name="Desítka",
        quantity=20,
    )
    monkeypatch.setattr(party_views, "PARTY_RECORD_MAX_DRINKS", 3)

    response = client.get(f"/v1/party-evenings/{code}/record", **_auth(host_token))
    assert response.status_code == status.HTTP_200_OK, response.content
    record = response.json()
    assert [drink["id"] for drink in record["drinks"]] == [
        f"legacy:{legacy_id}:0",
        f"legacy:{legacy_id}:1",
        f"legacy:{legacy_id}:2",
    ]
    assert record["truncated"]["drinks"] is True
