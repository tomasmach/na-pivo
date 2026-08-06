from __future__ import annotations

import io
import json
import uuid
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import Account, BeerPhoto, DrinkLog, Friendship, PubVisit


@pytest.fixture
def client():
    return APIClient()


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
    assert Friendship.objects.count() == 0

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
            "visibility": "private",
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
