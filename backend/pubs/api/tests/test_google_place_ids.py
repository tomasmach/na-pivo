"""Tests for additive googlePlaceId serving and the match import command."""

from __future__ import annotations

import json

import pytest
from django.core.management import call_command
from django.utils import timezone as dj_tz
from rest_framework import status
from rest_framework.test import APIClient

from pubs.enrichment import geohash8
from pubs.models import PubDirectory, PubGooglePlace

_LAT = 50.0812
_LNG = 14.4182
_PLACE_ID = "ChIJl-inTnyUC0cRw4Y0F76_uUE"


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _nearby_test_settings(settings):
    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {
            **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
            "pubs_near": "10000/min",
        },
    }


def _directory_pub(name: str = "Hospoda U Testu") -> PubDirectory:
    return PubDirectory.objects.create(
        name=name,
        lat=_LAT,
        lng=_LNG,
        city="Praha",
        country="cz",
        venue_kind="pub",
        source="test",
        active=True,
        refreshed_at=dj_tz.now(),
    )


def _google_place(name_key: str, place_id: str = _PLACE_ID) -> PubGooglePlace:
    return PubGooglePlace.objects.create(
        cache_key=geohash8(_LAT, _LNG),
        name_key=name_key,
        google_place_id=place_id,
        matched_at=dj_tz.now(),
    )


@pytest.mark.django_db
def test_near_attaches_google_place_id_by_identity(client):
    _directory_pub()
    _google_place("hospoda u testu")

    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 1})

    assert resp.status_code == status.HTTP_200_OK
    items = resp.json()["items"]
    assert [item.get("googlePlaceId") for item in items] == [_PLACE_ID]


@pytest.mark.django_db
def test_near_omits_google_place_id_when_name_differs(client):
    _directory_pub()
    _google_place("uplne jina hospoda")

    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 1})

    assert resp.status_code == status.HTTP_200_OK
    items = resp.json()["items"]
    assert items
    assert all("googlePlaceId" not in item for item in items)


@pytest.mark.django_db
def test_import_google_place_ids_creates_updates_and_dedupes(tmp_path):
    _google_place("stará hospoda", "old-place-id")
    matches = tmp_path / "matches.jsonl"
    cache_key = geohash8(_LAT, _LNG)
    lines = [
        {"cache_key": cache_key, "name": "Stará  Hospoda", "google_place_id": "new-place-id"},
        {"cache_key": cache_key, "name": "Nová Hospoda", "google_place_id": _PLACE_ID},
        {"cache_key": cache_key, "name": "Nová Hospoda", "google_place_id": "dup-ignored"},
        {"cache_key": cache_key, "name": "", "google_place_id": "skipped"},
    ]
    matches.write_text(
        "\n".join(json.dumps(line, ensure_ascii=False) for line in lines),
        encoding="utf-8",
    )

    call_command("import_google_place_ids", str(matches))

    rows = {
        (row.cache_key, row.name_key): row.google_place_id
        for row in PubGooglePlace.objects.all()
    }
    assert rows == {
        (cache_key, "stará hospoda"): "new-place-id",
        (cache_key, "nová hospoda"): _PLACE_ID,
    }


@pytest.mark.django_db
def test_import_google_place_ids_dry_run_touches_nothing(tmp_path):
    matches = tmp_path / "matches.jsonl"
    matches.write_text(
        json.dumps(
            {
                "cache_key": geohash8(_LAT, _LNG),
                "name": "Hospoda U Testu",
                "google_place_id": _PLACE_ID,
            }
        ),
        encoding="utf-8",
    )

    call_command("import_google_place_ids", str(matches), "--dry-run")

    assert not PubGooglePlace.objects.exists()
