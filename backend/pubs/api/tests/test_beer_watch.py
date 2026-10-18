"""Beer watch ("Hlídat pivo"): endpoints, new-on-tap events and the push sender."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from io import StringIO
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs import accounts
from pubs.api import views as api_views
from pubs.beer_catalog_merge import merge_beer_products
from pubs.beer_watch import snap_location
from pubs.enrichment import geohash8
from pubs.identity import normalize_pub_name
from pubs.management.commands.send_beer_watch_pushes import in_quiet_hours
from pubs.models import (
    Account,
    BeerBrand,
    BeerProduct,
    BeerTapEvent,
    BeerWatch,
    BeerWatchPush,
    CanonicalPub,
    PubAlias,
    PubBeerProduct,
    PushDevice,
)

from .test_friends import _flatten_push, _push_recorder

_PRAGUE = ZoneInfo("Europe/Prague")
_PUB = "Restaurace U Fleků"
_LAT = 50.0812
_LNG = 14.4182
_KEY = geohash8(_LAT, _LNG)
_PILSNER = {"name": "Pilsner Urquell", "price_czk": 59, "volume_ml": 500}
_KOZEL = {"name": "Velkopopovický Kozel 11°", "price_czk": 45, "volume_ml": 500}
_BERNARD = {"name": "Bernard 12°", "price_czk": 52, "volume_ml": 500}
_NEAR = (50.085, 14.42)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _never_quiet(settings):
    settings.BEER_WATCH_QUIET_HOURS = (0, 0)
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient) -> tuple[str, Account]:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    return resp.json()["token"], Account.objects.get(public_id=resp.json()["id"])


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _post_menu(client, token, beers, *, name=_PUB, lat=_LAT, lng=_LNG, client_id=None, change=None):
    payload = {
        "name": name,
        "lat": lat,
        "lng": lng,
        "city": "Praha",
        "client_id": client_id or str(uuid.uuid4()),
        "beers": beers,
    }
    if change is not None:
        payload["beer_change"] = change
    resp = client.post("/v1/pub-community", data=payload, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK, resp.content
    return resp


def _register_device(client, token, push_token, **extra):
    resp = client.put(
        "/v1/push-device",
        data={"push_token": push_token, "platform": "ios", "permission_status": "granted", **extra},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    return resp


def _watcher(client, beer="Pilsner Urquell", *, at=_NEAR, radius_m=None, push_token=None, locale=None):
    token, account = _register(client)
    resp = client.post("/v1/beer-watches", data={"beer_name": beer}, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    settings_body = {"lat": at[0], "lng": at[1]}
    if radius_m is not None:
        settings_body["radius_m"] = radius_m
    resp = client.patch("/v1/beer-watches/settings", data=settings_body, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK, resp.content
    extra = {"locale": locale} if locale else {}
    _register_device(client, token, push_token or f"ExponentPushToken[{account.pk}]", **extra)
    return token, account


def _send(monkeypatch) -> list[dict]:
    sent: list = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent))
    call_command("send_beer_watch_pushes", stdout=StringIO())
    return _flatten_push(sent)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/v1/beer-watches"),
        ("post", "/v1/beer-watches"),
        ("delete", "/v1/beer-watches/pilsner-urquell"),
        ("patch", "/v1/beer-watches/settings"),
    ],
)
def test_endpoints_require_a_token(client, method, path):
    resp = getattr(client, method)(path, data={}, format="json")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_watch_lifecycle_and_shapes(client):
    token, account = _register(client)

    empty = client.get("/v1/beer-watches", **_auth(token))
    assert empty.json() == {"radius_m": 3000, "location_set": False, "watches": [], "helped": []}

    created = client.post(
        "/v1/beer-watches", data={"beer_name": "plzen 12"}, format="json", **_auth(token)
    )
    assert created.status_code == status.HTTP_201_CREATED
    assert created.json()["product_key"] == "pilsner-urquell"
    assert created.json()["name"] == "Pilsner Urquell"
    assert "Plzeň" in created.json()["aliases"]

    again = client.post(
        "/v1/beer-watches", data={"beer_name": "Pilsner Urquell"}, format="json", **_auth(token)
    )
    assert again.status_code == status.HTTP_200_OK
    assert BeerWatch.objects.filter(account=account).count() == 1

    patched = client.patch(
        "/v1/beer-watches/settings",
        data={"radius_m": 5000, "lat": 50.0812345, "lng": 14.4182345},
        format="json",
        **_auth(token),
    )
    assert patched.status_code == status.HTTP_200_OK
    assert patched.json()["radius_m"] == 5000
    assert patched.json()["location_set"] is True
    assert [w["product_key"] for w in patched.json()["watches"]] == ["pilsner-urquell"]
    account.refresh_from_db()
    assert (account.beer_watch_lat, account.beer_watch_lng) == snap_location(50.0812345, 14.4182345)
    assert (account.beer_watch_lat, account.beer_watch_lng) == (50.08275, 14.4165)

    gone = client.delete("/v1/beer-watches/pilsner-urquell", **_auth(token))
    assert gone.status_code == status.HTTP_204_NO_CONTENT
    assert client.delete("/v1/beer-watches/pilsner-urquell", **_auth(token)).status_code == 204
    account.refresh_from_db()
    assert account.beer_watch_lat is None
    assert account.beer_watch_located_at is None
    assert account.beer_watch_radius_m == 5000


@pytest.mark.django_db
def test_watch_resolves_with_brewery_and_rejects_unknown_beer(client):
    token, _account = _register(client)

    with_brewery = client.post(
        "/v1/beer-watches",
        data={"beer_name": "11", "brewery_name": "Kozel"},
        format="json",
        **_auth(token),
    )
    assert with_brewery.status_code == status.HTTP_201_CREATED
    assert with_brewery.json()["product_key"] == "velkopopovicky-kozel-11"

    unknown = client.post(
        "/v1/beer-watches", data={"beer_name": "Domácí kvasnicák"}, format="json", **_auth(token)
    )
    assert unknown.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert unknown.json() == {"code": "unknown_beer"}

    # A brewery alone is not a beer anyone can watch.
    brand_only = client.post(
        "/v1/beer-watches", data={"beer_name": "Bernard"}, format="json", **_auth(token)
    )
    assert brand_only.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert brand_only.json() == {"code": "unknown_beer"}


@pytest.mark.django_db
def test_watch_limit_is_fifty(client):
    token, account = _register(client)
    brand = BeerBrand.objects.create(key="limit-brewery", name="Limit Brewery")
    products = [
        BeerProduct.objects.create(
            key=f"limit-{n}", brand=brand, brand_key=brand.key, brand_name=brand.name, name=f"Limit {n}"
        )
        for n in range(51)
    ]
    BeerWatch.objects.bulk_create(BeerWatch(account=account, product=p) for p in products[:50])

    resp = client.post("/v1/beer-watches", data={"beer_name": "Limit 50"}, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert resp.json() == {"code": "too_many"}
    # Re-watching one already watched stays idempotent at the limit.
    assert (
        client.post("/v1/beer-watches", data={"beer_name": "Limit 3"}, format="json", **_auth(token))
        .status_code
        == status.HTTP_200_OK
    )


@pytest.mark.django_db
@pytest.mark.parametrize(
    "body",
    [{"radius_m": 2000}, {"lat": 50.0}, {"lng": 14.0}, {"lat": 91, "lng": 14.0}],
)
def test_settings_rejects_bad_values(client, body):
    token, _account = _register(client)
    resp = client.patch("/v1/beer-watches/settings", data=body, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_location_is_not_stored_without_a_watch(client):
    token, account = _register(client)
    resp = client.patch(
        "/v1/beer-watches/settings", data={"lat": 50.0, "lng": 14.0}, format="json", **_auth(token)
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["location_set"] is False
    account.refresh_from_db()
    assert account.beer_watch_lat is None


# ---------------------------------------------------------------------------
# Events: only a beer genuinely new at the pub
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_events_only_for_beers_new_at_the_pub(client):
    token, contributor = _register(client)

    _post_menu(client, token, [_PILSNER])
    first = list(BeerTapEvent.objects.values_list("cache_key", "product__key", "contributor_id"))
    assert first == [(_KEY, "pilsner-urquell", contributor.pk)]

    # A replayed identical menu and an added beer: only the added beer is new.
    _post_menu(client, token, [_PILSNER])
    _post_menu(client, token, [_PILSNER, _KOZEL])
    assert sorted(BeerTapEvent.objects.values_list("product__key", flat=True)) == [
        "pilsner-urquell",
        "velkopopovicky-kozel-11",
    ]

    # Removed and added back (also an old full menu replayed): it was here before.
    _post_menu(client, token, [_KOZEL])
    assert PubBeerProduct.objects.get(cache_key=_KEY, product__key="pilsner-urquell").active is False
    _post_menu(client, token, [_PILSNER, _KOZEL])
    assert BeerTapEvent.objects.count() == 2

    # A one-beer change goes through the same path and adds nothing new.
    _post_menu(
        client, token, [_PILSNER], change={"action": "remove", "name": _KOZEL["name"], "volume_ml": 500}
    )
    assert BeerTapEvent.objects.count() == 2

    # The event row itself stays the marker even if the index loses its rows.
    PubBeerProduct.objects.filter(cache_key=_KEY).delete()
    _post_menu(client, token, [_PILSNER, _BERNARD])
    assert sorted(BeerTapEvent.objects.values_list("product__key", flat=True)) == [
        "bernard-12",
        "pilsner-urquell",
        "velkopopovicky-kozel-11",
    ]


@pytest.mark.django_db
def test_beer_already_on_a_merged_duplicate_is_not_new(client):
    token, _contributor = _register(client)
    old_lat, old_lng = 50.0825, 14.4205
    old_key = geohash8(old_lat, old_lng)
    # The duplicate had Pilsner on its own menu before the two were merged.
    _post_menu(client, token, [_PILSNER], name="Stará hospoda", lat=old_lat, lng=old_lng)
    canonical = CanonicalPub.objects.create(
        cache_key=_KEY, name=_PUB, name_key=normalize_pub_name(_PUB), lat=_LAT, lng=_LNG, city="Praha"
    )
    PubAlias.objects.create(
        canonical_pub=canonical, cache_key=_KEY, name=_PUB,
        name_key=normalize_pub_name(_PUB), lat=_LAT, lng=_LNG, is_primary=True,
    )
    PubAlias.objects.create(
        canonical_pub=canonical, cache_key=old_key, name="Stará hospoda",
        name_key=normalize_pub_name("Stará hospoda"), lat=old_lat, lng=old_lng,
    )

    _post_menu(client, token, [_PILSNER, _KOZEL])

    assert list(
        BeerTapEvent.objects.filter(cache_key=_KEY).values_list("product__key", flat=True)
    ) == ["velkopopovicky-kozel-11"]


@pytest.mark.django_db
def test_event_failure_never_fails_the_saved_menu(client, monkeypatch):
    token, _contributor = _register(client)

    def boom(**_kwargs):
        raise RuntimeError("outbox down")

    monkeypatch.setattr(api_views, "record_new_tap_events", boom)
    resp = _post_menu(client, token, [_PILSNER])

    assert [beer["name"] for beer in resp.json()["beers"]] == ["Pilsner Urquell"]
    assert BeerTapEvent.objects.count() == 0


# ---------------------------------------------------------------------------
# Sender
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_watcher_gets_one_push_per_day_across_two_events(client, monkeypatch):
    _token, watcher = _watcher(client, push_token="ExponentPushToken[watcher]")
    client.post(
        "/v1/beer-watches",
        data={"beer_name": "Kozel 11"},
        format="json",
        **_auth(_token),
    )
    contributor_token, _contributor = _register(client)
    _post_menu(client, contributor_token, [_PILSNER, _KOZEL])

    messages = _send(monkeypatch)

    assert len(messages) == 1
    message = messages[0]
    assert message["to"] == "ExponentPushToken[watcher]"
    assert message["title"] == "Na čepu poblíž"
    cell = snap_location(*_NEAR)
    distance = f"{api_views._haversine_km(*cell, _LAT, _LNG):.1f}".replace(".", ",")
    assert message["body"].endswith(
        f" je na čepu {_PUB}, {distance} km, doplnil někdo z komunity před chvílí"
    )
    assert message["data"] == {
        "kind": "beer_on_tap", "key": _KEY, "name": _PUB, "lat": _LAT, "lng": _LNG,
    }
    assert BeerWatchPush.objects.filter(account=watcher).count() == 1
    assert BeerTapEvent.objects.filter(fanned_out_at__isnull=True).count() == 0

    # A third beer on the same day: still nothing.
    client.post("/v1/beer-watches", data={"beer_name": "Bernard 12"}, format="json", **_auth(_token))
    _post_menu(client, contributor_token, [_PILSNER, _KOZEL, _BERNARD])
    assert _send(monkeypatch) == []


@pytest.mark.django_db
def test_push_renders_in_device_language_and_through_the_replaceable_helper(client, monkeypatch):
    _watcher(client, locale="en", push_token="ExponentPushToken[en]")
    contributor_token, _contributor = _register(client)
    _post_menu(client, contributor_token, [_PILSNER])
    BeerTapEvent.objects.update(observed_at=timezone.now() - timedelta(hours=3, minutes=5))
    captured: list[list[dict]] = []
    monkeypatch.setattr(api_views, "_post_expo", lambda messages: captured.append(messages))

    call_command("send_beer_watch_pushes", stdout=StringIO())

    [[message]] = captured
    assert message["title"] == "On tap nearby"
    assert message["body"].startswith(f"Pilsner Urquell is on tap at {_PUB}, ")
    assert message["body"].endswith(" km away, added by someone from the community 3 h ago")
    assert "," not in message["body"].split(" km away")[0].split(f"{_PUB}, ")[1]


@pytest.mark.django_db
def test_quiet_hours_keep_events_pending(client, monkeypatch, settings):
    _watcher(client)
    contributor_token, _contributor = _register(client)
    _post_menu(client, contributor_token, [_PILSNER])
    hour = timezone.localtime(timezone.now(), _PRAGUE).hour
    settings.BEER_WATCH_QUIET_HOURS = (hour, (hour + 1) % 24)

    assert _send(monkeypatch) == []
    assert BeerTapEvent.objects.get().fanned_out_at is None

    settings.BEER_WATCH_QUIET_HOURS = (0, 0)
    assert len(_send(monkeypatch)) == 1


def test_quiet_hours_window(settings):
    settings.BEER_WATCH_QUIET_HOURS = (22, 9)

    def at(hour: int) -> datetime:
        return datetime(2026, 10, 18, hour, 30, tzinfo=_PRAGUE)

    assert [h for h in range(24) if in_quiet_hours(at(h))] == [0, 1, 2, 3, 4, 5, 6, 7, 8, 22, 23]


@pytest.mark.django_db
def test_old_events_expire_unsent(client, monkeypatch):
    _watcher(client)
    contributor_token, _contributor = _register(client)
    _post_menu(client, contributor_token, [_PILSNER])
    BeerTapEvent.objects.update(observed_at=timezone.now() - timedelta(hours=13))

    assert _send(monkeypatch) == []
    assert BeerTapEvent.objects.get().fanned_out_at is not None
    assert BeerWatchPush.objects.count() == 0


@pytest.mark.django_db
def test_radius_decides_who_hears(client, monkeypatch):
    four_km = (_LAT + 0.036, _LNG)
    _watcher(client, at=four_km, push_token="ExponentPushToken[three]")
    _watcher(client, at=four_km, radius_m=5000, push_token="ExponentPushToken[five]")
    _watcher(client, at=(_LAT + 0.2, _LNG), radius_m=10000, push_token="ExponentPushToken[far]")
    contributor_token, _contributor = _register(client)
    _post_menu(client, contributor_token, [_PILSNER])

    assert [m["to"] for m in _send(monkeypatch)] == ["ExponentPushToken[five]"]


@pytest.mark.django_db
def test_contributor_off_devices_and_stale_location_get_nothing(client, monkeypatch):
    contributor_token, contributor = _watcher(client, push_token="ExponentPushToken[contrib]")
    off_token, _off = _watcher(client, push_token="ExponentPushToken[off]")
    client.generic(
        "DELETE",
        "/v1/push-device",
        data='{"push_token": "ExponentPushToken[off]"}',
        content_type="application/json",
        **_auth(off_token),
    )
    denied_token, _denied = _watcher(client, push_token="ExponentPushToken[denied]")
    _register_device(client, denied_token, "ExponentPushToken[denied]", permission_status="denied")
    _stale_token, stale = _watcher(client, push_token="ExponentPushToken[stale]")
    Account.objects.filter(pk=stale.pk).update(
        beer_watch_located_at=timezone.now() - timedelta(days=15)
    )
    _ok_token, _ok = _watcher(client, push_token="ExponentPushToken[ok]")

    _post_menu(client, contributor_token, [_PILSNER])

    assert [m["to"] for m in _send(monkeypatch)] == ["ExponentPushToken[ok]"]
    assert BeerWatchPush.objects.count() == 1
    assert contributor.pk not in BeerWatchPush.objects.values_list("account_id", flat=True)


@pytest.mark.django_db
def test_beer_removed_before_send_is_not_announced(client, monkeypatch):
    _watcher(client)
    contributor_token, _contributor = _register(client)
    _post_menu(client, contributor_token, [_PILSNER])
    _post_menu(client, contributor_token, [_KOZEL])

    assert _send(monkeypatch) == []
    assert BeerTapEvent.objects.get(product__key="pilsner-urquell").fanned_out_at is not None


@pytest.mark.django_db
def test_helped_count_reaches_the_contributor(client, monkeypatch):
    _watcher(client)
    _watcher(client)
    contributor_token, _contributor = _register(client)
    _post_menu(client, contributor_token, [_PILSNER])
    _send(monkeypatch)

    body = client.get("/v1/beer-watches", **_auth(contributor_token)).json()
    assert body["helped"] == [
        {"cache_key": _KEY, "product_name": "Pilsner Urquell", "helped_count": 2}
    ]


# ---------------------------------------------------------------------------
# Party toggle no longer silences beer pushes
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_party_opt_out_blocks_friend_push_but_not_beer_push(client, monkeypatch):
    token, watcher = _watcher(client, push_token="ExponentPushToken[party_off]")
    watcher.quiet_hours_enabled = False
    watcher.save(update_fields=["quiet_hours_enabled"])
    _register_device(client, token, "ExponentPushToken[party_off]", friend_push=False)
    assert PushDevice.objects.get(account=watcher).friend_push_enabled is False

    sent: list = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent))
    api_views._send_friend_push([watcher.pk], "Parta", "Kámo je v hospodě", {"kind": "friend_test"})
    assert sent == []

    contributor_token, _contributor = _register(client)
    _post_menu(client, contributor_token, [_PILSNER])
    assert [m["to"] for m in _send(monkeypatch)] == ["ExponentPushToken[party_off]"]

    _register_device(client, token, "ExponentPushToken[party_off]", friend_push=True)
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent))
    api_views._send_friend_push([watcher.pk], "Parta", "Kámo je v hospodě", {"kind": "friend_test"})
    assert len(sent) == 1


@pytest.mark.django_db
def test_released_push_device_payload_keeps_the_party_flag(client):
    token, account = _register(client)
    # Exactly what released apps send: no friend_push, no locale.
    released = {
        "push_token": "ExponentPushToken[released]",
        "platform": "android",
        "permission_status": "granted",
        "enabled": True,
        "app_version": "2.1.0",
    }
    resp = client.put("/v1/push-device", data=released, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert PushDevice.objects.get().friend_push_enabled is True

    _register_device(client, token, "ExponentPushToken[released]", friend_push=False)
    resp = client.put("/v1/push-device", data=released, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert PushDevice.objects.get().friend_push_enabled is False

    revisioned = {**released, "client_revision": 5}
    assert client.put("/v1/push-device", data=revisioned, format="json", **_auth(token)).status_code == 200
    assert PushDevice.objects.get().friend_push_enabled is False


@pytest.mark.django_db
def test_released_menu_payload_is_still_accepted(client):
    token, _contributor = _register(client)
    # A released full-menu write with no new fields.
    resp = client.post(
        "/v1/pub-community",
        data={
            "name": _PUB, "lat": _LAT, "lng": _LNG, "city": "Praha", "external_id": "mapy:abc",
            "client_id": str(uuid.uuid4()), "beers": [_PILSNER],
        },
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    assert BeerTapEvent.objects.count() == 1


# ---------------------------------------------------------------------------
# Account lifecycle, export and catalogue merge
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_anonymous_merge_moves_watches_pushes_and_contributions(client, monkeypatch):
    source_token, source = _watcher(client, push_token="ExponentPushToken[source]")
    client.post("/v1/beer-watches", data={"beer_name": "Kozel 11"}, format="json", **_auth(source_token))
    target_token, target = _register(client)
    client.post("/v1/beer-watches", data={"beer_name": "Pilsner Urquell"}, format="json", **_auth(target_token))
    contributor_token, contributor = _register(client)
    _post_menu(client, contributor_token, [_PILSNER])
    _send(monkeypatch)
    _post_menu(client, source_token, [_PILSNER, _BERNARD])
    assert BeerWatchPush.objects.filter(account=source).count() == 1

    with transaction.atomic():
        accounts._merge_anonymous_account(source, target)

    target.refresh_from_db()
    assert sorted(BeerWatch.objects.filter(account=target).values_list("product__key", flat=True)) == [
        "pilsner-urquell",
        "velkopopovicky-kozel-11",
    ]
    assert BeerWatchPush.objects.filter(account=target).count() == 1
    assert BeerTapEvent.objects.get(product__key="bernard-12").contributor_id == target.pk
    # The target had no location yet, so it takes the anonymous one.
    assert (target.beer_watch_lat, target.beer_watch_lng) == snap_location(*_NEAR)
    assert target.beer_watch_radius_m == 3000


@pytest.mark.django_db
def test_deletion_request_forgets_the_location(client):
    _token, account = _watcher(client)
    accounts.schedule_deletion(account)
    account.refresh_from_db()
    assert account.beer_watch_lat is None
    assert account.beer_watch_located_at is None


@pytest.mark.django_db
def test_export_lists_watches_pushes_and_helped_contributions(client, monkeypatch):
    watcher_token, _watcher_account = _watcher(client)
    contributor_token, _contributor = _register(client)
    _post_menu(client, contributor_token, [_PILSNER])
    _send(monkeypatch)

    watcher_export = client.get("/v1/account/export", **_auth(watcher_token)).json()["beer_watch"]
    assert watcher_export["radius_m"] == 3000
    lat, lng = snap_location(*_NEAR)
    assert watcher_export["location"] == {"lat": lat, "lng": lng}
    assert [w["product_key"] for w in watcher_export["watches"]] == ["pilsner-urquell"]
    today = timezone.localtime(timezone.now(), _PRAGUE).date().isoformat()
    assert [(p["local_date"], p["product_key"]) for p in watcher_export["pushes"]] == [
        (today, "pilsner-urquell")
    ]

    contributor_export = client.get("/v1/account/export", **_auth(contributor_token)).json()["beer_watch"]
    assert contributor_export["location"] is None
    assert [(e["product_key"], e["helped_count"]) for e in contributor_export["contributed_events"]] == [
        ("pilsner-urquell", 1)
    ]


@pytest.mark.django_db
def test_catalogue_merge_moves_watches_and_events(client, monkeypatch):
    brand = BeerBrand.objects.create(key="merge-brewery", name="Merge Brewery")
    source = BeerProduct.objects.create(
        key="merge-ipa-dup", brand=brand, brand_key=brand.key, brand_name=brand.name, name="Merge IPA dup"
    )
    target = BeerProduct.objects.create(
        key="merge-ipa", brand=brand, brand_key=brand.key, brand_name=brand.name, name="Merge IPA"
    )
    both_token, both = _watcher(client, beer="Merge IPA dup")
    client.post("/v1/beer-watches", data={"beer_name": "Merge IPA"}, format="json", **_auth(both_token))
    _only_token, only_source = _watcher(client, beer="Merge IPA dup")
    contributor_token, _contributor = _register(client)
    dup_on_menu = {"name": "Merge IPA dup", "price_czk": 70, "volume_ml": 500}
    _post_menu(client, contributor_token, [dup_on_menu])
    _send(monkeypatch)
    # The same pub also lists the target product, so both events exist there.
    _post_menu(client, contributor_token, [dup_on_menu, {"name": "Merge IPA", "price_czk": 70, "volume_ml": 300}])
    target_event = BeerTapEvent.objects.get(product=target)

    audit = merge_beer_products(source_key=source.key, target_key=target.key)

    assert audit.rewired["beer_watches"] == 1
    assert audit.rewired["beer_tap_events"] == 1
    assert set(BeerWatch.objects.values_list("account_id", "product_id")) == {
        (both.pk, target.pk),
        (only_source.pk, target.pk),
    }
    assert list(BeerTapEvent.objects.values_list("id", flat=True)) == [target_event.id]
    assert BeerWatchPush.objects.filter(event=target_event).count() == 2
