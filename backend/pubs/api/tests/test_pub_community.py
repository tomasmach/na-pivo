"""
Tests for the community-contribution endpoint (POST /v1/pub-community) and its
precedence in the pub-hours read path (POST /v1/pub-hours).
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APIClient

from pubs.api.ugc_consent import UGC_POLICY_HEADER
from pubs.enrichment import community_hours_to_osm, geohash8
from pubs.models import (
    Account,
    EnrichTask,
    PubBeerBrand,
    PubBeerProduct,
    PubCommunityData,
    PubContributionLog,
    PubPriceIndex,
)

from .query_helpers import count_beer_catalog_selects

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_OTHER_DEVICE_ID = "11111111-2222-3333-4444-555555555555"
_CLIENT_ID = "9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d"
_NAME = "Restaurace U Fleků"
_LAT = 50.0812
_LNG = 14.4182
_KEY = geohash8(_LAT, _LNG)

_FULL_HOURS = {
    "mo": [["11:00", "23:00"]],
    "tu": [["11:00", "23:00"]],
    "we": [["11:00", "23:00"]],
    "th": [["11:00", "23:00"]],
    "fr": [["16:00", "01:00"]],  # overnight
    "sa": [],  # closed
    "su": [["12:00", "14:00"], ["17:00", "22:00"]],  # two intervals
}

_BEERS = [
    {"name": "Pilsner Urquell", "price_czk": 59, "volume_ml": 500},
    {"name": "Velkopopovický Kozel 11°", "price_czk": 45, "volume_ml": 330},
]


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    # Community submissions are per-IP throttled. Isolate the shared localhost
    # counter so adding endpoint tests cannot make later cases order-dependent.
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient, device_id: str = _DEVICE_ID) -> str:
    resp = client.post("/v1/account", data={"device_id": device_id}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    return resp.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _payload(**overrides):
    data = {
        "name": _NAME,
        "lat": _LAT,
        "lng": _LNG,
        "city": "Praha",
        "external_id": "mapy:abc",
        "client_id": _CLIENT_ID,
        "hours": _FULL_HOURS,
        "beers": _BEERS,
    }
    data.update(overrides)
    return data


# ---------------------------------------------------------------------------
# hours_json → OSM conversion (unit)
# ---------------------------------------------------------------------------


def test_community_hours_to_osm_basic_and_overnight_and_closed():
    osm = community_hours_to_osm(_FULL_HOURS)
    # Saturday (empty list) is omitted, not emitted as "Sa off", so the Friday
    # overnight interval can spill into early Saturday.
    assert osm == (
        "Mo 11:00-23:00; Tu 11:00-23:00; We 11:00-23:00; Th 11:00-23:00; "
        "Fr 16:00-01:00; Su 12:00-14:00,17:00-22:00"
    )


def test_community_hours_to_osm_overnight_is_evaluable():
    """The derived OSM string must be parseable + evaluable by the is_open lib."""
    import zoneinfo
    from datetime import datetime

    from pubs.enrichment import is_open_now

    osm = community_hours_to_osm(_FULL_HOURS)
    zi = zoneinfo.ZoneInfo("Europe/Prague")
    # Friday 23:30 → open (overnight 16:00-01:00).
    assert is_open_now(osm, datetime(2026, 6, 12, 23, 30, tzinfo=zi)) is True
    # Saturday 00:30 → still open from Friday's overnight interval.
    assert is_open_now(osm, datetime(2026, 6, 13, 0, 30, tzinfo=zi)) is True
    # Saturday 15:00 → closed (Sa off).
    assert is_open_now(osm, datetime(2026, 6, 13, 15, 0, tzinfo=zi)) is False


def test_community_hours_to_osm_empty():
    assert community_hours_to_osm(None) == ""
    assert community_hours_to_osm({}) == ""


# ---------------------------------------------------------------------------
# Submission
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_submit_requires_account_token(client):
    resp = client.post("/v1/pub-community", data=_payload(), format="json")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    assert PubCommunityData.objects.count() == 0


@pytest.mark.django_db
def test_submit_hours_and_beers(client):
    token = _register(client)
    resp = client.post("/v1/pub-community", data=_payload(), format="json", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cache_key"] == _KEY
    assert body["hours"] == _FULL_HOURS
    assert body["beers"] == _BEERS

    record = PubCommunityData.objects.get()
    assert record.cache_key == _KEY
    assert record.hours_json == _FULL_HOURS
    assert record.opening_hours_raw == community_hours_to_osm(_FULL_HOURS)
    assert record.beers == _BEERS
    assert record.hours_updated_at is not None
    assert record.beers_updated_at is not None
    assert record.account == Account.objects.get(device_id=_DEVICE_ID)
    assert record.external_id == "mapy:abc"

    # One log row per kind.
    kinds = set(PubContributionLog.objects.values_list("kind", flat=True))
    assert kinds == {"hours", "beers"}


@pytest.mark.django_db
@pytest.mark.parametrize("rotates", [True, False])
def test_submit_and_read_rotating_beer_menu(client, rotates):
    token = _register(client)
    payload = _payload(beer_menu_rotates=rotates)

    submitted = client.post(
        "/v1/pub-community", data=payload, format="json", **_auth(token)
    )

    assert submitted.status_code == status.HTTP_200_OK
    assert submitted.json()["beer_menu_rotates"] is rotates
    assert PubCommunityData.objects.get().beer_menu_rotates is rotates
    assert PubContributionLog.objects.get(kind="beers").payload == {
        "beers": _BEERS,
        "beer_menu_rotates": rotates,
    }

    read = client.post(
        "/v1/pub-hours",
        data={"pubs": [{"name": _NAME, "lat": _LAT, "lng": _LNG}]},
        format="json",
    )
    assert read.status_code == status.HTTP_200_OK
    assert read.json()["results"][0]["beer_menu_rotates"] is rotates


@pytest.mark.django_db
def test_legacy_beer_update_preserves_rotating_menu(client):
    token = _register(client)
    first = _payload(beer_menu_rotates=True)
    client.post("/v1/pub-community", data=first, format="json", **_auth(token))

    legacy = _payload(client_id="aaaaaaaa-0000-0000-0000-000000000099")
    legacy.pop("hours")
    updated = client.post(
        "/v1/pub-community", data=legacy, format="json", **_auth(token)
    )

    assert updated.status_code == status.HTTP_200_OK
    assert updated.json()["beer_menu_rotates"] is True
    assert PubCommunityData.objects.get().beer_menu_rotates is True
    assert PubContributionLog.objects.get(
        kind="beers", client_id="aaaaaaaa-0000-0000-0000-000000000099"
    ).payload == _BEERS


@pytest.mark.django_db
def test_submit_hours_only(client):
    token = _register(client)
    payload = _payload()
    payload.pop("beers")
    resp = client.post("/v1/pub-community", data=payload, format="json", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    record = PubCommunityData.objects.get()
    assert record.hours_json == _FULL_HOURS
    assert record.hours_updated_at is not None
    assert record.beers == []
    assert record.beers_updated_at is None
    assert resp.json()["beers"] == []
    assert set(PubContributionLog.objects.values_list("kind", flat=True)) == {"hours"}


@pytest.mark.django_db
def test_submit_beers_only(client):
    token = _register(client)
    payload = _payload()
    payload.pop("hours")
    resp = client.post("/v1/pub-community", data=payload, format="json", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    record = PubCommunityData.objects.get()
    assert record.hours_json is None
    assert record.hours_updated_at is None
    assert record.beers == _BEERS
    assert record.beers_updated_at is not None
    assert resp.json()["hours"] is None
    assert set(PubContributionLog.objects.values_list("kind", flat=True)) == {"beers"}

    price = PubPriceIndex.objects.get(cache_key=_KEY)
    assert price.price_czk == 59
    assert price.volume_ml == 500
    assert price.source == PubPriceIndex.Source.COMMUNITY
    assert price.active is True


@pytest.mark.django_db
def test_submit_empty_beer_menu_deactivates_price_index(client):
    token = _register(client)
    first = client.post(
        "/v1/pub-community",
        data=_payload(client_id="aaaaaaaa-0000-0000-0000-000000000031"),
        format="json",
        **_auth(token),
    )
    assert first.status_code == status.HTTP_200_OK

    cleared = client.post(
        "/v1/pub-community",
        data=_payload(
            client_id="aaaaaaaa-0000-0000-0000-000000000032",
            beers=[],
        ),
        format="json",
        **_auth(token),
    )

    assert cleared.status_code == status.HTTP_200_OK
    assert cleared.json()["beers"] == []
    price = PubPriceIndex.objects.get(cache_key=_KEY)
    assert price.active is False
    assert price.source == PubPriceIndex.Source.COMMUNITY


@pytest.mark.django_db
def test_submit_requires_hours_or_beers(client):
    token = _register(client)
    payload = _payload()
    payload.pop("hours")
    payload.pop("beers")
    resp = client.post("/v1/pub-community", data=payload, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert PubCommunityData.objects.count() == 0


@pytest.mark.django_db
def test_submit_is_idempotent_on_client_id(client):
    token = _register(client)
    first = client.post("/v1/pub-community", data=_payload(), format="json", **_auth(token))
    assert first.status_code == status.HTTP_200_OK

    # Re-POST identical client_id with changed data: upsert updates the row, but
    # the contribution log must NOT gain duplicate rows.
    changed_beers = [{"name": "Gambrinus", "price_czk": 40, "volume_ml": 500}]
    second = client.post(
        "/v1/pub-community",
        data=_payload(beers=changed_beers),
        format="json",
        **_auth(token),
    )
    assert second.status_code == status.HTTP_200_OK

    assert PubCommunityData.objects.count() == 1
    record = PubCommunityData.objects.get()
    # Upsert is naturally idempotent and reflects the latest write.
    assert record.beers == changed_beers
    # get_or_create keeps the original log payload, no duplicates.
    assert PubContributionLog.objects.filter(kind="hours").count() == 1
    assert PubContributionLog.objects.filter(kind="beers").count() == 1


@pytest.mark.django_db
def test_replacing_menu_archives_removed_beers_and_restoring_removes_history(client):
    token = _register(client)
    first = client.post(
        "/v1/pub-community",
        data=_payload(client_id="aaaaaaaa-0000-0000-0000-000000000011"),
        format="json",
        **_auth(token),
    )
    assert first.status_code == status.HTTP_200_OK

    current = [_BEERS[0]]
    second = client.post(
        "/v1/pub-community",
        data=_payload(
            client_id="aaaaaaaa-0000-0000-0000-000000000012",
            beers=current,
        ),
        format="json",
        **_auth(token),
    )
    assert second.status_code == status.HTTP_200_OK
    assert second.json()["beers"] == current
    assert second.json()["historical_beers"] == [_BEERS[1]]
    assert second.json()["beers_updated_at"] is not None

    restored = client.post(
        "/v1/pub-community",
        data=_payload(
            client_id="aaaaaaaa-0000-0000-0000-000000000013",
            beers=_BEERS,
        ),
        format="json",
        **_auth(token),
    )
    assert restored.status_code == status.HTTP_200_OK
    assert restored.json()["historical_beers"] == []
    record = PubCommunityData.objects.get()
    assert record.beers == _BEERS
    assert record.historical_beers == []


@pytest.mark.django_db
def test_hours_only_write_preserves_beer_history(client):
    token = _register(client)
    PubCommunityData.objects.create(
        cache_key=_KEY,
        name=_NAME,
        lat=_LAT,
        lng=_LNG,
        beers=[_BEERS[0]],
        historical_beers=[_BEERS[1]],
    )
    payload = _payload(client_id="aaaaaaaa-0000-0000-0000-000000000014")
    payload.pop("beers")

    response = client.post(
        "/v1/pub-community",
        data=payload,
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["historical_beers"] == [_BEERS[1]]
    assert PubCommunityData.objects.get().historical_beers == [_BEERS[1]]


@pytest.mark.django_db
def test_submit_upsert_semantics_keeps_existing_hours_when_only_beers_sent(client):
    token = _register(client)
    # First contribute hours.
    hours_payload = _payload(client_id="aaaaaaaa-0000-0000-0000-000000000001")
    hours_payload.pop("beers")
    client.post("/v1/pub-community", data=hours_payload, format="json", **_auth(token))

    # Then contribute only beers with a fresh client_id — hours must remain.
    beers_payload = _payload(client_id="aaaaaaaa-0000-0000-0000-000000000002")
    beers_payload.pop("hours")
    client.post("/v1/pub-community", data=beers_payload, format="json", **_auth(token))

    record = PubCommunityData.objects.get()
    assert record.hours_json == _FULL_HOURS  # untouched by the beers-only write
    assert record.beers == _BEERS


@pytest.mark.django_db
def test_submit_validation_errors(client):
    token = _register(client)

    bad_lat = client.post(
        "/v1/pub-community", data=_payload(lat=999), format="json", **_auth(token)
    )
    missing_day = client.post(
        "/v1/pub-community",
        data=_payload(hours={"mo": [["11:00", "23:00"]]}),
        format="json",
        **_auth(token),
    )
    bad_time = client.post(
        "/v1/pub-community",
        data=_payload(hours={**_FULL_HOURS, "mo": [["99:00", "23:00"]]}),
        format="json",
        **_auth(token),
    )
    too_many_intervals = client.post(
        "/v1/pub-community",
        data=_payload(
            hours={
                **_FULL_HOURS,
                "mo": [["08:00", "10:00"], ["11:00", "13:00"], ["14:00", "16:00"], ["17:00", "19:00"]],
            }
        ),
        format="json",
        **_auth(token),
    )
    bad_volume = client.post(
        "/v1/pub-community",
        data=_payload(beers=[{"name": "X", "price_czk": 50, "volume_ml": 250}]),
        format="json",
        **_auth(token),
    )
    too_many_beers = client.post(
        "/v1/pub-community",
        data=_payload(beers=[{"name": f"Beer {i}"} for i in range(13)]),
        format="json",
        **_auth(token),
    )
    bad_price = client.post(
        "/v1/pub-community",
        data=_payload(beers=[{"name": "X", "price_czk": 5000}]),
        format="json",
        **_auth(token),
    )

    for resp in (
        bad_lat,
        missing_day,
        bad_time,
        too_many_intervals,
        bad_volume,
        too_many_beers,
        bad_price,
    ):
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert PubCommunityData.objects.count() == 0


@pytest.mark.django_db
def test_submit_accepts_optional_beer_fields(client):
    token = _register(client)
    resp = client.post(
        "/v1/pub-community",
        data=_payload(hours=None, beers=[{"name": "Tap beer"}]),
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    record = PubCommunityData.objects.get()
    assert record.beers == [{"name": "Tap beer", "price_czk": None, "volume_ml": None}]


@pytest.mark.django_db
def test_submit_beers_normalizes_exact_brand_shorthand_and_indexes_brand(client):
    token = _register(client)
    resp = client.post(
        "/v1/pub-community",
        data=_payload(
            hours=None,
            beers=[{"name": "Plzeň", "price_czk": 62, "volume_ml": 500}],
        ),
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["beers"] == [
        {"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500}
    ]

    record = PubCommunityData.objects.get()
    assert record.beers == [{"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500}]

    link = PubBeerBrand.objects.get(cache_key=_KEY)
    assert link.brand_key == "pilsner-urquell"
    assert link.brand_name == "Pilsner Urquell"
    assert link.last_price_czk == 62
    assert link.last_volume_ml == 500
    assert link.source == PubBeerBrand.Source.COMMUNITY


@pytest.mark.django_db
def test_submit_beers_normalizes_product_and_indexes_brand_and_product(client):
    token = _register(client)
    resp = client.post(
        "/v1/pub-community",
        data=_payload(
            hours=None,
            beers=[{"name": "Kozel 11", "price_czk": 49, "volume_ml": 500}],
        ),
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["beers"] == [
        {"name": "Velkopopovický Kozel 11°", "price_czk": 49, "volume_ml": 500}
    ]

    brand_link = PubBeerBrand.objects.get(cache_key=_KEY)
    assert brand_link.brand_key == "velkopopovicky-kozel"
    assert brand_link.brand_name == "Velkopopovický Kozel"

    product_link = PubBeerProduct.objects.get(cache_key=_KEY)
    assert product_link.product_key == "velkopopovicky-kozel-11"
    assert product_link.product_name == "Velkopopovický Kozel 11°"
    assert product_link.brand_key == "velkopopovicky-kozel"
    assert product_link.last_price_czk == 49


@pytest.mark.django_db
def test_submit_beers_reuses_catalog_cache_for_normalize_and_index_sync(client):
    token = _register(client)

    with CaptureQueriesContext(connection) as queries:
        resp = client.post(
            "/v1/pub-community",
            data=_payload(
                hours=None,
                beers=[
                    {"name": "Plzeň", "price_czk": 62, "volume_ml": 500},
                    {"name": "Kozel 11", "price_czk": 49, "volume_ml": 500},
                ],
            ),
            format="json",
            **_auth(token),
        )

    assert resp.status_code == status.HTTP_200_OK
    assert count_beer_catalog_selects(queries.captured_queries) == (1, 0)
    assert PubBeerBrand.objects.filter(cache_key=_KEY, active=True).count() == 2
    assert PubBeerProduct.objects.filter(cache_key=_KEY, active=True).count() == 2


@pytest.mark.django_db
def test_submit_beers_replaces_active_brand_and_product_indexes(client):
    token = _register(client)
    first = client.post(
        "/v1/pub-community",
        data=_payload(
            hours=None,
            beers=[{"name": "Kozel 11", "price_czk": 49, "volume_ml": 500}],
            client_id="aaaaaaaa-0000-0000-0000-000000000001",
        ),
        format="json",
        **_auth(token),
    )
    assert first.status_code == status.HTTP_200_OK

    second = client.post(
        "/v1/pub-community",
        data=_payload(
            hours=None,
            beers=[{"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500}],
            client_id="aaaaaaaa-0000-0000-0000-000000000002",
        ),
        format="json",
        **_auth(token),
    )
    assert second.status_code == status.HTTP_200_OK

    active_brand_keys = set(
        PubBeerBrand.objects.filter(cache_key=_KEY, active=True).values_list(
            "brand_key", flat=True
        )
    )
    inactive_brand_keys = set(
        PubBeerBrand.objects.filter(cache_key=_KEY, active=False).values_list(
            "brand_key", flat=True
        )
    )
    active_product_keys = set(
        PubBeerProduct.objects.filter(cache_key=_KEY, active=True).values_list(
            "product_key", flat=True
        )
    )
    inactive_product_keys = set(
        PubBeerProduct.objects.filter(cache_key=_KEY, active=False).values_list(
            "product_key", flat=True
        )
    )

    assert active_brand_keys == {"pilsner-urquell"}
    assert inactive_brand_keys == {"velkopopovicky-kozel"}
    assert active_product_keys == {"pilsner-urquell"}
    assert inactive_product_keys == {"velkopopovicky-kozel-11"}


@pytest.mark.django_db
def test_submit_empty_beers_deactivates_existing_beer_indexes(client):
    token = _register(client)
    first = client.post(
        "/v1/pub-community",
        data=_payload(
            hours=None,
            beers=[{"name": "Kozel 11", "price_czk": 49, "volume_ml": 500}],
            client_id="aaaaaaaa-0000-0000-0000-000000000001",
        ),
        format="json",
        **_auth(token),
    )
    assert first.status_code == status.HTTP_200_OK

    second = client.post(
        "/v1/pub-community",
        data=_payload(
            hours=None,
            beers=[],
            client_id="aaaaaaaa-0000-0000-0000-000000000002",
        ),
        format="json",
        **_auth(token),
    )
    assert second.status_code == status.HTTP_200_OK

    assert PubBeerBrand.objects.filter(cache_key=_KEY, active=True).count() == 0
    assert PubBeerProduct.objects.filter(cache_key=_KEY, active=True).count() == 0
    assert PubBeerBrand.objects.filter(cache_key=_KEY, active=False).count() == 1
    assert PubBeerProduct.objects.filter(cache_key=_KEY, active=False).count() == 1


# ---------------------------------------------------------------------------
# Read-path precedence (POST /v1/pub-hours)
# ---------------------------------------------------------------------------


def _make_community(**kwargs) -> PubCommunityData:
    defaults = dict(
        cache_key=_KEY,
        name=_NAME,
        lat=_LAT,
        lng=_LNG,
        hours_json=_FULL_HOURS,
        opening_hours_raw=community_hours_to_osm(_FULL_HOURS),
        beers=_BEERS,
    )
    defaults.update(kwargs)
    return PubCommunityData.objects.create(**defaults)


@pytest.mark.django_db
def test_read_community_hours_override_firmy(client):
    from pubs.api.tests.test_views import _make_fresh_row

    hours_updated_at = datetime(
        2026, 7, 20, 12, 34, 56, tzinfo=ZoneInfo("Europe/Prague")
    )
    _make_fresh_row()  # firmy PubHours for the same key
    _make_community(
        historical_beers=[
            {"name": "Gambrinus 10", "price_czk": 48, "volume_ml": 500}
        ],
        hours_updated_at=hours_updated_at,
    )

    resp = client.post(
        "/v1/pub-hours",
        data={"pubs": [{"name": _NAME, "lat": _LAT, "lng": _LNG}]},
        format="json",
    )

    assert resp.status_code == status.HTTP_200_OK
    r = resp.json()["results"][0]
    assert r["source"] == "community"
    assert r["status"] == "ok"
    assert r["opening_hours"] == community_hours_to_osm(_FULL_HOURS)
    assert r["hours_json"] == _FULL_HOURS
    assert r["beers"] == _BEERS
    assert r["historical_beers"] == [
        {"name": "Gambrinus 10", "price_czk": 48, "volume_ml": 500}
    ]
    assert datetime.fromisoformat(r["hours_updated_at"]) == hours_updated_at
    assert r["rating"] == pytest.approx(4.1)
    assert r["ratingCount"] == 364
    assert r["ratingLabel"] == "Velmi dobré"
    # isOpenNow / nextChange are computed from the community OSM string.
    assert r["isOpenNow"] in (True, False)


@pytest.mark.django_db
def test_read_community_hours_do_not_schedule_enrich_task(client):
    _make_community()
    resp = client.post(
        "/v1/pub-hours",
        data={
            "pubs": [{"name": _NAME, "lat": _LAT, "lng": _LNG}],
            "sync_budget": 0,
        },
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["results"][0]["source"] == "community"
    # Community hours satisfy the pub; no firmy enrichment task is queued.
    assert not EnrichTask.objects.filter(cache_key=_KEY).exists()


@pytest.mark.django_db
def test_read_community_beers_attached_to_firmy_result(client):
    """Community data with beers but NO hours → firmy hours kept, beers added."""
    from pubs.api.tests.test_views import _FLEKY_HOURS, _make_fresh_row

    _make_fresh_row()
    _make_community(hours_json=None, opening_hours_raw="")

    resp = client.post(
        "/v1/pub-hours",
        data={"pubs": [{"name": _NAME, "lat": _LAT, "lng": _LNG}]},
        format="json",
    )

    assert resp.status_code == status.HTTP_200_OK
    r = resp.json()["results"][0]
    # Firmy hours retained (community had no hours).
    assert r["opening_hours"] == _FLEKY_HOURS
    assert r["source"] == "firmy"
    # But community beers are attached.
    assert r["beers"] == _BEERS


@pytest.mark.django_db
def test_read_no_community_data_keeps_firmy_and_empty_beers(client):
    from pubs.api.tests.test_views import _make_fresh_row

    _make_fresh_row()
    resp = client.post(
        "/v1/pub-hours",
        data={"pubs": [{"name": _NAME, "lat": _LAT, "lng": _LNG}]},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    r = resp.json()["results"][0]
    assert r["source"] == "firmy"
    assert r["beers"] == []
    assert r["hours_updated_at"] is None
    assert r["hours_json"] is None


@pytest.mark.django_db
def test_read_community_collision_guard_rejects_mismatched_name(client):
    """A different business in the same ~38 m cell must not get this community data."""
    _make_community()  # name = "Restaurace U Fleků"

    resp = client.post(
        "/v1/pub-hours",
        data={
            # Same coords, totally different name → names_match fails.
            "pubs": [{"name": "Bistro Veganburger", "lat": _LAT, "lng": _LNG}],
            "sync_budget": 0,
        },
        format="json",
    )

    assert resp.status_code == status.HTTP_200_OK
    r = resp.json()["results"][0]
    # Community data is NOT served; falls through to the firmy path (pending here).
    assert r["source"] != "community"
    assert r["opening_hours"] is None
    assert r["beers"] == []


# ---------------------------------------------------------------------------
# venueKind: community-beers override (POST /v1/pub-hours)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_community_hours_with_beers_force_venue_kind_pub(client):
    """Community hours + non-empty beers → venueKind 'pub'."""
    _make_community()  # has beers
    resp = client.post(
        "/v1/pub-hours",
        data={"pubs": [{"name": _NAME, "lat": _LAT, "lng": _LNG}]},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    r = resp.json()["results"][0]
    assert r["source"] == "community"
    assert r["venueKind"] == "pub"


@pytest.mark.django_db
def test_community_beers_override_firmy_not_pub_verdict(client):
    """Even if the stored firmy verdict is 'not_pub', non-empty community beers
    force venueKind 'pub' (the community knows best)."""
    from pubs.api.tests.test_views import _make_fresh_row
    from pubs.models import PubHours

    # Firmy says not_pub, but the community listed beers on tap.
    _make_fresh_row(venue_kind=PubHours.VenueKind.NOT_PUB)
    _make_community(hours_json=None, opening_hours_raw="")  # beers only

    resp = client.post(
        "/v1/pub-hours",
        data={"pubs": [{"name": _NAME, "lat": _LAT, "lng": _LNG}]},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    r = resp.json()["results"][0]
    assert r["source"] == "firmy"  # firmy hours kept (community had none)
    assert r["beers"] == _BEERS
    assert r["venueKind"] == "pub"  # overridden


@pytest.mark.django_db
def test_community_hours_without_beers_does_not_force_pub(client):
    """Community hours but an EMPTY beer list must NOT force 'pub'."""
    _make_community(beers=[])
    resp = client.post(
        "/v1/pub-hours",
        data={"pubs": [{"name": _NAME, "lat": _LAT, "lng": _LNG}]},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    r = resp.json()["results"][0]
    assert r["source"] == "community"
    assert r["venueKind"] == "unknown"


# ---------------------------------------------------------------------------
# Throttle scope existence
# ---------------------------------------------------------------------------


def test_community_throttle_scope_configured(settings):
    assert "community" in settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]


# ---------------------------------------------------------------------------
# Mapér XP for hours/beers contributions
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_first_contribution_awards_first_fact_xp_per_kind(client, settings):
    from pubs.models import AccountUsageStats, PubCommunityXpLedger

    token = _register(client)
    resp = client.post("/v1/pub-community", data=_payload(), format="json", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()

    # hours + beers = two first-facts.
    assert body["xp_awarded"] == 2 * settings.MAPER_XP_FIRST_FACT
    mapper = body["mapper"]
    assert mapper is not None
    assert mapper["xp"] == 2 * settings.MAPER_XP_FIRST_FACT
    assert mapper["distinct_mapped_pubs"] == 1
    assert mapper["amenity_votes_count"] == 2
    assert {"level", "title", "xp_into_level", "xp_for_next_level"} <= set(mapper)

    assert PubCommunityXpLedger.objects.count() == 2
    stats = AccountUsageStats.objects.get()
    assert stats.mapper_xp == 2 * settings.MAPER_XP_FIRST_FACT


@pytest.mark.django_db
def test_reedit_same_pub_pays_zero(client, settings):
    """A retried/edited contribution to a pub already mapped by the account
    pays no further XP (durable per-(account, cache_key, kind) ledger)."""
    token = _register(client)
    client.post("/v1/pub-community", data=_payload(), format="json", **_auth(token))

    # Re-edit with a fresh client_id (the contribution log row differs, but the
    # XP ledger key is (account, cache_key, kind), so XP stays put).
    resp = client.post(
        "/v1/pub-community",
        data=_payload(client_id=_OTHER_DEVICE_ID),
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["xp_awarded"] == 0
    assert body["mapper"]["xp"] == 2 * settings.MAPER_XP_FIRST_FACT


@pytest.mark.django_db
def test_hours_only_then_beers_only_each_award_once(client, settings):
    token = _register(client)

    r1 = client.post(
        "/v1/pub-community",
        data={"name": _NAME, "lat": _LAT, "lng": _LNG, "client_id": _CLIENT_ID, "hours": _FULL_HOURS},
        format="json",
        **_auth(token),
    ).json()
    assert r1["xp_awarded"] == settings.MAPER_XP_FIRST_FACT

    # Beers later (different client_id) — a new kind, so it pays its own first-fact.
    r2 = client.post(
        "/v1/pub-community",
        data={"name": _NAME, "lat": _LAT, "lng": _LNG, "client_id": _OTHER_DEVICE_ID, "beers": _BEERS},
        format="json",
        **_auth(token),
    ).json()
    assert r2["xp_awarded"] == settings.MAPER_XP_FIRST_FACT
    assert r2["mapper"]["xp"] == 2 * settings.MAPER_XP_FIRST_FACT
    # The pub is counted once across both contributions.
    assert r2["mapper"]["distinct_mapped_pubs"] == 1


@pytest.mark.django_db
def test_xp_shares_distinct_pub_marker_with_amenities(client):
    """An hours contribution must not double-count a pub the account already
    mapped via an amenity vote (shared AccountMappedPub marker)."""
    from pubs.models import AccountMappedPub

    token = _register(client)
    client.post(
        "/v1/pub-community",
        data={"name": _NAME, "lat": _LAT, "lng": _LNG, "client_id": _CLIENT_ID, "hours": _FULL_HOURS},
        format="json",
        **_auth(token),
    )
    assert AccountMappedPub.objects.count() == 1


# ---------------------------------------------------------------------------
# UGC consent gating (RED — writes are not gated yet)
# ---------------------------------------------------------------------------


def _policy_header() -> dict[str, str]:
    return {
        "HTTP_" + UGC_POLICY_HEADER.replace("-", "_").upper(): settings.UGC_POLICY_VERSION
    }


def _accept_ugc(client: APIClient, token: str) -> None:
    accepted = client.put(
        "/v1/account/me/ugc-consent",
        data={"version": settings.UGC_POLICY_VERSION},
        format="json",
        **_auth(token),
    )
    assert accepted.status_code == status.HTTP_200_OK, accepted.content


@pytest.mark.django_db
def test_submit_with_current_header_and_no_acceptance_returns_428(client):
    token = _register(client)

    denied = client.post(
        "/v1/pub-community",
        data=_payload(),
        format="json",
        **_auth(token),
        **_policy_header(),
    )

    assert denied.status_code == 428, denied.content
    assert denied.json()["code"] == "ugc_consent_required"
    assert PubCommunityData.objects.count() == 0
    assert PubContributionLog.objects.count() == 0


@pytest.mark.django_db
def test_accepted_account_submits_with_current_header(client):
    token = _register(client)
    _accept_ugc(client, token)

    resp = client.post(
        "/v1/pub-community",
        data=_payload(),
        format="json",
        **_auth(token),
        **_policy_header(),
    )

    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert PubCommunityData.objects.count() == 1


@pytest.mark.django_db
def test_legacy_submit_without_policy_header_still_succeeds(client):
    token = _register(client)

    resp = client.post("/v1/pub-community", data=_payload(), format="json", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    assert PubCommunityData.objects.count() == 1


@pytest.mark.django_db
def test_pub_hours_read_is_not_blocked_by_consent_gate(client):
    _register(client)  # no acceptance stored on purpose

    read = client.post(
        "/v1/pub-hours",
        data={"pubs": [{"name": _NAME, "lat": _LAT, "lng": _LNG}]},
        format="json",
        **_policy_header(),
    )

    assert read.status_code == status.HTTP_200_OK


# ---------------------------------------------------------------------------
# One-beer changes (beer_change): applied to the menu as it is now
# ---------------------------------------------------------------------------

_MENU_NOW = [
    {"name": "Pilsner Urquell", "price_czk": 59, "volume_ml": 500},
    {"name": "Velkopopovický Kozel 11°", "price_czk": 45, "volume_ml": 500},
    {"name": "Bernard 12°", "price_czk": 52, "volume_ml": 500},
]


def _seed_menu(client: APIClient, token: str, beers: list[dict]) -> None:
    payload = _payload(client_id="aaaaaaaa-0000-0000-0000-0000000000a1", beers=beers)
    payload.pop("hours")
    resp = client.post("/v1/pub-community", data=payload, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK


def _change(client: APIClient, token: str, client_id: str, stale_beers: list[dict], change: dict):
    payload = _payload(client_id=client_id, beers=stale_beers, beer_change=change)
    payload.pop("hours")
    return client.post("/v1/pub-community", data=payload, format="json", **_auth(token))


@pytest.mark.django_db
def test_beer_change_remove_applies_to_current_menu_not_the_sent_list(client):
    token = _register(client)
    _seed_menu(client, token, _MENU_NOW)

    # The app read the menu before Bernard arrived and removes Pilsner.
    resp = _change(
        client,
        token,
        "aaaaaaaa-0000-0000-0000-0000000000a2",
        [_MENU_NOW[1]],
        {"action": "remove", "name": "Pilsner Urquell", "volume_ml": 500},
    )

    assert resp.status_code == status.HTTP_200_OK
    record = PubCommunityData.objects.get()
    assert record.beers == [_MENU_NOW[1], _MENU_NOW[2]]
    assert record.historical_beers == [_MENU_NOW[0]]
    assert resp.json()["beers"] == [_MENU_NOW[1], _MENU_NOW[2]]
    log = PubContributionLog.objects.get(client_id="aaaaaaaa-0000-0000-0000-0000000000a2")
    assert log.payload["beer_change"]["action"] == "remove"


@pytest.mark.django_db
def test_beer_change_update_fixes_one_price_and_keeps_newer_beers(client):
    token = _register(client)
    _seed_menu(client, token, _MENU_NOW)

    resp = _change(
        client,
        token,
        "aaaaaaaa-0000-0000-0000-0000000000a3",
        [{**_MENU_NOW[1], "price_czk": 49}],
        {
            "action": "update",
            "name": "velkopopovicky kozel 11",
            "volume_ml": 500,
            "price_czk": 49,
            "new_volume_ml": 500,
        },
    )

    assert resp.status_code == status.HTTP_200_OK
    assert PubCommunityData.objects.get().beers == [
        _MENU_NOW[0],
        {"name": "Velkopopovický Kozel 11°", "price_czk": 49, "volume_ml": 500},
        _MENU_NOW[2],
    ]


@pytest.mark.django_db
def test_beer_change_for_a_beer_already_gone_changes_nothing(client):
    token = _register(client)
    _seed_menu(client, token, _MENU_NOW[:2])
    before = PubCommunityData.objects.get()

    # Someone else already removed it: the fix must not bring it back.
    resp = _change(
        client,
        token,
        "aaaaaaaa-0000-0000-0000-0000000000a4",
        [_MENU_NOW[0], {**_MENU_NOW[2], "price_czk": 55}],
        {"action": "update", "name": "Bernard 12°", "volume_ml": 500, "price_czk": 55},
    )

    assert resp.status_code == status.HTTP_200_OK
    record = PubCommunityData.objects.get()
    assert record.beers == _MENU_NOW[:2]
    assert record.beers_updated_at == before.beers_updated_at
    assert resp.json()["beers"] == _MENU_NOW[:2]
    assert not PubContributionLog.objects.filter(
        client_id="aaaaaaaa-0000-0000-0000-0000000000a4"
    ).exists()


@pytest.mark.django_db
def test_beer_change_moving_to_an_existing_size_keeps_one_row(client):
    token = _register(client)
    small = {"name": "Pilsner Urquell", "price_czk": 45, "volume_ml": 300}
    _seed_menu(client, token, [small, _MENU_NOW[0]])

    resp = _change(
        client,
        token,
        "aaaaaaaa-0000-0000-0000-0000000000a5",
        [{"name": "Pilsner Urquell", "price_czk": 40, "volume_ml": 300}],
        {
            "action": "update",
            "name": "Pilsner Urquell",
            "volume_ml": 500,
            "price_czk": 40,
            "new_volume_ml": 300,
        },
    )

    assert resp.status_code == status.HTTP_200_OK
    assert PubCommunityData.objects.get().beers == [
        {"name": "Pilsner Urquell", "price_czk": 40, "volume_ml": 300},
    ]


@pytest.mark.django_db
def test_beer_change_validation(client):
    token = _register(client)
    no_price = _change(
        client,
        token,
        "aaaaaaaa-0000-0000-0000-0000000000a6",
        _MENU_NOW,
        {"action": "update", "name": "Bernard 12°", "volume_ml": 500},
    )
    assert no_price.status_code == status.HTTP_400_BAD_REQUEST

    without_beers = _payload(
        client_id="aaaaaaaa-0000-0000-0000-0000000000a7",
        beer_change={"action": "remove", "name": "Bernard 12°", "volume_ml": 500},
    )
    without_beers.pop("beers")
    resp = client.post("/v1/pub-community", data=without_beers, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_beer_change_retry_never_repeats_a_step_that_went_through(client):
    token = _register(client)
    other = _register(client, _OTHER_DEVICE_ID)
    _seed_menu(client, token, _MENU_NOW)
    fix_65 = {"action": "update", "name": "Bernard 12°", "volume_ml": 500, "price_czk": 65}

    first = _change(client, token, "aaaaaaaa-0000-0000-0000-0000000000b1", _MENU_NOW, fix_65)
    assert first.status_code == status.HTTP_200_OK
    # Someone else fixes the price later; then the first request is retried.
    later = _change(
        client,
        other,
        "aaaaaaaa-0000-0000-0000-0000000000b2",
        _MENU_NOW,
        {**fix_65, "price_czk": 70},
    )
    assert later.status_code == status.HTTP_200_OK
    retry = _change(client, token, "aaaaaaaa-0000-0000-0000-0000000000b1", _MENU_NOW, fix_65)

    assert retry.status_code == status.HTTP_200_OK
    assert PubCommunityData.objects.get().beers[2]["price_czk"] == 70


@pytest.mark.django_db
def test_beer_change_starts_from_the_imported_menu_people_see(client):
    from pubs.models import PubExternalBeerMenu

    token = _register(client)
    PubExternalBeerMenu.objects.create(
        cache_key=_KEY,
        name=_NAME,
        lat=_LAT,
        lng=_LNG,
        source=PubExternalBeerMenu.Source.PIVAROVA_MAPA,
        source_id="pm-1",
        source_url="https://example.com/pm-1",
        beers=_MENU_NOW,
    )

    resp = _change(
        client,
        token,
        "aaaaaaaa-0000-0000-0000-0000000000b3",
        _MENU_NOW[1:],
        {"action": "remove", "name": "Pilsner Urquell", "volume_ml": 500},
    )

    assert resp.status_code == status.HTTP_200_OK
    record = PubCommunityData.objects.get()
    assert record.beers == _MENU_NOW[1:]
    assert record.historical_beers == [_MENU_NOW[0]]


@pytest.mark.django_db
def test_a_retry_finishes_an_index_sync_that_failed_after_the_change(client, monkeypatch):
    token = _register(client)
    _seed_menu(client, token, _MENU_NOW)
    remove = {"action": "remove", "name": "Pilsner Urquell", "volume_ml": 500}

    import pubs.api.views as views

    real_sync = views.sync_pub_beer_indexes_for_menu
    calls = {"n": 0}

    def flaky_sync(**kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("index down")
        return real_sync(**kwargs)

    monkeypatch.setattr(views, "sync_pub_beer_indexes_for_menu", flaky_sync)
    failed = _change(client, token, "aaaaaaaa-0000-0000-0000-0000000000b4", _MENU_NOW[1:], remove)
    assert failed.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    # The menu change itself is saved; only the indexes are behind.
    assert PubCommunityData.objects.get().beers == _MENU_NOW[1:]

    retried = _change(client, token, "aaaaaaaa-0000-0000-0000-0000000000b4", _MENU_NOW[1:], remove)
    assert retried.status_code == status.HTTP_200_OK
    assert PubCommunityData.objects.get().beers == _MENU_NOW[1:]
    # The retry ran the sync for the saved menu instead of the change again.
    assert calls["n"] == 2


@pytest.mark.django_db
def test_beer_change_also_reaches_the_menu_of_a_merged_duplicate(client):
    from django.utils import timezone

    from pubs.identity import normalize_pub_name
    from pubs.models import CanonicalPub, PubAlias

    token = _register(client)
    canonical = CanonicalPub.objects.create(
        cache_key=_KEY, name=_NAME, name_key=normalize_pub_name(_NAME), lat=_LAT, lng=_LNG, city="Praha"
    )
    PubAlias.objects.create(
        canonical_pub=canonical, cache_key=_KEY, name=_NAME,
        name_key=normalize_pub_name(_NAME), lat=_LAT, lng=_LNG, is_primary=True,
    )
    PubAlias.objects.create(
        canonical_pub=canonical, cache_key="u2fkbq00", name="Stará hospoda",
        name_key=normalize_pub_name("Stará hospoda"), lat=_LAT, lng=_LNG,
    )
    PubCommunityData.objects.create(
        cache_key="u2fkbq00", name="Stará hospoda", lat=_LAT, lng=_LNG,
        beers=_MENU_NOW[:2], beers_updated_at=timezone.now(),
    )

    resp = _change(
        client,
        token,
        "aaaaaaaa-0000-0000-0000-0000000000c1",
        [_MENU_NOW[1]],
        {"action": "remove", "name": "Pilsner Urquell", "volume_ml": 500},
    )

    assert resp.status_code == status.HTTP_200_OK
    assert PubCommunityData.objects.get(cache_key=_KEY).beers == [_MENU_NOW[1]]
    assert PubCommunityData.objects.get(cache_key="u2fkbq00").beers == [_MENU_NOW[1]]
    # The duplicate's menu has its own record, so rebuilding it later keeps the change.
    alias_log = PubContributionLog.objects.get(cache_key="u2fkbq00")
    assert alias_log.payload["beers"] == [_MENU_NOW[1]]
    shown = client.post(
        "/v1/pub-hours",
        data={"pubs": [{"name": _NAME, "lat": _LAT, "lng": _LNG}], "sync_budget": 0},
        format="json",
    ).json()["results"][0]
    assert [beer["name"] for beer in shown["beers"]] == ["Velkopopovický Kozel 11°"]


@pytest.mark.django_db
def test_beer_change_with_no_menu_to_change_leaves_no_row_behind(client):
    token = _register(client)

    resp = _change(
        client,
        token,
        "aaaaaaaa-0000-0000-0000-0000000000c2",
        [],
        {"action": "remove", "name": "Pilsner Urquell", "volume_ml": 500},
    )

    assert resp.status_code == status.HTTP_200_OK
    assert not PubCommunityData.objects.exists()


@pytest.mark.django_db
def test_rebuilding_a_merged_duplicate_menu_keeps_a_removed_beer_gone(client):
    from pubs.accounts import _rebuild_community_signals_after_purge
    from pubs.identity import normalize_pub_name
    from pubs.models import CanonicalPub, PubAlias

    token = _register(client)
    _register(client, _OTHER_DEVICE_ID)
    canonical = CanonicalPub.objects.create(
        cache_key=_KEY, name=_NAME, name_key=normalize_pub_name(_NAME), lat=_LAT, lng=_LNG, city="Praha"
    )
    PubAlias.objects.create(
        canonical_pub=canonical, cache_key=_KEY, name=_NAME,
        name_key=normalize_pub_name(_NAME), lat=_LAT, lng=_LNG, is_primary=True,
    )
    PubAlias.objects.create(
        canonical_pub=canonical, cache_key="u2fkbq00", name="Stará hospoda",
        name_key=normalize_pub_name("Stará hospoda"), lat=_LAT, lng=_LNG,
    )
    # Someone else wrote the duplicate's menu before the pubs were merged.
    from django.utils import timezone

    author = Account.objects.get(device_id=_OTHER_DEVICE_ID)
    PubCommunityData.objects.create(
        cache_key="u2fkbq00", name="Stará hospoda", lat=_LAT, lng=_LNG,
        beers=_MENU_NOW[:2], beers_updated_at=timezone.now(), account=author,
    )
    PubContributionLog.objects.create(
        account=author, client_id="aaaaaaaa-0000-0000-0000-0000000000d1",
        kind=PubContributionLog.Kind.BEERS, cache_key="u2fkbq00", name="Stará hospoda",
        lat=_LAT, lng=_LNG, payload=_MENU_NOW[:2],
    )

    _change(
        client,
        token,
        "aaaaaaaa-0000-0000-0000-0000000000d2",
        [_MENU_NOW[1]],
        {"action": "remove", "name": "Pilsner Urquell", "volume_ml": 500},
    )
    _rebuild_community_signals_after_purge("u2fkbq00")

    assert PubCommunityData.objects.get(cache_key="u2fkbq00").beers == [_MENU_NOW[1]]
