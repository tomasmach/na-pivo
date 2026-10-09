"""Real row-lock behaviour of one-beer menu changes on PostgreSQL."""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import close_old_connections, connection, connections
from rest_framework import status
from rest_framework.test import APIClient

import pubs.api.views as views
from pubs.enrichment import geohash8
from pubs.models import PubCommunityData, PubExternalBeerMenu

_NAME = "U Zámku"
_LAT = 50.0812
_LNG = 14.4182
_KEY = geohash8(_LAT, _LNG)
_MENU = [
    {"name": "Pilsner Urquell", "price_czk": 59, "volume_ml": 500},
    {"name": "Velkopopovický Kozel 11°", "price_czk": 45, "volume_ml": 500},
    {"name": "Bernard 12°", "price_czk": 52, "volume_ml": 500},
]


def _postgres_only() -> None:
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL row locks are required for this regression test")


def _register(device_id: str) -> str:
    resp = APIClient().post("/v1/account", data={"device_id": device_id}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    return resp.json()["token"]


def _change_payload(client_id: str, change: dict) -> dict:
    return {
        "name": _NAME,
        "lat": _LAT,
        "lng": _LNG,
        "client_id": client_id,
        "beers": [],
        "beer_change": change,
    }


def _post(path: str, token: str, payload: dict) -> int:
    close_old_connections()
    try:
        return APIClient().post(
            path, data=payload, format="json", HTTP_AUTHORIZATION=f"Bearer {token}"
        ).status_code
    finally:
        connections.close_all()


@pytest.mark.django_db(transaction=True)
def test_two_first_changes_of_an_imported_menu_both_stick(monkeypatch):
    _postgres_only()
    first_token = _register("3f8b1c2e-4d5a-6789-0abc-def0123456a1")
    second_token = _register("3f8b1c2e-4d5a-6789-0abc-def0123456a2")
    PubExternalBeerMenu.objects.create(
        cache_key=_KEY,
        name=_NAME,
        lat=_LAT,
        lng=_LNG,
        source=PubExternalBeerMenu.Source.PIVAROVA_MAPA,
        source_id="pm-lock",
        source_url="https://example.com/pm-lock",
        beers=_MENU,
    )

    first_computed = threading.Event()
    second_reads_menu = threading.Event()
    real_apply = views._apply_beer_change
    real_shown = views.get_cached_pub_details

    def apply_then_wait(current, change):
        result = real_apply(current, change)
        if threading.current_thread().name.startswith("first"):
            first_computed.set()
            # The second change must not read the menu while this one holds it.
            second_reads_menu.wait(timeout=1)
        return result

    def observe_read(*args, **kwargs):
        if threading.current_thread().name.startswith("second"):
            second_reads_menu.set()
        return real_shown(*args, **kwargs)

    monkeypatch.setattr(views, "_apply_beer_change", apply_then_wait)
    monkeypatch.setattr(views, "get_cached_pub_details", observe_read)

    remove_pilsner = _change_payload(
        "bbbbbbbb-0000-0000-0000-000000000001",
        {"action": "remove", "name": "Pilsner Urquell", "volume_ml": 500},
    )
    remove_kozel = _change_payload(
        "bbbbbbbb-0000-0000-0000-000000000002",
        {"action": "remove", "name": "Velkopopovický Kozel 11°", "volume_ml": 500},
    )
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="first") as first_pool:
        first = first_pool.submit(_post, "/v1/pub-community", first_token, remove_pilsner)
        assert first_computed.wait(timeout=10)
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="second") as second_pool:
            second = second_pool.submit(_post, "/v1/pub-community", second_token, remove_kozel)
            assert first.result(timeout=20) == status.HTTP_200_OK
            assert second.result(timeout=20) == status.HTTP_200_OK

    record = PubCommunityData.objects.get(cache_key=_KEY)
    assert record.beers == [_MENU[2]]
    assert {beer["name"] for beer in record.historical_beers} == {
        "Pilsner Urquell",
        "Velkopopovický Kozel 11°",
    }


@pytest.mark.django_db(transaction=True)
def test_a_drink_and_a_menu_change_of_one_account_do_not_deadlock(monkeypatch):
    _postgres_only()
    token = _register("3f8b1c2e-4d5a-6789-0abc-def0123456a3")
    PubCommunityData.objects.create(cache_key=_KEY, name=_NAME, lat=_LAT, lng=_LNG, beers=_MENU)

    drink_holds_account = threading.Event()
    change_asked_for_account = threading.Event()
    real_merge = views.DrinksView._merge_into_community
    real_lock = views.Account.objects.select_for_update

    def pause_drink_before_menu(*args, **kwargs):
        drink_holds_account.set()
        # Let the change get as far as it can while the drink holds the account.
        change_asked_for_account.wait(timeout=1)
        threading.Event().wait(0.3)
        return real_merge(*args, **kwargs)

    def observe_lock(*args, **kwargs):
        if threading.current_thread().name.startswith("change"):
            change_asked_for_account.set()
        return real_lock(*args, **kwargs)

    monkeypatch.setattr(
        views.DrinksView, "_merge_into_community", staticmethod(pause_drink_before_menu)
    )
    monkeypatch.setattr(views.Account.objects, "select_for_update", observe_lock)

    drink = {
        "client_id": "bbbbbbbb-0000-0000-0000-000000000003",
        "name": _NAME,
        "lat": _LAT,
        "lng": _LNG,
        "beer": {"name": "Pilsner Urquell", "price_czk": 61, "volume_ml": 500},
    }
    fix = _change_payload(
        "bbbbbbbb-0000-0000-0000-000000000004",
        {"action": "update", "name": "Bernard 12°", "volume_ml": 500, "price_czk": 55},
    )
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="drink") as drink_pool:
        drink_result = drink_pool.submit(_post, "/v1/drinks", token, drink)
        assert drink_holds_account.wait(timeout=10)
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="change") as change_pool:
            change_result = change_pool.submit(_post, "/v1/pub-community", token, fix)
            assert drink_result.result(timeout=20) in (
                status.HTTP_200_OK,
                status.HTTP_201_CREATED,
            )
            assert change_result.result(timeout=20) == status.HTTP_200_OK

    prices = {
        beer["name"]: beer["price_czk"]
        for beer in PubCommunityData.objects.get(cache_key=_KEY).beers
    }
    assert prices == {
        "Pilsner Urquell": 61,
        "Velkopopovický Kozel 11°": 45,
        "Bernard 12°": 55,
    }
