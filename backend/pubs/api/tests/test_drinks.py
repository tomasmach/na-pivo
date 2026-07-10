"""
Tests for the drink-logging endpoint (POST /v1/drinks): per-user DrinkLog rows
plus the server-side merge of each drunk beer into the pub's community menu
(PubCommunityData.beers).
"""

from __future__ import annotations

import pytest
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone as dj_timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from pubs.api.views import DrinksView, _merge_drink_into_menu
from pubs.enrichment import geohash8
from pubs.models import Account, BeerBrand, DrinkLog, PubBeerBrand, PubBeerProduct, PubCommunityData

from .query_helpers import count_beer_catalog_selects

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_CLIENT_ID = "9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d"
_NAME = "U Zlatého tygra"
_LAT = 50.0876
_LNG = 14.4214
_KEY = geohash8(_LAT, _LNG)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    # DrinksView is per-IP throttled (scope "drinks") and DRF stores the request
    # history in the default cache. Clear it around every test so the shared
    # 127.0.0.1 counter never bleeds across tests as this file grows.
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
        "client_id": _CLIENT_ID,
        "name": _NAME,
        "lat": _LAT,
        "lng": _LNG,
        "city": "Praha",
        "external_id": "mapy:50.08755,14.42141",
        "beer": {"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500},
        "drank_at": "2026-06-12T19:45:00+02:00",
    }
    data.update(overrides)
    return data


# ---------------------------------------------------------------------------
# Merge helper (unit) — exercises the core community-sourcing logic directly.
# ---------------------------------------------------------------------------


def test_merge_appends_to_empty_menu():
    beers: list[dict] = []
    changed = _merge_drink_into_menu(beers, {"name": "Kozel", "price_czk": 40, "volume_ml": 500})
    assert changed is True
    assert beers == [{"name": "Kozel", "price_czk": 40, "volume_ml": 500}]


def test_merge_updates_price_same_name_and_volume_case_insensitive():
    beers = [{"name": "Pilsner Urquell", "price_czk": 59, "volume_ml": 500}]
    changed = _merge_drink_into_menu(
        beers, {"name": "  pilsner urquell  ", "price_czk": 65, "volume_ml": 500}
    )
    assert changed is True
    assert beers == [{"name": "Pilsner Urquell", "price_czk": 65, "volume_ml": 500}]


def test_merge_same_name_different_volume_is_separate_entry():
    beers = [{"name": "Kozel", "price_czk": 45, "volume_ml": 330}]
    changed = _merge_drink_into_menu(beers, {"name": "Kozel", "price_czk": 55, "volume_ml": 500})
    assert changed is True
    assert beers == [
        {"name": "Kozel", "price_czk": 45, "volume_ml": 330},
        {"name": "Kozel", "price_czk": 55, "volume_ml": 500},
    ]


def test_merge_skips_when_menu_full():
    beers = [
        {"name": f"Beer {i}", "price_czk": 40, "volume_ml": 500} for i in range(12)
    ]
    changed = _merge_drink_into_menu(beers, {"name": "New", "price_czk": 50, "volume_ml": 330})
    assert changed is False
    assert len(beers) == 12


# ---------------------------------------------------------------------------
# Auth + validation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_log_requires_account_token(client):
    resp = client.post("/v1/drinks", data=_payload(), format="json")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    assert DrinkLog.objects.count() == 0
    assert PubCommunityData.objects.count() == 0


@pytest.mark.django_db
def test_log_validation_errors(client):
    token = _register(client)

    missing_price = client.post(
        "/v1/drinks",
        data=_payload(beer={"name": "Pilsner", "volume_ml": 500}),
        format="json",
        **_auth(token),
    )
    bad_volume = client.post(
        "/v1/drinks",
        data=_payload(beer={"name": "Pilsner", "price_czk": 50, "volume_ml": 250}),
        format="json",
        **_auth(token),
    )
    price_zero = client.post(
        "/v1/drinks",
        data=_payload(beer={"name": "Pilsner", "price_czk": 0, "volume_ml": 500}),
        format="json",
        **_auth(token),
    )
    price_too_high = client.post(
        "/v1/drinks",
        data=_payload(beer={"name": "Pilsner", "price_czk": 5000, "volume_ml": 500}),
        format="json",
        **_auth(token),
    )
    missing_client_id = client.post(
        "/v1/drinks",
        data={k: v for k, v in _payload().items() if k != "client_id"},
        format="json",
        **_auth(token),
    )
    missing_beer = client.post(
        "/v1/drinks",
        data={k: v for k, v in _payload().items() if k != "beer"},
        format="json",
        **_auth(token),
    )
    bad_lat = client.post(
        "/v1/drinks", data=_payload(lat=999), format="json", **_auth(token)
    )

    for resp in (
        missing_price,
        bad_volume,
        price_zero,
        price_too_high,
        missing_client_id,
        missing_beer,
        bad_lat,
    ):
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert DrinkLog.objects.count() == 0
    assert PubCommunityData.objects.count() == 0


# ---------------------------------------------------------------------------
# Happy path + community-menu merge
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_log_creates_drink_and_community_row_when_none_exists(client):
    token = _register(client)
    resp = client.post("/v1/drinks", data=_payload(), format="json", **_auth(token))

    assert resp.status_code == status.HTTP_201_CREATED
    body = resp.json()
    assert body == {
        "accepted": True,
        "duplicate": False,
        "cache_key": _KEY,
        "menu_updated": True,
    }

    drink = DrinkLog.objects.get()
    assert drink.account == Account.objects.get(device_id=_DEVICE_ID)
    assert str(drink.client_id) == _CLIENT_ID
    assert drink.cache_key == _KEY
    assert drink.name == _NAME
    assert drink.city == "Praha"
    assert drink.external_id == "mapy:50.08755,14.42141"
    assert drink.beer_name == "Pilsner Urquell"
    assert drink.price_czk == 62
    assert drink.volume_ml == 500
    assert drink.drank_at.isoformat() == "2026-06-12T17:45:00+00:00"

    # A community row was created holding just this beer; hours untouched.
    row = PubCommunityData.objects.get()
    assert row.cache_key == _KEY
    assert row.name == _NAME
    assert row.beers == [{"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500}]
    assert row.beers_updated_at is not None
    assert row.hours_json is None
    assert row.opening_hours_raw == ""
    assert row.account == Account.objects.get(device_id=_DEVICE_ID)


@pytest.mark.django_db
def test_log_defaults_drank_at_to_now(client):
    token = _register(client)
    payload = _payload()
    payload.pop("drank_at")
    resp = client.post("/v1/drinks", data=payload, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_201_CREATED
    assert DrinkLog.objects.get().drank_at is not None


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("drink_type", "item"),
    [
        ("soft_drink", {"name": "Kofola", "price_czk": 49, "volume_ml": 400}),
        ("shot", {"name": "Slivovice", "price_czk": 65, "volume_ml": 40}),
    ],
)
def test_log_non_beer_stays_private_and_skips_beer_catalog(
    client, drink_type, item
):
    token = _register(client)
    resp = client.post(
        "/v1/drinks",
        data=_payload(drink_type=drink_type, beer=item),
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    assert resp.json()["menu_updated"] is False
    drink = DrinkLog.objects.get()
    assert drink.drink_type == drink_type
    assert drink.beer_name == item["name"]
    assert drink.volume_ml == item["volume_ml"]
    assert drink.beer_brand is None
    assert drink.beer_brand_key == ""
    assert drink.beer_product is None
    assert PubCommunityData.objects.count() == 0
    assert PubBeerBrand.objects.count() == 0
    assert PubBeerProduct.objects.count() == 0


@pytest.mark.django_db
def test_log_rejects_unknown_type_and_invalid_type_specific_volumes(client):
    token = _register(client)
    unknown = client.post(
        "/v1/drinks",
        data=_payload(drink_type="wine"),
        format="json",
        **_auth(token),
    )
    beer_shot_volume = client.post(
        "/v1/drinks",
        data=_payload(client_id="fdb4ab26-7393-4c33-a0bd-2a897d7c5c31", beer={"name": "Pivo", "price_czk": 50, "volume_ml": 40}),
        format="json",
        **_auth(token),
    )
    huge_shot = client.post(
        "/v1/drinks",
        data=_payload(client_id="eac2078a-4567-4fb4-98a5-83cd6b278999", drink_type="shot", beer={"name": "Rum", "price_czk": 50, "volume_ml": 500}),
        format="json",
        **_auth(token),
    )

    assert unknown.status_code == status.HTTP_400_BAD_REQUEST
    assert beer_shot_volume.status_code == status.HTTP_400_BAD_REQUEST
    assert huge_shot.status_code == status.HTTP_400_BAD_REQUEST
    assert DrinkLog.objects.count() == 0


@pytest.mark.django_db
def test_log_appends_new_beer_to_existing_menu(client):
    token = _register(client)
    PubCommunityData.objects.create(
        cache_key=_KEY,
        name=_NAME,
        lat=_LAT,
        lng=_LNG,
        beers=[{"name": "Kozel 11", "price_czk": 45, "volume_ml": 330}],
        hours_json={"mo": [["11:00", "23:00"]]},
        opening_hours_raw="Mo 11:00-23:00",
    )

    resp = client.post("/v1/drinks", data=_payload(), format="json", **_auth(token))
    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["menu_updated"] is True

    row = PubCommunityData.objects.get()
    assert row.beers == [
        {"name": "Kozel 11", "price_czk": 45, "volume_ml": 330},
        {"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500},
    ]


@pytest.mark.django_db
def test_log_normalizes_exact_brand_shorthand_and_indexes_brand(client):
    token = _register(client)
    resp = client.post(
        "/v1/drinks",
        data=_payload(beer={"name": "Plzeň", "price_czk": 62, "volume_ml": 500}),
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_201_CREATED

    drink = DrinkLog.objects.get()
    assert drink.beer_name == "Pilsner Urquell"
    assert drink.beer_brand_key == "pilsner-urquell"
    assert drink.beer_brand_name == "Pilsner Urquell"
    assert drink.beer_brand is not None
    assert drink.beer_product_key == "pilsner-urquell"
    assert drink.beer_product_name == "Pilsner Urquell"
    assert drink.beer_product is not None

    row = PubCommunityData.objects.get()
    assert row.beers == [{"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500}]

    link = PubBeerBrand.objects.get(cache_key=_KEY)
    assert link.brand_key == "pilsner-urquell"
    assert link.source == PubBeerBrand.Source.DRINK

    product_link = PubBeerProduct.objects.get(cache_key=_KEY)
    assert product_link.product_key == "pilsner-urquell"
    assert product_link.product_name == "Pilsner Urquell"


@pytest.mark.django_db
def test_log_normalizes_product_and_indexes_brand_and_product(client):
    token = _register(client)
    resp = client.post(
        "/v1/drinks",
        data=_payload(beer={"name": "Kozel 11", "price_czk": 49, "volume_ml": 500}),
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_201_CREATED

    drink = DrinkLog.objects.get()
    assert drink.beer_name == "Velkopopovický Kozel 11°"
    assert drink.beer_brand_key == "velkopopovicky-kozel"
    assert drink.beer_product_key == "velkopopovicky-kozel-11"

    row = PubCommunityData.objects.get()
    assert row.beers == [
        {"name": "Velkopopovický Kozel 11°", "price_czk": 49, "volume_ml": 500}
    ]

    assert PubBeerBrand.objects.get(cache_key=_KEY).brand_key == "velkopopovicky-kozel"
    assert PubBeerProduct.objects.get(cache_key=_KEY).product_key == "velkopopovicky-kozel-11"


@pytest.mark.django_db
def test_log_reuses_catalog_cache_for_drink_and_menu_index(client):
    token = _register(client)

    with CaptureQueriesContext(connection) as queries:
        resp = client.post(
            "/v1/drinks",
            data=_payload(beer={"name": "Plzeň", "price_czk": 62, "volume_ml": 500}),
            format="json",
            **_auth(token),
        )

    assert resp.status_code == status.HTTP_201_CREATED
    assert count_beer_catalog_selects(queries.captured_queries) == (1, 0)
    assert DrinkLog.objects.get().beer_product_key == "pilsner-urquell"
    assert PubBeerProduct.objects.get(cache_key=_KEY).product_key == "pilsner-urquell"


@pytest.mark.django_db
def test_log_updates_price_of_existing_beer_case_insensitive(client):
    token = _register(client)
    PubCommunityData.objects.create(
        cache_key=_KEY,
        name=_NAME,
        lat=_LAT,
        lng=_LNG,
        beers=[{"name": "Pilsner Urquell", "price_czk": 55, "volume_ml": 500}],
    )

    resp = client.post(
        "/v1/drinks",
        data=_payload(beer={"name": "pilsner urquell", "price_czk": 62, "volume_ml": 500}),
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["menu_updated"] is True

    row = PubCommunityData.objects.get()
    # Price updated in place; no duplicate entry; original casing preserved.
    assert row.beers == [{"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500}]


@pytest.mark.django_db
def test_log_same_name_different_volume_creates_separate_entry(client):
    token = _register(client)
    PubCommunityData.objects.create(
        cache_key=_KEY,
        name=_NAME,
        lat=_LAT,
        lng=_LNG,
        beers=[{"name": "Pilsner Urquell", "price_czk": 38, "volume_ml": 300}],
    )

    resp = client.post(
        "/v1/drinks",
        data=_payload(beer={"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500}),
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["menu_updated"] is True

    row = PubCommunityData.objects.get()
    assert row.beers == [
        {"name": "Pilsner Urquell", "price_czk": 38, "volume_ml": 300},
        {"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500},
    ]


@pytest.mark.django_db
def test_log_menu_full_logs_drink_but_does_not_merge(client):
    token = _register(client)
    full_menu = [
        {"name": f"Beer {i}", "price_czk": 40, "volume_ml": 500} for i in range(12)
    ]
    PubCommunityData.objects.create(
        cache_key=_KEY,
        name=_NAME,
        lat=_LAT,
        lng=_LNG,
        beers=list(full_menu),
    )

    resp = client.post("/v1/drinks", data=_payload(), format="json", **_auth(token))
    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["menu_updated"] is False

    # The drink is still recorded even when the menu is full.
    assert DrinkLog.objects.count() == 1
    row = PubCommunityData.objects.get()
    assert row.beers == full_menu
    assert PubBeerBrand.objects.get(cache_key=_KEY).brand_key == "pilsner-urquell"
    assert PubBeerProduct.objects.get(cache_key=_KEY).product_key == "pilsner-urquell"


@pytest.mark.django_db
def test_log_names_match_failure_logs_drink_but_leaves_menu_untouched(client):
    token = _register(client)
    # Different business sharing the same ~38 m geohash cell.
    PubCommunityData.objects.create(
        cache_key=_KEY,
        name="Bistro Veganburger",
        lat=_LAT,
        lng=_LNG,
        beers=[{"name": "Kozel 11", "price_czk": 45, "volume_ml": 330}],
        beers_updated_at=None,
    )

    resp = client.post("/v1/drinks", data=_payload(), format="json", **_auth(token))
    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["menu_updated"] is False

    assert DrinkLog.objects.count() == 1
    row = PubCommunityData.objects.get()
    # Menu of the unrelated business is untouched.
    assert row.name == "Bistro Veganburger"
    assert row.beers == [{"name": "Kozel 11", "price_czk": 45, "volume_ml": 330}]


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_log_idempotent_replay_returns_duplicate_and_no_double_merge(client):
    token = _register(client)
    first = client.post("/v1/drinks", data=_payload(), format="json", **_auth(token))
    assert first.status_code == status.HTTP_201_CREATED
    assert first.json()["duplicate"] is False

    # Replay the same client_id with a DIFFERENT price — must be a no-op (the
    # original drink is returned, no second log row, no second merge).
    second = client.post(
        "/v1/drinks",
        data=_payload(beer={"name": "Pilsner Urquell", "price_czk": 99, "volume_ml": 500}),
        format="json",
        **_auth(token),
    )
    assert second.status_code == status.HTTP_200_OK
    assert second.json() == {
        "accepted": True,
        "duplicate": True,
        "cache_key": _KEY,
        "menu_updated": False,
    }

    assert DrinkLog.objects.count() == 1
    row = PubCommunityData.objects.get()
    # Price NOT updated by the replay — still the first value.
    assert row.beers == [{"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500}]
    # Exactly one drink stored with the original price.
    assert DrinkLog.objects.get().price_czk == 62


@pytest.mark.django_db
def test_log_concurrent_first_drink_race_still_merges(client, monkeypatch):
    """Concurrent first-drink for a brand-new cell must merge, not 500.

    Simulate the race: this request observes no community row, but by the time it
    calls create() a concurrent POST (same name) has already inserted the row, so
    create() raises IntegrityError (cache_key is unique). The view must catch it,
    re-fetch the winner's row, and fall through to the names_match + merge path —
    appending this beer instead of returning a 500 and silently dropping it.
    """
    from django.db import IntegrityError

    token = _register(client)
    real_create = PubCommunityData.objects.create
    real_select_for_update = PubCommunityData.objects.select_for_update
    state = {"raced": False, "winner_inserted": False}

    def racing_create(*args, **kwargs):
        if not state["raced"]:
            state["raced"] = True
            raise IntegrityError("duplicate key value violates unique constraint")
        return real_create(*args, **kwargs)

    def racing_select_for_update(*args, **kwargs):
        qs = real_select_for_update(*args, **kwargs)
        if state["raced"] and not state["winner_inserted"]:
            state["winner_inserted"] = True
            # The "winner" lands after our failed INSERT savepoint has rolled back,
            # matching the real concurrent-transaction shape this test exercises.
            real_create(
                cache_key=_KEY,
                name=_NAME,
                lat=_LAT,
                lng=_LNG,
                beers=[{"name": "Kozel 11", "price_czk": 45, "volume_ml": 330}],
            )
        return qs

    monkeypatch.setattr(PubCommunityData.objects, "create", racing_create)
    monkeypatch.setattr(PubCommunityData.objects, "select_for_update", racing_select_for_update)

    resp = client.post("/v1/drinks", data=_payload(), format="json", **_auth(token))
    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["menu_updated"] is True

    # The drink is logged AND its beer merged into the winner's row (not lost).
    assert DrinkLog.objects.count() == 1
    row = PubCommunityData.objects.get()
    assert row.beers == [
        {"name": "Kozel 11", "price_czk": 45, "volume_ml": 330},
        {"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500},
    ]


@pytest.mark.django_db
def test_log_rolls_back_drink_when_menu_merge_fails(client, monkeypatch):
    """DrinkLog and the community-menu merge must commit or fail together."""
    token = _register(client)

    def failing_merge(cache_key, data, beer, account):  # noqa: ARG001
        raise RuntimeError("merge failed")

    monkeypatch.setattr(DrinksView, "_merge_into_community", staticmethod(failing_merge))

    resp = client.post("/v1/drinks", data=_payload(), format="json", **_auth(token))
    assert resp.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert DrinkLog.objects.count() == 0
    assert PubCommunityData.objects.count() == 0


@pytest.mark.django_db
def test_log_hours_never_modified_on_merge(client):
    token = _register(client)
    PubCommunityData.objects.create(
        cache_key=_KEY,
        name=_NAME,
        lat=_LAT,
        lng=_LNG,
        beers=[],
        hours_json={"mo": [["10:00", "22:00"]], "tu": []},
        opening_hours_raw="Mo 10:00-22:00",
        hours_updated_at=None,
    )
    before = PubCommunityData.objects.get()
    hours_before = before.hours_json
    raw_before = before.opening_hours_raw

    resp = client.post("/v1/drinks", data=_payload(), format="json", **_auth(token))
    assert resp.status_code == status.HTTP_201_CREATED

    row = PubCommunityData.objects.get()
    assert row.hours_json == hours_before
    assert row.opening_hours_raw == raw_before


# ---------------------------------------------------------------------------
# Throttle scope existence
# ---------------------------------------------------------------------------


def test_drinks_throttle_scope_configured(settings):
    assert "drinks" in settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]


@pytest.mark.django_db
def test_drinks_endpoint_is_throttled(client, monkeypatch):
    """A burst of drinks beyond the per-IP rate is rejected with 429.

    The rate is monkeypatched rather than set via @override_settings because DRF
    binds SimpleRateThrottle.THROTTLE_RATES at import time, so override_settings
    does NOT affect it (a well-known DRF testing gotcha).

    Each POST uses a distinct client_id so the idempotent-replay 200 path never
    masks the throttle; the throttle must fire on the over-limit request before
    the view body runs.
    """
    # Register BEFORE narrowing the rates: AccountView is itself throttled
    # (scope "account"), so the patched table must keep that scope set or the
    # registration call 500s with "No default throttle rate set for 'account'".
    token = _register(client)
    rates = dict(ScopedRateThrottle.THROTTLE_RATES)
    rates["drinks"] = "3/min"
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", rates)

    for i in range(3):
        resp = client.post(
            "/v1/drinks",
            data=_payload(client_id=f"00000000-0000-4000-8000-00000000000{i}"),
            format="json",
            **_auth(token),
        )
        assert resp.status_code == status.HTTP_201_CREATED

    throttled = client.post(
        "/v1/drinks",
        data=_payload(client_id="00000000-0000-4000-8000-000000000009"),
        format="json",
        **_auth(token),
    )
    assert throttled.status_code == status.HTTP_429_TOO_MANY_REQUESTS


# ---------------------------------------------------------------------------
# DELETE /v1/drinks/<client_id> — per-user drink removal (in-app minus button)
# ---------------------------------------------------------------------------

_OTHER_DEVICE_ID = "11112222-3333-4444-5555-666677778888"


@pytest.mark.django_db
def test_delete_removes_logged_drink(client):
    token = _register(client)
    created = client.post("/v1/drinks", data=_payload(), format="json", **_auth(token))
    assert created.status_code == status.HTTP_201_CREATED
    assert DrinkLog.objects.count() == 1

    resp = client.delete(f"/v1/drinks/{_CLIENT_ID}", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": True}
    assert DrinkLog.objects.filter(client_id=_CLIENT_ID).count() == 0


@pytest.mark.django_db
def test_delete_unknown_client_id_is_idempotent_success(client):
    token = _register(client)
    resp = client.delete(f"/v1/drinks/{_CLIENT_ID}", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": False}


@pytest.mark.django_db
def test_delete_same_drink_twice_second_is_false(client):
    token = _register(client)
    client.post("/v1/drinks", data=_payload(), format="json", **_auth(token))

    first = client.delete(f"/v1/drinks/{_CLIENT_ID}", **_auth(token))
    assert first.status_code == status.HTTP_200_OK
    assert first.json() == {"deleted": True}

    second = client.delete(f"/v1/drinks/{_CLIENT_ID}", **_auth(token))
    assert second.status_code == status.HTTP_200_OK
    assert second.json() == {"deleted": False}


@pytest.mark.django_db
def test_delete_requires_account_token(client):
    resp = client.delete(f"/v1/drinks/{_CLIENT_ID}")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_delete_cannot_remove_another_accounts_drink(client):
    # Account A logs a drink.
    token_a = _register(client)
    client.post("/v1/drinks", data=_payload(), format="json", **_auth(token_a))
    assert DrinkLog.objects.filter(client_id=_CLIENT_ID).count() == 1

    # Account B (different device) tries to delete A's client_id → matches nothing.
    token_b = _register(client, device_id=_OTHER_DEVICE_ID)
    resp = client.delete(f"/v1/drinks/{_CLIENT_ID}", **_auth(token_b))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": False}

    # A's drink still exists.
    assert DrinkLog.objects.filter(
        account=Account.objects.get(device_id=_DEVICE_ID), client_id=_CLIENT_ID
    ).count() == 1


@pytest.mark.django_db
def test_delete_does_not_change_community_menu(client):
    token = _register(client)
    created = client.post("/v1/drinks", data=_payload(), format="json", **_auth(token))
    assert created.status_code == status.HTTP_201_CREATED

    # Capture the community menu the drink merged into.
    row_before = PubCommunityData.objects.get(cache_key=_KEY)
    beers_before = row_before.beers
    assert beers_before == [{"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500}]

    resp = client.delete(f"/v1/drinks/{_CLIENT_ID}", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": True}

    # The drink is gone, but the community row + its beers are unchanged.
    assert DrinkLog.objects.filter(client_id=_CLIENT_ID).count() == 0
    row_after = PubCommunityData.objects.get(cache_key=_KEY)
    assert row_after.pk == row_before.pk
    assert row_after.beers == beers_before


# PATCH /v1/drinks/<client_id> — private beer-name typo fix
# ---------------------------------------------------------


@pytest.mark.django_db
def test_patch_updates_logged_drink_beer_name(client):
    token = _register(client)
    client.post("/v1/drinks", data=_payload(), format="json", **_auth(token))
    assert PubBeerBrand.objects.get(cache_key=_KEY, brand_key="pilsner-urquell").active is True
    assert PubBeerProduct.objects.get(cache_key=_KEY, product_key="pilsner-urquell").active is True

    resp = client.patch(
        f"/v1/drinks/{_CLIENT_ID}",
        data={"beer_name": "Velkopopovický Kozel 11°"},
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"updated": True}
    drink = DrinkLog.objects.get(client_id=_CLIENT_ID)
    assert drink.beer_name == "Velkopopovický Kozel 11°"
    assert drink.beer_brand_name == "Velkopopovický Kozel"
    assert drink.beer_product_name == "Velkopopovický Kozel 11°"
    # PATCH is private and does not rewrite the community menu, so the original
    # public Pilsner signal remains. The corrected private brand is added too.
    assert PubBeerBrand.objects.get(cache_key=_KEY, brand_key="pilsner-urquell").active is True
    assert PubBeerProduct.objects.get(cache_key=_KEY, product_key="pilsner-urquell").active is True
    assert PubBeerBrand.objects.get(cache_key=_KEY, brand_key="velkopopovicky-kozel").active is True
    assert (
        PubBeerProduct.objects.get(cache_key=_KEY, product_key="velkopopovicky-kozel-11").active
        is True
    )


@pytest.mark.django_db
def test_patch_reuses_catalog_cache_for_private_and_community_signals(client):
    token = _register(client)
    created = client.post(
        "/v1/drinks",
        data=_payload(beer={"name": "Plzeň", "price_czk": 62, "volume_ml": 500}),
        format="json",
        **_auth(token),
    )
    assert created.status_code == status.HTTP_201_CREATED

    with CaptureQueriesContext(connection) as queries:
        resp = client.patch(
            f"/v1/drinks/{_CLIENT_ID}",
            data={"beer_name": "Kozel 11"},
            format="json",
            **_auth(token),
        )

    assert resp.status_code == status.HTTP_200_OK
    assert count_beer_catalog_selects(queries.captured_queries) == (1, 0)
    assert DrinkLog.objects.get().beer_product_key == "velkopopovicky-kozel-11"


@pytest.mark.django_db
def test_patch_deactivates_old_private_brand_signal_without_community_menu(client):
    token = _register(client)
    account = Account.objects.get(device_id=_DEVICE_ID)
    old_brand = BeerBrand.objects.get(key="pilsner-urquell")
    DrinkLog.objects.create(
        account=account,
        client_id=_CLIENT_ID,
        cache_key=_KEY,
        name=_NAME,
        lat=_LAT,
        lng=_LNG,
        city="Praha",
        external_id="mapy:50.08755,14.42141",
        beer_name="Pilsner Urquell",
        beer_brand=old_brand,
        beer_brand_key=old_brand.key,
        beer_brand_name=old_brand.name,
        price_czk=62,
        volume_ml=500,
        drank_at=dj_timezone.now(),
    )
    PubBeerBrand.objects.create(
        cache_key=_KEY,
        name=_NAME,
        lat=_LAT,
        lng=_LNG,
        city="Praha",
        external_id="mapy:50.08755,14.42141",
        brand=old_brand,
        brand_key=old_brand.key,
        brand_name=old_brand.name,
        source=PubBeerBrand.Source.DRINK,
        active=True,
        account=account,
    )

    resp = client.patch(
        f"/v1/drinks/{_CLIENT_ID}",
        data={"beer_name": "Velkopopovický Kozel 11°"},
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK
    assert PubBeerBrand.objects.get(cache_key=_KEY, brand_key="pilsner-urquell").active is False
    assert PubBeerBrand.objects.get(cache_key=_KEY, brand_key="velkopopovicky-kozel").active is True


@pytest.mark.django_db
def test_patch_unknown_client_id_is_idempotent_success(client):
    token = _register(client)
    resp = client.patch(
        f"/v1/drinks/{_CLIENT_ID}",
        data={"beer_name": "Kozel"},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"updated": False}


@pytest.mark.django_db
def test_patch_rejects_empty_beer_name(client):
    token = _register(client)
    resp = client.patch(
        f"/v1/drinks/{_CLIENT_ID}",
        data={"beer_name": "   "},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_patch_requires_account_token(client):
    resp = client.patch(
        f"/v1/drinks/{_CLIENT_ID}",
        data={"beer_name": "Kozel"},
        format="json",
    )
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_patch_cannot_update_another_accounts_drink(client):
    token_a = _register(client)
    client.post("/v1/drinks", data=_payload(), format="json", **_auth(token_a))

    token_b = _register(client, device_id=_OTHER_DEVICE_ID)
    resp = client.patch(
        f"/v1/drinks/{_CLIENT_ID}",
        data={"beer_name": "Kozel"},
        format="json",
        **_auth(token_b),
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"updated": False}
    assert DrinkLog.objects.get(client_id=_CLIENT_ID).beer_name == "Pilsner Urquell"


@pytest.mark.django_db
def test_patch_does_not_change_community_menu(client):
    token = _register(client)
    client.post("/v1/drinks", data=_payload(), format="json", **_auth(token))
    beers_before = PubCommunityData.objects.get(cache_key=_KEY).beers

    resp = client.patch(
        f"/v1/drinks/{_CLIENT_ID}",
        data={"beer_name": "Kozel"},
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK
    assert PubCommunityData.objects.get(cache_key=_KEY).beers == beers_before
