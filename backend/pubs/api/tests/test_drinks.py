"""
Tests for the drink-logging endpoint (POST /v1/drinks): per-user DrinkLog rows
plus the server-side merge of each drunk beer into the pub's community menu
(PubCommunityData.beers).
"""

from __future__ import annotations

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from pubs.api.views import DrinksView, _merge_drink_into_menu
from pubs.enrichment import geohash8
from pubs.models import Account, DrinkLog, PubCommunityData

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
    # Hours must never be touched by the drink merge.
    assert row.hours_json == {"mo": [["11:00", "23:00"]]}
    assert row.opening_hours_raw == "Mo 11:00-23:00"


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
