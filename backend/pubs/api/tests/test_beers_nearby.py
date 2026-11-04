"""GET /v1/beers/nearby — beers on tap around the drinker."""

from __future__ import annotations

import uuid

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from pubs.enrichment.matcher import geohash8
from pubs.models import PubCommunityData

LAT, LNG = 50.0870, 14.4210


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


def _token(client: APIClient) -> str:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == 201
    return resp.json()["token"]


def _pub(name: str, lat: float, lng: float, beers: list[dict]) -> PubCommunityData:
    return PubCommunityData.objects.create(
        cache_key=geohash8(lat, lng), name=name, lat=lat, lng=lng, beers=beers
    )


@pytest.mark.django_db
def test_nearby_beers_lists_each_beer_once_at_its_nearest_pub():
    _pub(
        "U Tygra",
        LAT + 0.001,
        LNG,
        [
            {"name": "Pilsner Urquell", "price_czk": 42, "volume_ml": 300},
            {"name": "Pilsner Urquell", "price_czk": 65, "volume_ml": 500},
        ],
    )
    _pub(
        "U Pinkasů",
        LAT + 0.005,
        LNG,
        [
            {"name": "Pilsner Urquell", "price_czk": 59, "volume_ml": 500},
            {"name": "Bernard 11°", "price_czk": 55, "volume_ml": 500},
        ],
    )
    _pub("Daleko", LAT + 0.2, LNG, [{"name": "Svijany", "price_czk": 40, "volume_ml": 500}])
    client = APIClient()
    token = _token(client)

    resp = client.get(
        "/v1/beers/nearby",
        {"lat": LAT, "lng": LNG, "radius": 2000},
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )

    assert resp.status_code == 200
    beers = resp.json()["beers"]
    assert [(b["name"], b["pub_name"]) for b in beers] == [
        ("Pilsner Urquell", "U Tygra"),
        ("Bernard 11°", "U Pinkasů"),
    ]
    assert beers[0]["price_czk"] == 65
    assert beers[0]["volume_ml"] == 500
    assert 100 <= beers[0]["distance_m"] <= 120
    assert set(beers[0]) == {
        "name",
        "price_czk",
        "volume_ml",
        "pub_name",
        "pub_cache_key",
        "distance_m",
    }


@pytest.mark.django_db
def test_nearby_beers_defaults_radius_and_validates_coordinates():
    _pub("U Tygra", LAT, LNG, [{"name": "Kozel 11°", "price_czk": 52, "volume_ml": 500}])
    client = APIClient()
    auth = {"HTTP_AUTHORIZATION": f"Bearer {_token(client)}"}

    assert (
        client.get("/v1/beers/nearby", {"lat": LAT, "lng": LNG}, **auth).json()["beers"][0]["name"]
        == "Kozel 11°"
    )
    assert client.get("/v1/beers/nearby", {"lat": 95, "lng": LNG}, **auth).status_code == 400
    assert client.get("/v1/beers/nearby", {"lng": LNG}, **auth).status_code == 400


@pytest.mark.django_db
def test_nearby_beers_requires_an_account():
    resp = APIClient().get("/v1/beers/nearby", {"lat": LAT, "lng": LNG})
    assert resp.status_code in (401, 403)
