"""
Tests for the "Zmapuj hospodu" pub-amenity endpoints (data layer + Mapér XP):

    GET    /v1/pub-amenities/kinds                          — server taxonomy
    PUT    /v1/pub-amenities/votes                          — upsert votes (per-amenity LWW)
    GET    /v1/pub-amenities/votes                          — list own votes (restore)
    DELETE /v1/pub-amenities/votes/<cache_key>/<amenity_key> — idempotent retract
    GET    /v1/pub-amenities?cache_keys=...                  — public aggregates

Covers per-amenity LWW (stale push ignored, sibling amenity not clobbered),
retraction via null, unknown-amenity ignored (NOT 400), synchronous aggregate
recompute (counts + status), first_mapper immutability, the geohash-8 collision
guard on reads, the kinds endpoint (active-only, ordered, ISO version),
completeness clamping, and auth requirements. The Mapér XP / level / badge /
daily-cap behaviour is covered in test_pub_amenities_mapper.py.
"""

from __future__ import annotations

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from pubs.enrichment import geohash8
from pubs.models import (
    Account,
    AccountUsageStats,
    AmenityKind,
    PubAmenity,
    PubAmenityVote,
)

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_DEVICE_2 = "11112222-3333-4444-5555-666677778888"
_DEVICE_3 = "99998888-7777-6666-5555-444433332222"
_DEVICE_4 = "aaaa1111-bbbb-2222-cccc-333344445555"
_NAME = "U Černého vola"
_LAT = 50.0885
_LNG = 14.3984
_KEY = geohash8(_LAT, _LNG)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient, device_id: str = _DEVICE_ID) -> str:
    resp = client.post("/v1/account", data={"device_id": device_id}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    return resp.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _vote(**overrides):
    data = {
        "name": _NAME,
        "lat": _LAT,
        "lng": _LNG,
        "city": "Praha",
        "external_id": "mapy:12345",
        "amenity_key": "seating_garden",
        "value": "yes",
        "client_updated_at": "2026-06-23T18:30:00+02:00",
        "taxonomy_version": 1,
    }
    data.update(overrides)
    return data


def _put(client, token, *votes):
    return client.put(
        "/v1/pub-amenities/votes",
        data={"votes": list(votes)},
        format="json",
        **_auth(token),
    )


# ---------------------------------------------------------------------------
# kinds endpoint
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_kinds_returns_only_active_ordered_with_wire_names(client):
    resp = client.get("/v1/pub-amenities/kinds")
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()

    keys = [k["key"] for k in body["kinds"]]
    # Exactly the 16 active kinds; the two reserved (active=False) are excluded.
    assert len(keys) == 16
    assert "practical_outdoor_tap" not in keys
    assert "practical_tank_beer" not in keys

    # Ordered by (order, key).
    orders = [k["order"] for k in body["kinds"]]
    assert orders == sorted(orders)

    # Canonical wire field names, exactly 8 per item.
    first = body["kinds"][0]
    assert set(first.keys()) == {
        "key",
        "group",
        "label_cs",
        "short_label_cs",
        "icon",
        "map_filterable",
        "is_active",
        "order",
    }
    assert first["key"] == "payment_card"
    assert first["label_cs"] == "Platba kartou"
    assert first["short_label_cs"] == "Karta"
    assert first["icon"] == "CreditCardIcon"
    assert first["map_filterable"] is True
    assert first["is_active"] is True
    assert first["order"] == 10


@pytest.mark.django_db
def test_kinds_version_is_full_iso_timestamp(client):
    resp = client.get("/v1/pub-amenities/kinds")
    version = resp.json()["version"]
    # Full ISO-8601 (date + time), not a bare date: two same-day edits differ.
    assert "T" in version


@pytest.mark.django_db
def test_kinds_version_changes_on_same_day_edit(client):
    v1 = client.get("/v1/pub-amenities/kinds").json()["version"]
    # Touch one active kind so its updated_at advances within the same day.
    kind = AmenityKind.objects.get(key="practical_wifi")
    kind.label = "Wi-Fi (test)"
    kind.save()
    v2 = client.get("/v1/pub-amenities/kinds").json()["version"]
    assert v2 != v1


@pytest.mark.django_db
def test_kinds_is_public(client):
    resp = client.get("/v1/pub-amenities/kinds")
    assert resp.status_code == status.HTTP_200_OK


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_put_requires_account_token(client):
    # No Bearer at all → 401.
    resp = client.put(
        "/v1/pub-amenities/votes", data={"votes": [_vote()]}, format="json"
    )
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    assert PubAmenityVote.objects.count() == 0


@pytest.mark.django_db
def test_get_votes_requires_account_token(client):
    resp = client.get("/v1/pub-amenities/votes")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_delete_requires_account_token(client):
    resp = client.delete(f"/v1/pub-amenities/votes/{_KEY}/seating_garden")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_read_is_public(client):
    resp = client.get("/v1/pub-amenities", {"cache_keys": _KEY})
    assert resp.status_code == status.HTTP_200_OK


# ---------------------------------------------------------------------------
# Upsert happy path + geohash + aggregate creation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_put_creates_vote_and_aggregate(client):
    token = _register(client)
    resp = _put(client, token, _vote())
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()

    assert "mapper" in body  # envelope-level Mapér snapshot present
    result = body["results"][0]
    assert result["applied"] is True
    assert result["ignored_unknown_amenity"] is False
    assert result["deleted"] is False
    assert result["was_first_map"] is True  # first vote created the aggregate row
    # First mapper of a fresh amenity: first_fact (15) + first_mapper_bonus (25).
    assert result["xp_awarded"] == 40
    assert result["vote"] == {
        "amenity_key": "seating_garden",
        "value": "yes",
        "client_updated_at": "2026-06-23T16:30:00+00:00",
    }
    agg = result["aggregate"]
    assert agg["amenity_key"] == "seating_garden"
    assert agg["yes_count"] == 1
    assert agg["no_count"] == 0
    assert agg["distinct_voter_count"] == 1
    assert agg["status"] == "unknown"  # 1 vote < AMENITY_MIN_VOTES (3)
    assert agg["my_value"] == "yes"

    vote = PubAmenityVote.objects.get()
    assert vote.account == Account.objects.get(device_id=_DEVICE_ID)
    assert vote.cache_key == _KEY
    assert vote.amenity_key == "seating_garden"
    assert vote.value == "yes"
    assert vote.taxonomy_version == 1

    row = PubAmenity.objects.get()
    assert row.cache_key == _KEY
    assert row.first_mapper == vote.account
    assert row.first_mapped_at is not None
    # lat/lng denormalised server-side but never in the wire payload.
    assert "lat" not in agg and "lng" not in agg and "name" not in agg


@pytest.mark.django_db
def test_put_flip_overwrites_does_not_stack(client):
    token = _register(client)
    _put(client, token, _vote(value="yes", client_updated_at="2026-06-23T18:30:00+02:00"))
    resp = _put(client, token, _vote(value="no", client_updated_at="2026-06-23T19:30:00+02:00"))
    assert resp.json()["results"][0]["applied"] is True

    assert PubAmenityVote.objects.count() == 1  # flip overwrote, did not stack
    row = PubAmenity.objects.get()
    assert row.yes_count == 0
    assert row.no_count == 1
    assert row.distinct_voter_count == 1


# ---------------------------------------------------------------------------
# Per-amenity LWW
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_lww_stale_push_is_ignored(client):
    token = _register(client)
    _put(client, token, _vote(value="yes", client_updated_at="2026-06-23T19:30:00+02:00"))

    resp = _put(client, token, _vote(value="no", client_updated_at="2026-06-23T10:00:00+02:00"))
    result = resp.json()["results"][0]
    assert result["applied"] is False
    assert result["ignored_unknown_amenity"] is False
    # Current aggregate (the newer "yes") is returned unchanged.
    assert result["aggregate"]["yes_count"] == 1
    assert result["aggregate"]["no_count"] == 0
    assert PubAmenityVote.objects.get().value == "yes"


@pytest.mark.django_db
def test_lww_stale_push_of_one_amenity_does_not_clobber_sibling(client):
    token = _register(client)
    # Map garden (newer) and wifi.
    _put(
        client,
        token,
        _vote(amenity_key="seating_garden", value="yes", client_updated_at="2026-06-23T19:00:00+02:00"),
        _vote(amenity_key="practical_wifi", value="yes", client_updated_at="2026-06-23T19:00:00+02:00"),
    )
    # A STALE garden push must not touch wifi.
    _put(
        client,
        token,
        _vote(amenity_key="seating_garden", value="no", client_updated_at="2026-06-23T08:00:00+02:00"),
    )

    garden = PubAmenityVote.objects.get(amenity_key="seating_garden")
    wifi = PubAmenityVote.objects.get(amenity_key="practical_wifi")
    assert garden.value == "yes"  # stale push ignored
    assert wifi.value == "yes"  # sibling untouched


@pytest.mark.django_db
def test_lww_equal_timestamp_is_ignored(client):
    token = _register(client)
    ts = "2026-06-23T18:30:00+02:00"
    _put(client, token, _vote(value="yes", client_updated_at=ts))
    resp = _put(client, token, _vote(value="no", client_updated_at=ts))
    # Equal timestamp is not strictly newer → ignored (>= guard).
    assert resp.json()["results"][0]["applied"] is False
    assert PubAmenityVote.objects.get().value == "yes"


# ---------------------------------------------------------------------------
# Retraction via null
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_retract_via_null_deletes_and_recomputes(client):
    token = _register(client)
    _put(client, token, _vote(value="yes", client_updated_at="2026-06-23T18:30:00+02:00"))
    assert PubAmenityVote.objects.count() == 1

    resp = _put(client, token, _vote(value=None, client_updated_at="2026-06-23T19:30:00+02:00"))
    result = resp.json()["results"][0]
    assert result["applied"] is True
    assert result["deleted"] is True
    assert result["was_first_map"] is False
    assert result["vote"] is None
    assert result["aggregate"]["yes_count"] == 0
    assert result["aggregate"]["distinct_voter_count"] == 0
    assert result["aggregate"]["status"] == "unknown"

    assert PubAmenityVote.objects.count() == 0
    # Aggregate row is retained (recomputed to zero), not deleted.
    assert PubAmenity.objects.get().yes_count == 0


@pytest.mark.django_db
def test_retract_is_lww_guarded(client):
    token = _register(client)
    _put(client, token, _vote(value="yes", client_updated_at="2026-06-23T19:30:00+02:00"))
    # A STALE null retraction must not delete the newer vote.
    resp = _put(client, token, _vote(value=None, client_updated_at="2026-06-23T08:00:00+02:00"))
    assert resp.json()["results"][0]["applied"] is False
    assert PubAmenityVote.objects.count() == 1


# ---------------------------------------------------------------------------
# Unknown amenity → ignored, NOT 400 (additive forward-compat)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_unknown_amenity_key_is_ignored_not_400(client):
    token = _register(client)
    resp = _put(client, token, _vote(amenity_key="seating_helipad"))
    assert resp.status_code == status.HTTP_200_OK  # NOT 400
    result = resp.json()["results"][0]
    assert result["applied"] is False
    assert result["ignored_unknown_amenity"] is True
    assert result["vote"] is None
    assert result["aggregate"] is None
    assert PubAmenityVote.objects.count() == 0


@pytest.mark.django_db
def test_inactive_amenity_key_is_ignored(client):
    token = _register(client)
    # practical_tank_beer is seeded but active=False → write ignored.
    resp = _put(client, token, _vote(amenity_key="practical_tank_beer"))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["results"][0]["ignored_unknown_amenity"] is True
    assert PubAmenityVote.objects.count() == 0


@pytest.mark.django_db
def test_future_unknown_extra_fields_tolerated(client):
    token = _register(client)
    payload = _vote()
    payload["some_future_field"] = "whatever"
    payload["taxonomy_version"] = 999  # a future version still 2xx's
    resp = _put(client, token, payload)
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["results"][0]["applied"] is True


# ---------------------------------------------------------------------------
# Aggregate recompute: counts + status boundaries
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_aggregate_status_unknown_until_min_votes_then_yes(client):
    # 3 distinct accounts all vote yes → 3 >= AMENITY_MIN_VOTES → status "yes".
    for device in (_DEVICE_ID, _DEVICE_2, _DEVICE_3):
        token = _register(client, device_id=device)
        _put(client, token, _vote(value="yes"))

    row = PubAmenity.objects.get()
    assert row.yes_count == 3
    assert row.no_count == 0
    assert row.distinct_voter_count == 3
    assert row.status == "yes"
    assert row.confidence > 0


@pytest.mark.django_db
def test_aggregate_status_disputed(client):
    # 2 yes + 2 no = 4 votes, minority 2/4 = 0.5 >= dispute ratio → "disputed".
    for device, val in (
        (_DEVICE_ID, "yes"),
        (_DEVICE_2, "yes"),
        (_DEVICE_3, "no"),
        (_DEVICE_4, "no"),
    ):
        token = _register(client, device_id=device)
        _put(client, token, _vote(value=val))

    row = PubAmenity.objects.get()
    assert row.yes_count == 2
    assert row.no_count == 2
    assert row.status == "disputed"


@pytest.mark.django_db
def test_aggregate_recount_under_flip_then_retract(client):
    token = _register(client)
    _put(client, token, _vote(value="yes", client_updated_at="2026-06-23T18:00:00+02:00"))
    _put(client, token, _vote(value="no", client_updated_at="2026-06-23T19:00:00+02:00"))
    row = PubAmenity.objects.get()
    assert (row.yes_count, row.no_count) == (0, 1)

    _put(client, token, _vote(value=None, client_updated_at="2026-06-23T20:00:00+02:00"))
    row.refresh_from_db()
    assert (row.yes_count, row.no_count, row.distinct_voter_count) == (0, 0, 0)


# ---------------------------------------------------------------------------
# first_mapper immutability
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_first_mapper_set_once_and_immutable(client):
    token_a = _register(client)
    _put(client, token_a, _vote(value="yes"))
    account_a = Account.objects.get(device_id=_DEVICE_ID)
    row = PubAmenity.objects.get()
    assert row.first_mapper == account_a
    first_mapped_at = row.first_mapped_at

    # A different account voting later does NOT change first_mapper.
    token_b = _register(client, device_id=_DEVICE_2)
    _put(client, token_b, _vote(value="no"))
    row.refresh_from_db()
    assert row.first_mapper == account_a
    assert row.first_mapped_at == first_mapped_at

    # Even the original first-mapper retracting does NOT reattribute.
    _put(client, token_a, _vote(value=None, client_updated_at="2026-06-24T18:30:00+02:00"))
    row.refresh_from_db()
    assert row.first_mapper == account_a


# ---------------------------------------------------------------------------
# GET own votes (restore)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_get_votes_lists_own_only(client):
    token_a = _register(client)
    _put(
        client,
        token_a,
        _vote(amenity_key="seating_garden", value="yes"),
        _vote(amenity_key="practical_wifi", value="no"),
    )
    token_b = _register(client, device_id=_DEVICE_2)
    _put(client, token_b, _vote(amenity_key="game_darts", value="yes"))

    resp = client.get("/v1/pub-amenities/votes", **_auth(token_a))
    assert resp.status_code == status.HTTP_200_OK
    votes = resp.json()["votes"]
    assert len(votes) == 2
    keys = {v["amenity_key"] for v in votes}
    assert keys == {"seating_garden", "practical_wifi"}
    item = next(v for v in votes if v["amenity_key"] == "seating_garden")
    assert set(item.keys()) == {"cache_key", "amenity_key", "value", "client_updated_at"}
    assert item["cache_key"] == _KEY


# ---------------------------------------------------------------------------
# DELETE retract
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_delete_removes_vote_and_recomputes(client):
    token = _register(client)
    _put(client, token, _vote(value="yes"))
    resp = client.delete(f"/v1/pub-amenities/votes/{_KEY}/seating_garden", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": True}
    assert PubAmenityVote.objects.count() == 0
    assert PubAmenity.objects.get().yes_count == 0


@pytest.mark.django_db
def test_delete_never_changes_xp_and_revote_does_not_refarm(client):
    """The DELETE retract path is a separate handler from PUT value:null — it
    must never pay, never claw back XP, and a later re-vote must not re-farm
    (§7.3). The durable AmenityXpLedger outlives the deleted row."""
    token = _register(client)
    _put(client, token, _vote(value="yes"))
    account = Account.objects.get(device_id=_DEVICE_ID)
    xp_before = AccountUsageStats.objects.get(account=account).mapper_xp
    assert xp_before > 0  # first map earned XP

    resp = client.delete(f"/v1/pub-amenities/votes/{_KEY}/seating_garden", **_auth(token))
    assert resp.json() == {"deleted": True}
    # DELETE never touches durable XP.
    assert AccountUsageStats.objects.get(account=account).mapper_xp == xp_before

    # Re-vote the same amenity via PUT: the ledger row survived the hard delete,
    # so the base XP gate is tripped and the re-vote pays 0 (no double claw).
    revote = _put(
        client, token, _vote(value="yes", client_updated_at="2026-06-23T20:00:00+02:00")
    )
    assert revote.json()["results"][0]["xp_awarded"] == 0
    assert AccountUsageStats.objects.get(account=account).mapper_xp == xp_before


@pytest.mark.django_db
def test_delete_unknown_is_idempotent_success(client):
    token = _register(client)
    resp = client.delete(f"/v1/pub-amenities/votes/{_KEY}/seating_garden", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": False}


@pytest.mark.django_db
def test_delete_account_isolation(client):
    token_a = _register(client)
    _put(client, token_a, _vote(value="yes"))
    token_b = _register(client, device_id=_DEVICE_2)
    resp = client.delete(f"/v1/pub-amenities/votes/{_KEY}/seating_garden", **_auth(token_b))
    assert resp.json() == {"deleted": False}
    assert PubAmenityVote.objects.count() == 1


# ---------------------------------------------------------------------------
# Public aggregate read
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_read_aggregates_and_completeness(client):
    # 3 yes on garden (→ status yes, counts toward completeness) + 1 wifi.
    for device in (_DEVICE_ID, _DEVICE_2, _DEVICE_3):
        token = _register(client, device_id=device)
        _put(client, token, _vote(amenity_key="seating_garden", value="yes"))
    _put(client, token, _vote(amenity_key="practical_wifi", value="yes"))

    resp = client.get("/v1/pub-amenities", {"cache_keys": _KEY, "name": _NAME})
    assert resp.status_code == status.HTTP_200_OK
    pub = resp.json()["pubs"][0]
    assert pub["cache_key"] == _KEY
    assert pub["mapper_count"] == 3  # distinct accounts (garden had 3)
    assert pub["completeness"]["total_kinds"] == 16
    # Only garden has status != unknown (wifi has 1 vote).
    assert pub["completeness"]["mapped_count"] == 1
    assert pub["completeness"]["pct"] == pytest.approx(1 / 16, abs=1e-4)

    by_key = {a["amenity_key"]: a for a in pub["amenities"]}
    assert by_key["seating_garden"]["status"] == "yes"
    assert by_key["practical_wifi"]["status"] == "unknown"
    # Anonymous read → my_value is null.
    assert by_key["seating_garden"]["my_value"] is None


@pytest.mark.django_db
def test_read_my_value_populated_when_authenticated(client):
    token = _register(client)
    _put(client, token, _vote(value="yes"))
    resp = client.get("/v1/pub-amenities", {"cache_keys": _KEY, "name": _NAME}, **_auth(token))
    pub = resp.json()["pubs"][0]
    amenity = pub["amenities"][0]
    assert amenity["my_value"] == "yes"


@pytest.mark.django_db
def test_read_names_match_collision_guard(client):
    token = _register(client)
    _put(client, token, _vote(value="yes"))
    # A neighbouring DIFFERENT business in the same geohash-8 cell must not
    # inherit these votes: names_match drops the row → unmapped.
    resp = client.get(
        "/v1/pub-amenities",
        {"cache_keys": _KEY, "name": "Lékárna Na rohu"},
    )
    pub = resp.json()["pubs"][0]
    assert pub["amenities"] == []
    assert pub["completeness"]["mapped_count"] == 0
    assert pub["mapper_count"] == 0


@pytest.mark.django_db
def test_read_deactivated_kind_excluded_and_completeness_clamped(client):
    # Map garden to status yes (3 votes), then deactivate the kind.
    for device in (_DEVICE_ID, _DEVICE_2, _DEVICE_3):
        token = _register(client, device_id=device)
        _put(client, token, _vote(amenity_key="seating_garden", value="yes"))

    AmenityKind.objects.filter(key="seating_garden").update(active=False)

    resp = client.get("/v1/pub-amenities", {"cache_keys": _KEY, "name": _NAME})
    pub = resp.json()["pubs"][0]
    # Deactivated kind is excluded from amenities AND completeness numerator;
    # the denominator drops to 15. pct stays clamped within [0, 1].
    assert all(a["amenity_key"] != "seating_garden" for a in pub["amenities"])
    assert pub["completeness"]["total_kinds"] == 15
    assert pub["completeness"]["mapped_count"] == 0
    assert 0.0 <= pub["completeness"]["pct"] <= 1.0


@pytest.mark.django_db
def test_read_empty_for_unmapped_cell(client):
    resp = client.get("/v1/pub-amenities", {"cache_keys": _KEY})
    pub = resp.json()["pubs"][0]
    assert pub["amenities"] == []
    assert pub["completeness"]["mapped_count"] == 0
    assert pub["completeness"]["total_kinds"] == 16


@pytest.mark.django_db
def test_read_caps_cache_keys(client, settings):
    settings.AMENITY_READ_MAX_KEYS = 2
    keys = ",".join([f"u2fkbnh{i}" for i in range(10)])
    resp = client.get("/v1/pub-amenities", {"cache_keys": keys})
    assert resp.status_code == status.HTTP_200_OK
    assert len(resp.json()["pubs"]) == 2


# ---------------------------------------------------------------------------
# Concurrency-shape: two first voters → one aggregate row, counts correct
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_two_first_voters_single_aggregate_row(client):
    token_a = _register(client)
    token_b = _register(client, device_id=_DEVICE_2)
    _put(client, token_a, _vote(value="yes"))
    _put(client, token_b, _vote(value="yes"))

    assert PubAmenity.objects.filter(cache_key=_KEY, amenity_key="seating_garden").count() == 1
    row = PubAmenity.objects.get()
    assert row.yes_count == 2
    assert row.distinct_voter_count == 2


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_put_validation_errors(client):
    token = _register(client)
    missing_ts = client.put(
        "/v1/pub-amenities/votes",
        data={"votes": [{k: v for k, v in _vote().items() if k != "client_updated_at"}]},
        format="json",
        **_auth(token),
    )
    bad_lat = _put(client, token, _vote(lat=999))
    empty = client.put(
        "/v1/pub-amenities/votes", data={"votes": []}, format="json", **_auth(token)
    )
    for resp in (missing_ts, bad_lat, empty):
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert PubAmenityVote.objects.count() == 0


# ---------------------------------------------------------------------------
# Throttling
# ---------------------------------------------------------------------------


def test_throttle_scopes_configured(settings):
    rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
    assert "pub_amenities" in rates
    assert "amenity_kinds" in rates
    assert "amenity_reads" in rates


@pytest.mark.django_db
def test_put_endpoint_is_throttled(client, monkeypatch):
    token = _register(client)
    rates = dict(ScopedRateThrottle.THROTTLE_RATES)
    rates["pub_amenities"] = "3/min"
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", rates)

    for i in range(3):
        resp = _put(
            client,
            token,
            _vote(lat=50.0 + i * 0.01, client_updated_at=f"2026-06-2{i}T18:30:00+02:00"),
        )
        assert resp.status_code == status.HTTP_200_OK

    throttled = _put(client, token, _vote(lat=50.5))
    assert throttled.status_code == status.HTTP_429_TOO_MANY_REQUESTS


# ---------------------------------------------------------------------------
# Public reads must never 401 on a stale/invalid bearer (§4.4, like PubsNearView)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_kinds_does_not_401_on_invalid_bearer(client):
    # A client holding a stale token must still read the public taxonomy.
    resp = client.get("/v1/pub-amenities/kinds", **_auth("not-a-real-token"))
    assert resp.status_code == status.HTTP_200_OK
    assert "kinds" in resp.json()


@pytest.mark.django_db
def test_read_does_not_401_on_invalid_bearer_degrades_to_anonymous(client):
    # Map a pub so there is something to read, then read it with a bad token.
    token = _register(client)
    _put(client, token, _vote(value="yes"))

    resp = client.get(
        "/v1/pub-amenities",
        {"cache_keys": _KEY, "name": _NAME},
        **_auth("stale-or-expired-token"),
    )
    # Public read: a bad token degrades to anonymous (my_value null), never 401.
    assert resp.status_code == status.HTTP_200_OK
    amenity = resp.json()["pubs"][0]["amenities"][0]
    assert amenity["my_value"] is None


# ---------------------------------------------------------------------------
# name is the collision guard: required non-blank write + empty-name read drop
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_put_rejects_blank_name(client):
    # A blank name would create a guardless aggregate; reject it (§2.6/§4.2).
    token = _register(client)
    resp = _put(client, token, _vote(name=""))
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert PubAmenityVote.objects.count() == 0
    assert PubAmenity.objects.count() == 0


@pytest.mark.django_db
def test_put_requires_name(client):
    token = _register(client)
    resp = client.put(
        "/v1/pub-amenities/votes",
        data={"votes": [{k: v for k, v in _vote().items() if k != "name"}]},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert PubAmenityVote.objects.count() == 0


@pytest.mark.django_db
def test_read_drops_empty_name_aggregate_when_caller_sends_name(client):
    # Defense in depth for any legacy guardless row: an aggregate with an empty
    # stored name must NOT be served to a named caller (it can't be verified).
    token = _register(client)
    _put(client, token, _vote(value="yes"))
    PubAmenity.objects.filter(cache_key=_KEY).update(name="")

    resp = client.get("/v1/pub-amenities", {"cache_keys": _KEY, "name": _NAME})
    pub = resp.json()["pubs"][0]
    assert pub["amenities"] == []
    assert pub["mapper_count"] == 0


# ---------------------------------------------------------------------------
# GDPR export + account-deletion cascade cover PubAmenityVote (§8.5)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_export_includes_amenity_votes(client):
    token = _register(client)
    _put(client, token, _vote(value="yes"))

    resp = client.get("/v1/account/export", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert "amenity_votes" in body
    assert len(body["amenity_votes"]) == 1
    vote = body["amenity_votes"][0]
    assert vote["cache_key"] == _KEY
    assert vote["amenity_key"] == "seating_garden"
    assert vote["value"] == "yes"


@pytest.mark.django_db
def test_account_deletion_cascades_votes_and_nulls_first_mapper(client):
    token = _register(client)
    _put(client, token, _vote(value="yes"))
    account = Account.objects.get(device_id=_DEVICE_ID)
    assert PubAmenityVote.objects.filter(account=account).count() == 1
    assert PubAmenity.objects.get().first_mapper == account

    account.delete()

    # Vote rows cascade with the account FK; the public aggregate survives with
    # first_mapper SET_NULL (immutable identity is lost, the row is not).
    assert PubAmenityVote.objects.count() == 0
    row = PubAmenity.objects.get()
    assert row.first_mapper is None


# ---------------------------------------------------------------------------
# Account merge: amenity votes move + aggregate stays derived-from-votes (§5.5)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_merge_moves_amenity_votes_and_recomputes_aggregate(client):
    from pubs.accounts import _merge_anonymous_account

    token_source = _register(client)
    _put(client, token_source, _vote(value="yes"))
    source = Account.objects.get(device_id=_DEVICE_ID)
    target = Account.objects.create(device_id="merge-target-0000")

    _merge_anonymous_account(source, target)

    # Vote followed the user onto the target, and the aggregate recount keeps the
    # count at 1 (no over-count from the dropped source account).
    assert not Account.objects.filter(pk=source.pk).exists()
    vote = PubAmenityVote.objects.get()
    assert vote.account == target
    row = PubAmenity.objects.get()
    assert row.yes_count == 1
    assert row.distinct_voter_count == 1


@pytest.mark.django_db
def test_merge_conflict_drops_duplicate_and_recomputes(client):
    # Both source and target already voted on the same (pub, amenity): the merge
    # drops the source duplicate, and the aggregate must NOT keep counting both.
    from pubs.accounts import _merge_anonymous_account

    token_source = _register(client)
    _put(client, token_source, _vote(value="yes"))
    source = Account.objects.get(device_id=_DEVICE_ID)

    token_target = _register(client, device_id=_DEVICE_2)
    _put(client, token_target, _vote(value="yes"))
    target = Account.objects.get(device_id=_DEVICE_2)

    row = PubAmenity.objects.get()
    assert row.yes_count == 2  # two distinct accounts pre-merge

    _merge_anonymous_account(source, target)

    # Source duplicate dropped; aggregate recounted to a single live vote.
    assert PubAmenityVote.objects.count() == 1
    row.refresh_from_db()
    assert row.yes_count == 1
    assert row.distinct_voter_count == 1


# ---------------------------------------------------------------------------
# Concurrent first-insert: IntegrityError on get_or_create must not 500 (§8.5)
# ---------------------------------------------------------------------------


def test_first_vote_uses_integrityerror_safe_upsert_constructs():
    # §8.5 race: "two simultaneous first votes → one row, no IntegrityError 500".
    # The real defense is Django's get_or_create (aggregate row) + update_or_create
    # (vote row), both of which absorb a concurrent-insert unique violation via a
    # savepoint + re-fetch. A faithful DB-level race needs TransactionTestCase +
    # threads + postgres (select_for_update is a no-op on sqlite), so this guard
    # pins the SAFE constructs structurally: a regression that swapped either for
    # a naive .create()/.save() (which would 500 under the race) is caught here.
    import inspect

    from pubs.api import views

    recompute_src = inspect.getsource(views._recompute_amenity_aggregate)
    assert "get_or_create" in recompute_src  # aggregate row: concurrent-insert safe
    assert "select_for_update" in recompute_src  # hot-pub recount serialized

    apply_src = inspect.getsource(views.PubAmenityVoteView._apply_one)
    assert "update_or_create" in apply_src  # vote upsert: concurrent-insert safe


@pytest.mark.django_db
def test_two_first_voters_recount_is_correct_after_both_insert(client):
    # Outcome the race-safe path must guarantee (the counts side of §8.5): two
    # different accounts' first votes collapse to ONE aggregate row counting both.
    token_a = _register(client)
    token_b = _register(client, device_id=_DEVICE_2)
    resp_a = _put(client, token_a, _vote(value="yes"))
    resp_b = _put(client, token_b, _vote(value="no"))
    assert resp_a.status_code == status.HTTP_200_OK
    assert resp_b.status_code == status.HTTP_200_OK

    assert PubAmenity.objects.filter(cache_key=_KEY, amenity_key="seating_garden").count() == 1
    row = PubAmenity.objects.get()
    assert (row.yes_count, row.no_count, row.distinct_voter_count) == (1, 1, 2)


# ---------------------------------------------------------------------------
# _amenity_status pure-function boundaries (§5.4: MIN_VOTES before dispute)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_amenity_status_boundaries_pin_min_votes_before_dispute(settings):
    from pubs.api.views import _amenity_status

    status_ = PubAmenity.Status
    assert settings.AMENITY_MIN_VOTES == 3

    # (yes, no) -> expected status. The (1,1) case is the pathological 2-vote
    # disagreement: minority 0.5 >= dispute ratio BUT total < MIN_VOTES, so it
    # MUST stay "unknown" (the whole sock-puppet defense rests on this ordering).
    cases = {
        (0, 0): status_.UNKNOWN,
        (1, 0): status_.UNKNOWN,
        (2, 0): status_.UNKNOWN,
        (1, 1): status_.UNKNOWN,  # NOT disputed — MIN_VOTES guard runs first
        (2, 1): status_.YES,
        (2, 2): status_.DISPUTED,
        (3, 0): status_.YES,
        (0, 3): status_.NO,
    }
    for (yes, no), expected in cases.items():
        result_status, confidence = _amenity_status(yes, no)
        assert result_status == expected, f"{yes}y/{no}n → {result_status}, want {expected}"
        assert 0.0 <= confidence <= 1.0

    # Confidence is exact agreement×volume rounded to 4 (pins the formula).
    assert _amenity_status(3, 0)[1] == round((3 / 3) * (3 / 5), 4)
    assert _amenity_status(2, 1)[1] == round((2 / 3) * (3 / 5), 4)
