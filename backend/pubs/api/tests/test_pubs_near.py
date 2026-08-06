"""Tests for the local-only GET /v1/pubs/near directory lookup."""

from __future__ import annotations

from datetime import UTC, timedelta
from unittest.mock import patch

import pytest
from django.core.cache import cache as default_cache
from django.utils import timezone as dj_tz
from rest_framework import status
from rest_framework.test import APIClient

from pubs.enrichment import (
    geohash6,
    geohash8,
)
from pubs.models import (
    Account,
    AmenityKind,
    BeerBrand,
    PubAmenity,
    PubBeerBrand,
    PubCommunityData,
    PubDirectory,
    PubHours,
    PubNameCorrection,
    PubPriceIndex,
    PubReport,
    PubSearchCache,
    UserAddedPub,
)
from pubs.pub_merge import apply_pub_merge_plan, build_pub_merge_plan

# Prague centre-ish coordinates.
_LAT = 50.0812
_LNG = 14.4182
_KEY = geohash6(_LAT, _LNG)

_ITEM = {
    "name": "Hospoda U Testu",
    "label": "Hospoda",
    "position": {"lat": 50.08, "lon": 14.42},
    "regionalStructure": [{"name": "Praha", "type": "regional.municipality"}],
}


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _nearby_test_settings(settings):
    """Keep shared throttle state from leaking between nearby tests."""
    settings.PUBS_NEAR_LOCAL_FIRST = False
    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {
            **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
            "pubs_near": "10000/min",
        },
    }


def _amenity(
    key: str,
    *,
    name: str = "Hospoda U Testu",
    lat: float = 50.08,
    lng: float = 14.42,
    status_value: str = PubAmenity.Status.YES,
    external_id: str = "",
) -> PubAmenity:
    return PubAmenity.objects.create(
        cache_key=geohash8(lat, lng),
        pub_identity_key=f"{geohash8(lat, lng)}::{name.casefold()}",
        amenity_key=key,
        name=name,
        lat=lat,
        lng=lng,
        city="Praha",
        external_id=external_id,
        status=status_value,
        confidence=0.75 if status_value == PubAmenity.Status.YES else 0.25,
        yes_count=2 if status_value == PubAmenity.Status.YES else 0,
        no_count=2 if status_value == PubAmenity.Status.NO else 0,
        distinct_voter_count=2,
    )


def _directory_pub(
    name: str = "Hospoda Z Adresáře",
    *,
    lat: float = _LAT,
    lng: float = _LNG,
    city: str = "Praha",
    country: str = "cz",
    venue_kind: str = "pub",
    discovery_kind: str = PubDirectory.DiscoveryKind.PUB,
    has_beer_signal: bool = False,
    active: bool = True,
) -> PubDirectory:
    return PubDirectory.objects.create(
        name=name,
        lat=lat,
        lng=lng,
        city=city,
        country=country,
        venue_kind=venue_kind,
        discovery_kind=discovery_kind,
        has_beer_signal=has_beer_signal,
        source="test",
        active=active,
        refreshed_at=dj_tz.now(),
    )


def _seed_near_cache(items: list[dict], *, radius_bucket: int = 50, age_days: int = 0):
    return PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=radius_bucket,
        items=items,
        fetched_at=dj_tz.now() - timedelta(days=age_days),
    )


# ---------------------------------------------------------------------------
# Local PubDirectory branch
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_local_directory_cannot_be_disabled_by_legacy_flag(client, settings):
    settings.PUBS_NEAR_LOCAL_FIRST = False
    _directory_pub()
    resp = client.get(
        "/v1/pubs/near",
        data={"lat": _LAT, "lng": _LNG, "radius_km": 1},
    )

    assert resp.status_code == status.HTTP_200_OK
    assert [item["name"] for item in resp.json()["items"]] == ["Hospoda Z Adresáře"]


@pytest.mark.django_db
def test_local_first_serves_directory_without_provider_or_search_cache(client, settings):
    settings.PUBS_NEAR_LOCAL_FIRST = True
    _directory_pub()
    resp = client.get(
        "/v1/pubs/near",
        data={"lat": _LAT, "lng": _LNG, "radius_km": 1},
    )

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cached"] is True
    assert [item["name"] for item in body["items"]] == ["Hospoda Z Adresáře"]
    assert body["fetched_at"]
    assert not PubSearchCache.objects.exists()


@pytest.mark.django_db
def test_reviewed_aliases_render_as_one_canonical_pub(client, settings):
    settings.PUBS_NEAR_LOCAL_FIRST = True
    source = _directory_pub(
        "Testovací pivovar - restaurace",
        lat=_LAT,
        lng=_LNG,
    )
    target = _directory_pub(
        "Testovací pivovar",
        lat=_LAT + 0.0004,
        lng=_LNG + 0.0004,
    )
    UserAddedPub.objects.create(
        client_id="f18c93e6-d17a-4ad5-a29d-a4968ca534a6",
        cache_key=target.cache_key,
        name=target.name,
        lat=target.lat + 0.00001,
        lng=target.lng + 0.00001,
        city=target.city,
    )
    plan = build_pub_merge_plan(
        source_cache_key=source.cache_key,
        source_name=source.name,
        target_cache_key=target.cache_key,
        target_name=target.name,
        canonical_name="Testovací pivovar",
    )
    audit = apply_pub_merge_plan(plan, actor="test", reason="reviewed")

    resp = client.get(
        "/v1/pubs/near",
        data={"lat": _LAT, "lng": _LNG, "radius_km": 1},
    )

    assert resp.status_code == status.HTTP_200_OK
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["name"] == "Testovací pivovar"
    assert items[0]["canonicalPubId"] == str(audit.canonical_pub.public_id)


@pytest.mark.django_db
@pytest.mark.parametrize("age_days, expected", [(364, True), (365, False), (366, False)])
def test_near_attaches_only_fresh_price_without_changing_existing_shape(
    client,
    age_days,
    expected,
):
    pub = _directory_pub()
    PubPriceIndex.objects.create(
        cache_key=pub.cache_key,
        name=pub.name,
        lat=pub.lat,
        lng=pub.lng,
        city=pub.city,
        price_czk=42,
        volume_ml=None,
        observed_at=dj_tz.now() - timedelta(days=age_days),
        source=PubPriceIndex.Source.COMMUNITY,
    )

    resp = client.get(
        "/v1/pubs/near",
        data={"lat": _LAT, "lng": _LNG, "radius_km": 1},
    )

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert set(body) == {"items", "cached", "fetched_at"}
    item = body["items"][0]
    if expected:
        assert item["pubDetails"]["price"] == {
            "czk": 42,
            "volume_ml": 500,
            "observed_at": (
                PubPriceIndex.objects.get().observed_at.astimezone(UTC)
                .isoformat()
                .replace("+00:00", "Z")
            ),
            "source": "community",
        }
    else:
        assert "pubDetails" not in item or "price" not in item["pubDetails"]


@pytest.mark.django_db
def test_directory_item_matches_legacy_wire_shape(client):
    from pubs.api.views import _pub_directory_item

    row = _directory_pub(venue_kind="maybe")
    item = _pub_directory_item(row)

    assert all(isinstance(entry["name"], str) for entry in item["regionalStructure"])
    assert all(isinstance(entry["type"], str) for entry in item["regionalStructure"])
    assert item == {
        "name": "Hospoda Z Adresáře",
        "label": "Restaurace a pohostinství",
        "position": {"lat": _LAT, "lon": _LNG},
        "regionalStructure": [
            {"name": "Praha", "type": "regional.municipality"},
            {
                "name": "Česko",
                "type": "regional.country",
                "isoCode": "CZ",
            },
        ],
    }


@pytest.mark.django_db
def test_local_first_hides_not_pub_and_inactive_rows(client, settings):
    settings.PUBS_NEAR_LOCAL_FIRST = True
    _directory_pub("Viditelná")
    _directory_pub("Není hospoda", lat=_LAT + 0.001, venue_kind="not_pub")
    _directory_pub("Neaktivní", lat=_LAT + 0.002, active=False)

    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 1})

    assert resp.status_code == status.HTTP_200_OK
    assert [item["name"] for item in resp.json()["items"]] == ["Viditelná"]


@pytest.mark.django_db
def test_local_first_hides_actively_reported_cache_key(client, settings):
    settings.PUBS_NEAR_LOCAL_FIRST = True
    visible = _directory_pub("Viditelná")
    reported = _directory_pub("Nahlášená", lat=_LAT + 0.001)
    accounts = [Account.objects.create(device_id=f"reporter-{index}") for index in range(3)]
    for account, reason in zip(
        accounts[:2],
        (PubReport.Reason.NOT_PUB, PubReport.Reason.CLOSED),
        strict=True,
    ):
        PubReport.objects.create(
            account=account,
            cache_key=reported.cache_key,
            name=reported.name,
            lat=reported.lat,
            lng=reported.lng,
            reason=reason,
            active=True,
        )
    PubReport.objects.create(
        account=accounts[0],
        cache_key=visible.cache_key,
        name=visible.name,
        lat=visible.lat,
        lng=visible.lng,
        reason=PubReport.Reason.CLOSED,
        active=False,
    )

    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 1})

    assert [item["name"] for item in resp.json()["items"]] == ["Viditelná", "Nahlášená"]

    PubReport.objects.create(
        account=accounts[2],
        cache_key=reported.cache_key,
        name=reported.name,
        lat=reported.lat,
        lng=reported.lng,
        reason=PubReport.Reason.CLOSED,
        active=True,
    )

    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 1})

    assert [item["name"] for item in resp.json()["items"]] == ["Viditelná"]


@pytest.mark.django_db
def test_local_first_applies_name_correction(client, settings):
    settings.PUBS_NEAR_LOCAL_FIRST = True
    row = _directory_pub()
    PubNameCorrection.objects.create(
        client_id="aaaaaaaa-1111-2222-3333-444444444451",
        cache_key=row.cache_key,
        original_name=row.name,
        suggested_name="Opravená hospoda",
        lat=row.lat,
        lng=row.lng,
        active=True,
    )

    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 1})

    assert resp.json()["items"][0]["name"] == "Opravená hospoda"


@pytest.mark.django_db
def test_local_first_merges_user_added_pub(client, settings):
    settings.PUBS_NEAR_LOCAL_FIRST = True
    _directory_pub()
    UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key="u2fk3abc",
        name="Hospoda Od Komunity",
        lat=_LAT + 0.0001,
        lng=_LNG + 0.0001,
        city="Praha",
    )

    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 1})

    assert [item["name"] for item in resp.json()["items"]] == [
        "Hospoda Od Komunity",
        "Hospoda Z Adresáře",
    ]


@pytest.mark.django_db
def test_local_directory_miss_returns_empty_without_provider(client, settings):
    settings.PUBS_NEAR_LOCAL_FIRST = True
    with patch("pubs.api.views.logger.info") as log_info:
        resp = client.get(
            "/v1/pubs/near",
            data={"lat": _LAT, "lng": _LNG, "radius_km": 1},
        )

    assert resp.json()["items"] == []
    log_info.assert_called_once()


@pytest.mark.django_db
def test_outside_coverage_returns_empty_without_provider(client, settings):
    settings.PUBS_NEAR_LOCAL_FIRST = True
    resp = client.get(
        "/v1/pubs/near",
        data={"lat": 48.2082, "lng": 16.3738, "radius_km": 1},
    )

    assert resp.json()["items"] == []


@pytest.mark.django_db
def test_local_first_cap_keeps_nearest_rows(client, settings):
    settings.PUBS_NEAR_LOCAL_FIRST = True
    settings.PUBS_NEAR_LOCAL_MAX_ITEMS = 3
    for index in range(5):
        _directory_pub(
            f"Hospoda {index}",
            lat=_LAT + (index + 1) * 0.001,
        )

    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 5})

    assert [item["name"] for item in resp.json()["items"]] == [
        "Hospoda 0",
        "Hospoda 1",
        "Hospoda 2",
    ]


@pytest.mark.django_db
def test_local_directory_prefers_confirmed_pub_at_similar_distance(client):
    _directory_pub(
        "Nejasná restaurace",
        lat=_LAT + 0.0004,
        venue_kind=PubHours.VenueKind.MAYBE,
    )
    _directory_pub(
        "Potvrzená hospoda",
        lat=_LAT + 0.0008,
        venue_kind=PubHours.VenueKind.PUB,
    )

    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 1})

    assert [item["name"] for item in resp.json()["items"]] == [
        "Potvrzená hospoda",
        "Nejasná restaurace",
    ]


@pytest.mark.django_db
def test_local_directory_keeps_distance_authoritative_across_relevance_bands(client):
    _directory_pub(
        "Blízká restaurace",
        lat=_LAT + 0.0004,
        venue_kind=PubHours.VenueKind.MAYBE,
    )
    _directory_pub(
        "Vzdálenější hospoda",
        lat=_LAT + 0.003,
        venue_kind=PubHours.VenueKind.PUB,
    )

    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 1})

    assert [item["name"] for item in resp.json()["items"]] == [
        "Blízká restaurace",
        "Vzdálenější hospoda",
    ]


@pytest.mark.django_db
def test_other_tap_places_are_opt_in_signal_gated_and_ranked_after_pubs(client):
    _directory_pub(
        "Potvrzená hospoda",
        lat=_LAT + 0.003,
    )
    _directory_pub(
        "Kemp s výčepem",
        lat=_LAT + 0.0002,
        discovery_kind=PubDirectory.DiscoveryKind.CAMPSITE,
        has_beer_signal=True,
    )
    _directory_pub(
        "Kemp bez piva",
        lat=_LAT + 0.0001,
        discovery_kind=PubDirectory.DiscoveryKind.CAMPSITE,
        has_beer_signal=False,
    )

    default = client.get(
        "/v1/pubs/near",
        data={"lat": _LAT, "lng": _LNG, "radius_km": 1},
    )
    opted_in = client.get(
        "/v1/pubs/near",
        data={
            "lat": _LAT,
            "lng": _LNG,
            "radius_km": 1,
            "include_other_places": "true",
        },
    )

    assert [item["name"] for item in default.json()["items"]] == ["Potvrzená hospoda"]
    assert [item["name"] for item in opted_in.json()["items"]] == [
        "Potvrzená hospoda",
        "Kemp s výčepem",
    ]
    assert opted_in.json()["items"][1]["discoveryKind"] == "campsite"
    assert opted_in.json()["applied_filters"]["include_other_places"] is True


@pytest.mark.django_db
def test_local_directory_bounds_haversine_scan_to_three_times_cap():
    from pubs.api import views

    for index in range(12):
        _directory_pub(
            f"Hospoda {index}",
            lat=_LAT + (index + 1) * 0.001,
        )

    with patch.object(views, "_haversine_km", wraps=views._haversine_km) as haversine:
        items = views._nearby_pub_directory_items(_LAT, _LNG, 5, 3)

    assert haversine.call_count == 9
    assert [item["name"] for item in items] == [
        "Hospoda 0",
        "Hospoda 1",
        "Hospoda 2",
    ]


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_missing_lat_lng_is_400(client):
    resp = client.get("/v1/pubs/near", data={"radius_km": 10})
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_out_of_range_lat_is_400(client):
    resp = client.get("/v1/pubs/near", data={"lat": 999, "lng": 14.0})
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_negative_radius_is_400(client):
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": -5})
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


# ---------------------------------------------------------------------------
# Local miss and legacy cache response shape
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_cache_miss_returns_empty_without_provider_or_persisting(client):
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cached"] is True
    assert body["items"] == []
    assert "fetched_at" in body and body["fetched_at"]
    assert not PubSearchCache.objects.exists()


@pytest.mark.django_db
def test_response_shape_only_expected_keys(client):
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG})
    body = resp.json()
    assert set(body.keys()) == {"items", "cached", "fetched_at"}


@pytest.mark.django_db
def test_name_correction_renames_fetched_items_without_changing_shape(client):
    PubNameCorrection.objects.create(
        client_id="aaaaaaaa-1111-2222-3333-444444444444",
        cache_key=geohash8(50.08, 14.42),
        external_id="mapy:50.08000,14.42000",
        original_name="Hospoda U Testu",
        suggested_name="U Testu po novém",
        lat=50.08,
        lng=14.42,
        active=True,
    )
    _seed_near_cache([_ITEM])
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert set(body.keys()) == {"items", "cached", "fetched_at"}
    assert body["items"][0]["name"] == "U Testu po novém"
    assert PubSearchCache.objects.get().items[0]["name"] == "Hospoda U Testu"


@pytest.mark.django_db
def test_inactive_name_correction_is_ignored(client):
    PubNameCorrection.objects.create(
        client_id="aaaaaaaa-1111-2222-3333-444444444445",
        cache_key=geohash8(50.08, 14.42),
        original_name="Hospoda U Testu",
        suggested_name="U Testu po novém",
        lat=50.08,
        lng=14.42,
        active=False,
    )
    _seed_near_cache([_ITEM])
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG})

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"][0]["name"] == "Hospoda U Testu"


@pytest.mark.django_db
def test_name_correction_cache_key_fallback_requires_matching_original_name(client):
    PubNameCorrection.objects.create(
        client_id="aaaaaaaa-1111-2222-3333-444444444446",
        cache_key=geohash8(50.08, 14.42),
        original_name="Hospoda U Testu",
        suggested_name="U Testu po novém",
        lat=50.08,
        lng=14.42,
        active=True,
    )
    other_item = {
        **_ITEM,
        "name": "Pivnice Za Rohem",
        "position": {"lat": 50.08, "lon": 14.42},
    }
    _seed_near_cache([other_item])
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG})

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"][0]["name"] == "Pivnice Za Rohem"


@pytest.mark.django_db
def test_name_correction_coordinate_external_id_requires_matching_original_name(client):
    PubNameCorrection.objects.create(
        client_id="aaaaaaaa-1111-2222-3333-444444444448",
        cache_key=geohash8(50.08, 14.42),
        external_id="mapy:50.08000,14.42000",
        original_name="Hospoda U Testu",
        suggested_name="U Testu po novém",
        lat=50.08,
        lng=14.42,
        active=True,
    )
    other_item = {
        **_ITEM,
        "name": "Pivnice Za Rohem",
        "position": {"lat": 50.08, "lon": 14.42},
    }
    _seed_near_cache([other_item])
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG})

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"][0]["name"] == "Pivnice Za Rohem"


@pytest.mark.django_db
def test_name_correction_coordinate_external_id_chains_renames(client):
    PubNameCorrection.objects.create(
        client_id="aaaaaaaa-1111-2222-3333-444444444449",
        cache_key=geohash8(50.08, 14.42),
        external_id="mapy:50.08000,14.42000",
        original_name="Hospoda U Testu",
        suggested_name="U Testu po novém",
        lat=50.08,
        lng=14.42,
        active=True,
    )
    PubNameCorrection.objects.create(
        client_id="aaaaaaaa-1111-2222-3333-444444444450",
        cache_key=geohash8(50.08, 14.42),
        external_id="mapy:50.08000,14.42000",
        original_name="U Testu po novém",
        suggested_name="U Testu",
        lat=50.08,
        lng=14.42,
        active=True,
    )
    _seed_near_cache([_ITEM])
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG})

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"][0]["name"] == "U Testu"


@pytest.mark.django_db
def test_name_correction_external_id_wins_without_original_name_match(client):
    PubNameCorrection.objects.create(
        client_id="aaaaaaaa-1111-2222-3333-444444444447",
        cache_key=geohash8(50.08, 14.42),
        external_id="provider-stable-id",
        original_name="Starý název",
        suggested_name="Nový název",
        lat=50.08,
        lng=14.42,
        active=True,
    )
    item = {
        **_ITEM,
        "id": "provider-stable-id",
        "name": "Úplně jiný upstream název",
    }
    _seed_near_cache([item])
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG})

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"][0]["name"] == "Nový název"


@pytest.mark.django_db
def test_beer_brand_filter_returns_only_known_brand_pubs_from_cache(client):
    brand, _ = BeerBrand.objects.get_or_create(
        key="pilsner-urquell",
        defaults={"name": "Pilsner Urquell"},
    )
    PubBeerBrand.objects.create(
        cache_key=geohash8(50.08, 14.42),
        name="Hospoda U Testu",
        lat=50.08,
        lng=14.42,
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        source=PubBeerBrand.Source.COMMUNITY,
    )
    other_item = {
        "name": "Hospoda Bez Plzně",
        "label": "Hospoda",
        "position": {"lat": 50.09, "lon": 14.43},
    }
    PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[_ITEM, other_item],
        fetched_at=dj_tz.now(),
    )

    resp = client.get(
        "/v1/pubs/near",
        data={
            "lat": _LAT,
            "lng": _LNG,
            "radius_km": 25,
            "beer_brand": "pilsner-urquell",
        },
    )

    assert resp.status_code == status.HTTP_200_OK
    names = [item["name"] for item in resp.json()["items"]]
    assert names == ["Hospoda U Testu"]
    assert resp.json()["items"][0]["source"] == "beer_signal"


@pytest.mark.django_db
def test_beer_brand_filter_keeps_only_qualifying_user_added_pub(client):
    brand, _ = BeerBrand.objects.get_or_create(
        key="pilsner-urquell",
        defaults={"name": "Pilsner Urquell"},
    )
    qualifying = UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key=geohash8(_LAT, _LNG),
        name="Komunitní s Plzní",
        lat=_LAT,
        lng=_LNG,
    )
    UserAddedPub.objects.create(
        client_id="aaaaaaaa-0000-0000-0000-000000000001",
        cache_key=geohash8(_LAT + 0.002, _LNG),
        name="Komunitní bez Plzně",
        lat=_LAT + 0.002,
        lng=_LNG,
    )
    PubBeerBrand.objects.create(
        cache_key=qualifying.cache_key,
        name=qualifying.name,
        lat=qualifying.lat,
        lng=qualifying.lng,
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        source=PubBeerBrand.Source.COMMUNITY,
    )

    resp = client.get(
        "/v1/pubs/near",
        data={
            "lat": _LAT,
            "lng": _LNG,
            "radius_km": 1,
            "beer_brand": brand.key,
        },
    )

    assert resp.status_code == status.HTTP_200_OK
    assert [item["name"] for item in resp.json()["items"]] == [qualifying.name]
    assert resp.json()["items"][0]["source"] == "community"
    # The suite's DRF throttle uses the shared local cache. This added request
    # must not push unrelated later tests over the process-wide test limit.
    default_cache.clear()


@pytest.mark.django_db
def test_beer_brand_filter_can_serve_known_pub_without_search_cache(client):
    brand, _ = BeerBrand.objects.get_or_create(
        key="pilsner-urquell",
        defaults={"name": "Pilsner Urquell"},
    )
    PubBeerBrand.objects.create(
        cache_key=geohash8(_LAT, _LNG),
        name="Hospoda Se Záznamem",
        lat=_LAT,
        lng=_LNG,
        city="Praha",
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        source=PubBeerBrand.Source.DRINK,
    )

    resp = client.get(
        "/v1/pubs/near",
        data={
            "lat": _LAT,
            "lng": _LNG,
            "radius_km": 1,
            "beer_brand": "pilsner-urquell",
        },
    )

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cached"] is True
    assert body["items"][0]["name"] == "Hospoda Se Záznamem"
    assert body["items"][0]["beerBrand"] == {
        "slug": "pilsner-urquell",
        "name": "Pilsner Urquell",
        "source": "drink",
    }


@pytest.mark.django_db
def test_community_pub_does_not_require_a_beer_filter_to_be_discoverable(client):
    brand, _ = BeerBrand.objects.get_or_create(
        key="pilsner-urquell",
        defaults={"name": "Pilsner Urquell"},
    )
    community = PubCommunityData.objects.create(
        cache_key=geohash8(_LAT, _LNG),
        name="Hospoda Se Záznamem",
        lat=_LAT,
        lng=_LNG,
        city="Praha",
        beers=[{"name": brand.name, "price_czk": 62, "volume_ml": 500}],
        beers_updated_at=dj_tz.now(),
    )
    PubBeerBrand.objects.create(
        cache_key=community.cache_key,
        name=community.name,
        lat=community.lat,
        lng=community.lng,
        city=community.city or "",
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        source=PubBeerBrand.Source.DRINK,
    )

    unfiltered = client.get(
        "/v1/pubs/near",
        data={"lat": _LAT, "lng": _LNG, "radius_km": 1},
    )
    filtered = client.get(
        "/v1/pubs/near",
        data={
            "lat": _LAT,
            "lng": _LNG,
            "radius_km": 1,
            "beer_brand": brand.key,
        },
    )

    assert unfiltered.status_code == status.HTTP_200_OK
    assert [item["name"] for item in unfiltered.json()["items"]] == [community.name]
    assert unfiltered.json()["items"][0]["source"] == "community_signal"
    assert [item["name"] for item in filtered.json()["items"]] == [community.name]


@pytest.mark.django_db
def test_beer_brand_filter_returns_empty_when_no_local_signals(client):
    BeerBrand.objects.get_or_create(
        key="pilsner-urquell",
        defaults={"name": "Pilsner Urquell"},
    )
    resp = client.get(
        "/v1/pubs/near",
        data={
            "lat": _LAT,
            "lng": _LNG,
            "radius_km": 25,
            "beer_brand": "pilsner-urquell",
        },
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"] == []


@pytest.mark.django_db
def test_beer_brand_filter_keeps_nearest_pub_over_recent_far_rows(client):
    brand, _ = BeerBrand.objects.get_or_create(
        key="pilsner-urquell",
        defaults={"name": "Pilsner Urquell"},
    )
    now = dj_tz.now()
    for i in range(200):
        lat = _LAT + 0.01 + i * 0.0005
        PubBeerBrand.objects.create(
            cache_key=geohash8(lat, _LNG),
            name=f"Vzdálená hospoda {i}",
            lat=lat,
            lng=_LNG,
            brand=brand,
            brand_key=brand.key,
            brand_name=brand.name,
            source=PubBeerBrand.Source.DRINK,
            last_seen_at=now,
        )
    PubBeerBrand.objects.create(
        cache_key=geohash8(_LAT + 0.0001, _LNG),
        name="Nejbližší starší hospoda",
        lat=_LAT + 0.0001,
        lng=_LNG,
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        source=PubBeerBrand.Source.DRINK,
        last_seen_at=now - timedelta(days=30),
    )

    resp = client.get(
        "/v1/pubs/near",
        data={
            "lat": _LAT,
            "lng": _LNG,
            "radius_km": 25,
            "beer_brand": "pilsner-urquell",
        },
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"][0]["name"] == "Nejbližší starší hospoda"


@pytest.mark.django_db
def test_beer_brand_filter_rejects_unknown_brand(client):
    resp = client.get(
        "/v1/pubs/near",
        data={
            "lat": _LAT,
            "lng": _LNG,
            "radius_km": 25,
            "beer_brand": "unknown-brand",
        },
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_amenity_filter_requires_every_selected_amenity(client):
    _amenity("payment_card")
    _amenity("game_foosball")
    _amenity("payment_card", name="Jen kartou", lat=50.081, lng=14.421)
    PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[
            _ITEM,
            {
                "name": "Jen kartou",
                "label": "Hospoda",
                "position": {"lat": 50.081, "lon": 14.421},
            },
        ],
        fetched_at=dj_tz.now(),
    )

    resp = client.get(
        "/v1/pubs/near",
        data={
            "lat": _LAT,
            "lng": _LNG,
            "radius_km": 25,
            "amenities": "payment_card,game_foosball",
        },
    )

    assert resp.status_code == status.HTTP_200_OK
    assert [item["name"] for item in resp.json()["items"]] == ["Hospoda U Testu"]
    assert resp.json()["items"][0]["source"] == "amenity_signal"
    assert resp.json()["applied_filters"] == {
        "version": 1,
        "match": "all",
        "amenities": ["payment_card", "game_foosball"],
        "beer_brand": None,
    }


@pytest.mark.django_db
def test_amenity_filter_keeps_only_qualifying_user_added_pub(client):
    qualifying = UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key=geohash8(_LAT, _LNG),
        name="Komunitní s kartou",
        lat=_LAT,
        lng=_LNG,
    )
    UserAddedPub.objects.create(
        client_id="aaaaaaaa-0000-0000-0000-000000000001",
        cache_key=geohash8(_LAT + 0.002, _LNG),
        name="Komunitní bez karty",
        lat=_LAT + 0.002,
        lng=_LNG,
    )
    _amenity(
        "payment_card",
        name=qualifying.name,
        lat=qualifying.lat,
        lng=qualifying.lng,
    )

    resp = client.get(
        "/v1/pubs/near",
        data={
            "lat": _LAT,
            "lng": _LNG,
            "radius_km": 1,
            "amenities": "payment_card",
        },
    )

    assert resp.status_code == status.HTTP_200_OK
    assert [item["name"] for item in resp.json()["items"]] == [qualifying.name]
    assert resp.json()["items"][0]["source"] == "community"
    # See the throttle note above: keep the shared throttle counter clean for
    # unrelated later tests.
    default_cache.clear()


@pytest.mark.django_db
def test_amenity_filter_only_accepts_confident_yes(client):
    _amenity("payment_card", status_value=PubAmenity.Status.DISPUTED)
    resp = client.get(
        "/v1/pubs/near",
        data={"lat": _LAT, "lng": _LNG, "amenities": "payment_card"},
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"] == []


@pytest.mark.django_db
def test_amenity_filter_keeps_same_cell_neighbour_out(client):
    _amenity("payment_card")
    neighbour = {
        **_ITEM,
        "name": "Kavárna Odvedle",
    }
    PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[neighbour],
        fetched_at=dj_tz.now(),
    )

    resp = client.get(
        "/v1/pubs/near",
        data={"lat": _LAT, "lng": _LNG, "amenities": "payment_card"},
    )

    assert resp.status_code == status.HTTP_200_OK
    # The aggregate-backed fallback is returned, never the neighbouring provider item.
    assert [item["name"] for item in resp.json()["items"]] == ["Hospoda U Testu"]


@pytest.mark.django_db
def test_amenity_signal_dedupes_provider_copy_with_slight_coordinate_drift(client):
    _amenity("payment_card")
    provider_copy = {
        **_ITEM,
        "position": {"lat": 50.08001, "lon": 14.42001},
    }
    assert geohash8(50.08001, 14.42001) == geohash8(50.08, 14.42)
    PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[provider_copy],
        fetched_at=dj_tz.now(),
    )

    resp = client.get(
        "/v1/pubs/near",
        data={"lat": _LAT, "lng": _LNG, "amenities": "payment_card"},
    )

    assert resp.status_code == status.HTTP_200_OK
    assert [item["name"] for item in resp.json()["items"]] == ["Hospoda U Testu"]
    assert resp.json()["items"][0]["source"] == "amenity_signal"


@pytest.mark.django_db
def test_distinct_stable_ids_are_a_hard_identity_mismatch(client):
    from pubs.api.views import _filter_items_by_amenity_signals

    signal = {
        "id": "stable-pub-a",
        "name": "Hospoda U Testu",
        "position": {"lat": 50.08, "lon": 14.42},
    }
    neighbour = {
        "id": "stable-pub-b",
        "name": "Hospoda U Testu 2",
        "position": {"lat": 50.08, "lon": 14.42},
    }

    assert _filter_items_by_amenity_signals([neighbour], [signal]) == []


@pytest.mark.django_db
def test_legacy_cache_only_identity_is_excluded_from_hard_filter(client):
    cache_key = geohash8(50.08, 14.42)
    for amenity_key in ["payment_card", "game_foosball"]:
        row = _amenity(amenity_key)
        row.pub_identity_key = cache_key
        row.save(update_fields=["pub_identity_key"])

    resp = client.get(
        "/v1/pubs/near",
        data={
            "lat": _LAT,
            "lng": _LNG,
            "amenities": "payment_card,game_foosball",
        },
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"] == []
    assert resp.json()["applied_filters"]["amenities"] == [
        "payment_card",
        "game_foosball",
    ]


@pytest.mark.django_db
def test_amenity_filter_rejects_inactive_or_non_filterable_keys(client):
    AmenityKind.objects.filter(key="game_jukebox").update(filter_candidate=False)

    resp = client.get(
        "/v1/pubs/near",
        data={"lat": _LAT, "lng": _LNG, "amenities": "game_jukebox"},
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert "game_jukebox" in str(resp.json()["amenities"])


@pytest.mark.django_db
def test_beer_brand_and_amenity_filters_are_intersected(client):
    brand, _ = BeerBrand.objects.get_or_create(
        key="pilsner-urquell",
        defaults={"name": "Pilsner Urquell"},
    )
    for name, lat, lng in [
        ("Hospoda U Testu", 50.08, 14.42),
        ("Plzeň bez karty", 50.081, 14.421),
    ]:
        PubBeerBrand.objects.create(
            cache_key=geohash8(lat, lng),
            name=name,
            lat=lat,
            lng=lng,
            brand=brand,
            brand_key=brand.key,
            brand_name=brand.name,
            source=PubBeerBrand.Source.COMMUNITY,
        )
    _amenity("payment_card")

    resp = client.get(
        "/v1/pubs/near",
        data={
            "lat": _LAT,
            "lng": _LNG,
            "beer_brand": brand.key,
            "amenities": "payment_card",
        },
    )

    assert resp.status_code == status.HTTP_200_OK
    assert [item["name"] for item in resp.json()["items"]] == ["Hospoda U Testu"]


@pytest.mark.django_db
def test_default_radius_used_when_omitted(client):
    """Omitting radius_km defaults to 25 → bucket 50."""
    _seed_near_cache([_ITEM], radius_bucket=50)
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG})
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"] == [_ITEM]


# ---------------------------------------------------------------------------
# Cache HIT (fresh) — no fetch
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_fresh_cache_hit_no_fetch(client):
    PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[_ITEM],
        fetched_at=dj_tz.now(),
    )
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cached"] is True
    assert body["items"] == [_ITEM]


@pytest.mark.django_db
def test_stale_row_is_served_without_refresh(client):
    _seed_near_cache([_ITEM], age_days=8)
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cached"] is True
    assert body["items"] == [_ITEM]
    assert PubSearchCache.objects.filter(cache_key=_KEY, radius_bucket=50).count() == 1
    assert PubSearchCache.objects.get(cache_key=_KEY, radius_bucket=50).items == [_ITEM]


# ---------------------------------------------------------------------------
# Radius bucketing
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize(
    "radius_km,expected_bucket",
    [(3, 5), (5, 5), (10, 15), (15, 15), (25, 50), (50, 50), (80, 100), (100, 100)],
)
def test_radius_bucketing(client, radius_km, expected_bucket):
    _seed_near_cache([_ITEM], radius_bucket=expected_bucket)
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": radius_km})
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"] == [_ITEM]
    assert PubSearchCache.objects.filter(cache_key=_KEY, radius_bucket=expected_bucket).exists()


@pytest.mark.django_db
def test_over_cap_radius_clamped_to_100(client):
    """A radius above 100 is clamped, not rejected, and uses the 100 bucket."""
    _seed_near_cache([_ITEM], radius_bucket=100)
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 250})
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"] == [_ITEM]


# ---------------------------------------------------------------------------
# Cell quantization — very nearby coords share one row
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_two_nearby_coords_share_one_cache_row(client):
    _seed_near_cache([_ITEM])
    # Both requests read the same immutable seed row.
    client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})
    # A coord ~70 m away falls in the same geohash-6 cell → cache HIT.
    nearby_lat, nearby_lng = _LAT + 0.0005, _LNG + 0.0005
    assert geohash6(nearby_lat, nearby_lng) == _KEY
    resp2 = client.get(
        "/v1/pubs/near", data={"lat": nearby_lat, "lng": nearby_lng, "radius_km": 25}
    )

    assert resp2.json()["cached"] is True
    assert PubSearchCache.objects.filter(cache_key=_KEY).count() == 1


# ---------------------------------------------------------------------------
# Immutable legacy-cache fallback
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_stale_legacy_row_is_served(client):
    PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[_ITEM],
        fetched_at=dj_tz.now() - timedelta(days=30),
    )
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cached"] is True
    assert body["items"] == [_ITEM]


@pytest.mark.django_db
def test_no_legacy_row_is_empty_200(client):
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"] == []


# ---------------------------------------------------------------------------
# Provider configuration does not affect local-only nearby responses
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_no_provider_configuration_no_row_is_empty_200(client):
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"] == []


@pytest.mark.django_db
def test_no_provider_configuration_with_stale_row_serves_stale(client):
    PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[_ITEM],
        fetched_at=dj_tz.now() - timedelta(days=30),
    )
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["cached"] is True
    assert resp.json()["items"] == [_ITEM]


@pytest.mark.django_db
def test_nearby_items_include_cached_pub_details_without_mutating_search_cache(client, settings):
    search_row = PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[_ITEM],
        fetched_at=dj_tz.now(),
    )
    PubHours.objects.create(
        cache_key=geohash8(_ITEM["position"]["lat"], _ITEM["position"]["lon"]),
        name=_ITEM["name"],
        lat=_ITEM["position"]["lat"],
        lng=_ITEM["position"]["lon"],
        opening_hours_raw="Mo-Su 11:00-23:00",
        rating_value=4.6,
        rating_count=128,
        rating_label="Výborné",
        status=PubHours.Status.OK,
        source="firmy",
        fetched_at=dj_tz.now(),
    )
    PubCommunityData.objects.create(
        cache_key=geohash8(_ITEM["position"]["lat"], _ITEM["position"]["lon"]),
        name=_ITEM["name"],
        lat=_ITEM["position"]["lat"],
        lng=_ITEM["position"]["lon"],
        beer_menu_rotates=True,
        beers=[{"name": "Dnešní speciál", "price_czk": 59, "volume_ml": 500}],
        beers_updated_at=dj_tz.now(),
    )

    with patch("pubs.api.cache.next_change") as mocked_next_change:
        resp = client.get(
            "/v1/pubs/near",
            data={"lat": _LAT, "lng": _LNG, "radius_km": 25},
        )

    assert resp.status_code == status.HTTP_200_OK
    details = resp.json()["items"][0]["pubDetails"]
    assert details["opening_hours"] == "Mo-Su 11:00-23:00"
    assert details["isOpenNow"] in (True, False)
    assert details["nextChange"] is None
    assert details["rating"] == pytest.approx(4.6)
    assert details["ratingCount"] == 128
    assert details["beer_menu_rotates"] is True
    mocked_next_change.assert_not_called()
    search_row.refresh_from_db()
    assert search_row.items == [_ITEM]
    # The suite's DRF throttle uses the shared local cache. This added request
    # must not push unrelated later tests over the process-wide test limit.
    default_cache.clear()


# ---------------------------------------------------------------------------
# Community-added pubs — mixed into every nearby response
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_user_added_pub_is_prepended_to_fresh_cache_hit(client):
    UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key="u2fk3abc",
        name="Hospoda Od Komunity",
        lat=_LAT + 0.0001,
        lng=_LNG + 0.0001,
        city="Praha",
        address="Komunitní 1",
    )
    PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[_ITEM],
        fetched_at=dj_tz.now(),
    )

    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cached"] is True
    assert [item["name"] for item in body["items"]] == ["Hospoda Od Komunity", _ITEM["name"]]
    added = body["items"][0]
    assert added["label"] == "Hospoda"
    assert added["position"] == {"lat": _LAT + 0.0001, "lon": _LNG + 0.0001}
    assert added["source"] == "community"
    assert {"name": "Praha", "type": "regional.municipality"} in added["regionalStructure"]


@pytest.mark.django_db
def test_user_added_pub_served_without_provider_or_cache(client):
    UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key="u2fk3abc",
        name="Hospoda Bez Provideru",
        lat=_LAT,
        lng=_LNG,
    )

    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 1})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cached"] is True
    assert body["items"][0]["name"] == "Hospoda Bez Provideru"


@pytest.mark.django_db
def test_user_added_pub_filters_inactive_and_far_rows(client):
    UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key="u2fk3abc",
        name="Blízko",
        lat=_LAT,
        lng=_LNG,
    )
    UserAddedPub.objects.create(
        client_id="aaaaaaaa-0000-0000-0000-000000000001",
        cache_key="u2fk3def",
        name="Neaktivní",
        lat=_LAT,
        lng=_LNG,
        active=False,
    )
    UserAddedPub.objects.create(
        client_id="aaaaaaaa-0000-0000-0000-000000000002",
        cache_key="u2fk3ghi",
        name="Daleko",
        lat=49.2,
        lng=16.6,
    )
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 1})

    assert resp.status_code == status.HTTP_200_OK
    names = [item["name"] for item in resp.json()["items"]]
    assert names == ["Blízko"]


@pytest.mark.django_db
def test_user_added_pub_does_not_mutate_legacy_cache(client):
    UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key="u2fk3abc",
        name="Jen komunitně",
        lat=_LAT,
        lng=_LNG,
    )
    _seed_near_cache([_ITEM])
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    assert [item["name"] for item in resp.json()["items"]] == ["Jen komunitně", _ITEM["name"]]
    assert PubSearchCache.objects.get(cache_key=_KEY, radius_bucket=50).items == [_ITEM]


@pytest.mark.django_db
def test_user_added_pubs_capped_and_nearest_first(client):
    """A flood of user-added pubs is capped to _USER_ADDED_MAX_RESULTS, keeping
    the nearest ones — the most distant rows are the ones dropped."""
    import uuid as _uuid

    from pubs.api.views import _USER_ADDED_MAX_RESULTS

    # Create more than the cap, each progressively farther from the centre.
    total = _USER_ADDED_MAX_RESULTS + 20
    for i in range(total):
        offset = 0.00005 * (i + 1)  # all within ~0.3 km, ascending distance
        UserAddedPub.objects.create(
            client_id=str(_uuid.uuid4()),
            cache_key=f"u2fk{i:04d}",
            name=f"Pub {i:03d}",
            lat=_LAT + offset,
            lng=_LNG,
        )
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    items = resp.json()["items"]
    assert len(items) == _USER_ADDED_MAX_RESULTS
    # Nearest kept (Pub 000 = closest), farthest dropped.
    names = [item["name"] for item in items]
    assert "Pub 000" in names
    assert f"Pub {total - 1:03d}" not in names
    # Returned in ascending-distance order.
    assert names[0] == "Pub 000"


@pytest.mark.django_db
def test_user_added_scan_limit_keeps_old_nearby_pub(client):
    import uuid as _uuid

    from pubs.api.views import _USER_ADDED_SCAN_LIMIT

    old_near = UserAddedPub.objects.create(
        client_id=str(_uuid.uuid4()),
        cache_key="u2fk-old-near",
        name="Stará blízká",
        lat=_LAT + 0.00001,
        lng=_LNG,
    )
    UserAddedPub.objects.filter(pk=old_near.pk).update(updated_at=dj_tz.now() - timedelta(days=30))

    for i in range(_USER_ADDED_SCAN_LIMIT):
        UserAddedPub.objects.create(
            client_id=str(_uuid.uuid4()),
            cache_key=f"u2fk-far-{i:04d}",
            name=f"Novější dál {i:03d}",
            lat=_LAT + 0.01 + i * 0.000001,
            lng=_LNG,
        )
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    names = [item["name"] for item in resp.json()["items"]]
    assert names[0] == "Stará blízká"


@pytest.mark.django_db
def test_community_pub_dedupes_matching_legacy_item(client):
    """A pub in community and legacy cache data is returned once."""
    UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key="u2fk3abc",
        name="Hospoda U Testu",  # same name as _ITEM
        lat=50.08,  # same rounded position as _ITEM
        lng=14.42,
    )
    # _ITEM has name "Hospoda U Testu" at position (50.08, 14.42).
    _seed_near_cache([_ITEM])
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    items = resp.json()["items"]
    names = [item["name"] for item in items]
    # Appears exactly once, and it's the community row (source set).
    assert names.count("Hospoda U Testu") == 1
    assert items[0]["source"] == "community"


@pytest.mark.django_db
def test_distinct_legacy_item_not_deduped(client):
    """A legacy item that does not match a community pub is kept alongside."""
    UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key="u2fk3abc",
        name="Jiná hospoda",
        lat=_LAT,
        lng=_LNG,
    )
    _seed_near_cache([_ITEM])
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    names = [item["name"] for item in resp.json()["items"]]
    assert names == ["Jiná hospoda", _ITEM["name"]]
