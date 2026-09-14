"""
Tests for pubs.api.cache.get_or_enrich.

All tests use pytest-django (db fixture) and mock FirmyHoursSource so no
live network traffic is made.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone as dj_tz

from pubs.api.cache import get_or_enrich
from pubs.enrichment import RawHours, geohash8
from pubs.models import (
    EnrichTask,
    ExternalApiDailyUsage,
    PubCommunityData,
    PubExternalBeerMenu,
    PubHours,
)

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

_FLEKY_NAME = "Restaurace U Fleků"
_FLEKY_LAT = 50.0812
_FLEKY_LNG = 14.4182
_FLEKY_KEY = geohash8(_FLEKY_LAT, _FLEKY_LNG)
_FLEKY_HOURS = "Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00"

_GOOD_RAW = RawHours(
    opening_hours_raw=_FLEKY_HOURS,
    source="firmy",
    source_ref="272313",
    matched_name=_FLEKY_NAME,
    matched_lat=_FLEKY_LAT,
    matched_lng=_FLEKY_LNG,
    confidence=0.95,
    rating_value=4.1,
    rating_count=364,
    rating_label="Velmi dobré",
)

_PUB_ENTRY = {"name": _FLEKY_NAME, "lat": _FLEKY_LAT, "lng": _FLEKY_LNG}


def _make_fresh_row(**kwargs) -> PubHours:
    """Create a fresh PubHours row in the DB."""
    defaults = dict(
        cache_key=_FLEKY_KEY,
        name=_FLEKY_NAME,
        lat=_FLEKY_LAT,
        lng=_FLEKY_LNG,
        opening_hours_raw=_FLEKY_HOURS,
        source="firmy",
        source_ref="272313",
        confidence=0.95,
        rating_value=4.1,
        rating_count=364,
        rating_label="Velmi dobré",
        status=PubHours.Status.OK,
        fetched_at=dj_tz.now(),
    )
    defaults.update(kwargs)
    return PubHours.objects.create(**defaults)


def _make_external_menu(**kwargs) -> PubExternalBeerMenu:
    defaults = {
        "cache_key": _FLEKY_KEY,
        "name": _FLEKY_NAME,
        "lat": _FLEKY_LAT,
        "lng": _FLEKY_LNG,
        "city": "Praha",
        "source": PubExternalBeerMenu.Source.PIVAROVA_MAPA,
        "source_id": "pivaro-fleky",
        "source_url": "https://pivarovamapa.cz/podnik/u-fleku",
        "beers": [{"name": "Flekovský ležák 13°", "price_czk": 79, "volume_ml": 400}],
        "verified_at": dj_tz.now(),
    }
    defaults.update(kwargs)
    return PubExternalBeerMenu.objects.create(**defaults)


@pytest.mark.django_db
def test_external_menu_fills_pub_without_user_beers():
    _make_fresh_row()
    external = _make_external_menu()

    result = get_or_enrich([_PUB_ENTRY], sync_budget=0)[0]

    assert result["beers"] == external.beers
    assert result["beers_source"] == "pivarova_mapa"
    assert result["beers_source_url"] == external.source_url
    assert result["venueKind"] == "pub"


@pytest.mark.django_db
def test_user_menu_always_wins_over_external_menu():
    _make_fresh_row()
    _make_external_menu()
    PubCommunityData.objects.create(
        cache_key=_FLEKY_KEY,
        name=_FLEKY_NAME,
        lat=_FLEKY_LAT,
        lng=_FLEKY_LNG,
        beers=[{"name": "Uživatelské pivo", "price_czk": 55, "volume_ml": 500}],
        beers_updated_at=dj_tz.now(),
    )

    result = get_or_enrich([_PUB_ENTRY], sync_budget=0)[0]

    assert result["beers"] == [
        {"name": "Uživatelské pivo", "price_czk": 55, "volume_ml": 500}
    ]
    assert result["beers_source"] == "community"
    assert result["beers_source_url"] is None


@pytest.mark.django_db
def test_explicit_empty_user_menu_suppresses_external_fallback():
    _make_fresh_row()
    _make_external_menu()
    PubCommunityData.objects.create(
        cache_key=_FLEKY_KEY,
        name=_FLEKY_NAME,
        lat=_FLEKY_LAT,
        lng=_FLEKY_LNG,
        beers=[],
        beers_updated_at=dj_tz.now(),
    )

    result = get_or_enrich([_PUB_ENTRY], sync_budget=0)[0]

    assert result["beers"] == []
    assert result["beers_source"] == "community"


@pytest.mark.django_db
def test_legacy_user_menu_without_timestamp_still_wins():
    _make_fresh_row()
    _make_external_menu()
    PubCommunityData.objects.create(
        cache_key=_FLEKY_KEY,
        name=_FLEKY_NAME,
        lat=_FLEKY_LAT,
        lng=_FLEKY_LNG,
        beers=[{"name": "Starší uživatelské pivo", "price_czk": 49, "volume_ml": 500}],
        beers_updated_at=None,
    )

    result = get_or_enrich([_PUB_ENTRY], sync_budget=0)[0]

    assert result["beers"] == [
        {"name": "Starší uživatelské pivo", "price_czk": 49, "volume_ml": 500}
    ]
    assert result["beers_source"] is None


# ---------------------------------------------------------------------------
# Test: cache HIT — no scraping
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_cache_hit_returns_without_scraping():
    """A fresh cached row is returned without calling FirmyHoursSource."""
    _make_fresh_row()

    with patch("pubs.api.cache.FirmyHoursSource") as mock_cls:
        results = get_or_enrich([_PUB_ENTRY], sync_budget=3)

    mock_cls.assert_not_called()

    assert len(results) == 1
    r = results[0]
    assert r["key"] == _FLEKY_KEY
    assert r["name"] == _FLEKY_NAME
    assert r["opening_hours"] == _FLEKY_HOURS
    assert r["status"] == "ok"
    assert r["confidence"] == pytest.approx(0.95)
    assert r["source"] == "firmy"
    assert r["rating"] == pytest.approx(4.1)
    assert r["ratingCount"] == 364
    assert r["ratingLabel"] == "Velmi dobré"
    assert r["hasGarden"] is None


# ---------------------------------------------------------------------------
# Test: cache MISS within budget — triggers fetch + persists
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_cache_miss_within_budget_triggers_fetch_and_persists():
    """No cached row and budget=1 → fetch is called; result is stored in PubHours."""
    assert not PubHours.objects.filter(cache_key=_FLEKY_KEY).exists()

    mock_source = MagicMock()
    mock_source.fetch.return_value = _GOOD_RAW

    with patch("pubs.api.cache.FirmyHoursSource", return_value=mock_source):
        results = get_or_enrich([_PUB_ENTRY], sync_budget=1)

    mock_source.fetch.assert_called_once_with(
        _FLEKY_NAME, _FLEKY_LAT, _FLEKY_LNG, city=None
    )

    assert len(results) == 1
    r = results[0]
    assert r["status"] == "ok"
    assert r["opening_hours"] == _FLEKY_HOURS
    assert r["confidence"] == pytest.approx(0.95)
    assert r["rating"] == pytest.approx(4.1)
    assert r["ratingCount"] == 364
    assert r["ratingLabel"] == "Velmi dobré"
    assert r["hasGarden"] is False

    # Row must be persisted
    row = PubHours.objects.get(cache_key=_FLEKY_KEY)
    assert row.opening_hours_raw == _FLEKY_HOURS
    assert row.status == PubHours.Status.OK
    assert row.source_ref == "272313"
    assert row.rating_value == pytest.approx(4.1)
    assert row.rating_count == 364
    assert row.rating_label == "Velmi dobré"
    assert row.has_garden is False
    assert row.venue_tags == []


@pytest.mark.django_db
def test_production_firmy_source_uses_shared_database_daily_budget(settings):
    settings.FIRMY_DAILY_CAP = 1
    mock_source = MagicMock()
    mock_source.fetch.return_value = _GOOD_RAW

    with patch("pubs.api.cache.FirmyHoursSource", return_value=mock_source) as source_class:
        get_or_enrich([_PUB_ENTRY], sync_budget=1)

    budget = source_class.call_args.kwargs["request_budget"]
    assert budget(1) is True
    assert budget(1) is False
    usage = ExternalApiDailyUsage.objects.get(provider="firmy", operation="http")
    assert usage.request_count == 1


# ---------------------------------------------------------------------------
# Test: stale row within budget — returns stale data and queues refresh
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_stale_row_returns_immediately_and_queues_refresh():
    """A stale usable row is served immediately instead of blocking on Firmy.cz."""
    old_fetched = dj_tz.now() - timedelta(days=31)
    _make_fresh_row(fetched_at=old_fetched)

    with patch("pubs.api.cache.FirmyHoursSource") as mock_cls:
        results = get_or_enrich([_PUB_ENTRY], sync_budget=1)

    mock_cls.assert_not_called()
    assert results[0]["opening_hours"] == _FLEKY_HOURS
    assert results[0]["rating"] == pytest.approx(4.1)

    row = PubHours.objects.get(cache_key=_FLEKY_KEY)
    assert row.opening_hours_raw == _FLEKY_HOURS
    task = EnrichTask.objects.get(cache_key=_FLEKY_KEY)
    assert task.name == _FLEKY_NAME
    assert task.done is False


# ---------------------------------------------------------------------------
# Test: over budget → pending EnrichTask
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_over_budget_creates_pending_enrich_task():
    """When sync_budget=0, a missing pub gets an EnrichTask, not a fetch."""
    assert not PubHours.objects.filter(cache_key=_FLEKY_KEY).exists()

    with patch("pubs.api.cache.FirmyHoursSource") as mock_cls:
        results = get_or_enrich([_PUB_ENTRY], sync_budget=0)

    mock_cls.assert_not_called()

    assert len(results) == 1
    r = results[0]
    assert r["status"] == "pending"
    assert r["opening_hours"] is None
    assert r["isOpenNow"] is None
    assert r["nextChange"] is None
    assert r["rating"] is None
    assert r["ratingCount"] is None
    assert r["ratingLabel"] is None

    task = EnrichTask.objects.get(cache_key=_FLEKY_KEY)
    assert task.name == _FLEKY_NAME
    assert not task.done


@pytest.mark.django_db
def test_budget_exhausted_after_first_pub_queues_rest():
    """With budget=1 and 2 missing pubs, the second gets queued."""
    lat2, lng2 = 50.0900, 14.4300
    key2 = geohash8(lat2, lng2)
    pub2 = {"name": "Pivnice Kozlovna", "lat": lat2, "lng": lng2}

    mock_source = MagicMock()
    mock_source.fetch.return_value = _GOOD_RAW

    with patch("pubs.api.cache.FirmyHoursSource", return_value=mock_source):
        results = get_or_enrich([_PUB_ENTRY, pub2], sync_budget=1)

    assert len(results) == 2
    assert results[0]["status"] == "ok"
    assert results[1]["status"] == "pending"

    assert mock_source.fetch.call_count == 1
    assert EnrichTask.objects.filter(cache_key=key2).exists()


# ---------------------------------------------------------------------------
# Test: no-match from Firmy → unknown status
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_no_match_from_firmy_gives_unknown_status():
    """If FirmyHoursSource.fetch returns None → status unknown, no hours."""
    mock_source = MagicMock()
    mock_source.fetch.return_value = None

    with patch("pubs.api.cache.FirmyHoursSource", return_value=mock_source):
        results = get_or_enrich([_PUB_ENTRY], sync_budget=1)

    assert results[0]["status"] == "unknown"
    assert results[0]["opening_hours"] is None
    assert results[0]["rating"] is None
    assert results[0]["ratingCount"] is None
    assert results[0]["ratingLabel"] is None

    row = PubHours.objects.get(cache_key=_FLEKY_KEY)
    assert row.status == PubHours.Status.UNKNOWN
    assert row.rating_value is None
    assert row.rating_count is None
    assert row.rating_label is None


# ---------------------------------------------------------------------------
# Test: matched pub with no published hours → unknown
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_matched_pub_no_hours_gives_unknown():
    """RawHours with opening_hours_raw=None (no published hours) → status unknown."""
    no_hours_raw = RawHours(
        opening_hours_raw=None,
        source="firmy",
        source_ref="99999",
        matched_name=_FLEKY_NAME,
        matched_lat=_FLEKY_LAT,
        matched_lng=_FLEKY_LNG,
        confidence=0.85,
    )
    mock_source = MagicMock()
    mock_source.fetch.return_value = no_hours_raw

    with patch("pubs.api.cache.FirmyHoursSource", return_value=mock_source):
        results = get_or_enrich([_PUB_ENTRY], sync_budget=1)

    assert results[0]["status"] == "unknown"
    assert results[0]["opening_hours"] is None


# ---------------------------------------------------------------------------
# Test: isOpenNow computed from known hours at a fixed Prague datetime
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_is_open_now_computed_from_known_hours():
    """
    isOpenNow and nextChange are computed live from opening_hours_raw, not cached.

    U Fleků hours: Mo-Su 10:00-23:00
    We test at 12:00 Prague time on a Monday → should be open.
    We test at 08:00 Prague time on a Monday → should be closed.
    """
    _make_fresh_row()  # hours = "Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00"

    # Patch is_open_now and next_change to control the output
    from pubs.api import cache as cache_module

    # Monday 12:00 Prague → open (is_open_now is patched, so the exact value
    # is irrelevant; we only assert the hours string flows through correctly).
    with patch.object(cache_module, "is_open_now", return_value=True) as mock_ion, \
         patch.object(cache_module, "next_change", return_value=None):
        results = get_or_enrich([_PUB_ENTRY], sync_budget=3)

    assert results[0]["isOpenNow"] is True
    mock_ion.assert_called_once_with(_FLEKY_HOURS)

    # Monday 08:00 Prague → closed
    with patch.object(cache_module, "is_open_now", return_value=False), \
         patch.object(cache_module, "next_change", return_value=None):
        results = get_or_enrich([_PUB_ENTRY], sync_budget=3)

    assert results[0]["isOpenNow"] is False


# ---------------------------------------------------------------------------
# Test: nextChange is returned as ISO-8601 string
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_next_change_returned_as_iso8601_with_prague_offset():
    """nextChange is serialised verbatim to an ISO-8601 string carrying the
    Europe/Prague offset (e.g. ...+02:00), NOT UTC — the mobile chip reads the
    literal HH:MM as Prague wall-clock, so the contract must stay Prague-local."""
    _make_fresh_row()

    from pubs.api import cache as cache_module

    nc_dt = datetime(2026, 6, 8, 23, 0, 0, tzinfo=ZoneInfo("Europe/Prague"))
    with patch.object(cache_module, "is_open_now", return_value=True), \
         patch.object(cache_module, "next_change", return_value=nc_dt):
        results = get_or_enrich([_PUB_ENTRY], sync_budget=3)

    assert results[0]["nextChange"] == nc_dt.isoformat()
    # Guard the contract: the wire value carries an explicit offset, not a 'Z'.
    assert results[0]["nextChange"].endswith("+02:00")


# ---------------------------------------------------------------------------
# Test: duplicate upsert of EnrichTask is idempotent
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_enrich_task_upsert_is_idempotent():
    """Calling get_or_enrich twice for the same missing pub doesn't create duplicates."""
    with patch("pubs.api.cache.FirmyHoursSource"):
        get_or_enrich([_PUB_ENTRY], sync_budget=0)
        get_or_enrich([_PUB_ENTRY], sync_budget=0)

    assert EnrichTask.objects.filter(cache_key=_FLEKY_KEY).count() == 1


# ---------------------------------------------------------------------------
# Test: sync_budget is clamped to settings.SYNC_ENRICH_BUDGET (MEDIUM 6)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_sync_budget_clamped_to_settings(settings):
    """A client-supplied sync_budget above the server cap is clamped down.

    With SYNC_ENRICH_BUDGET=2 and a request budget of 5 over 4 missing pubs,
    only 2 synchronous fetches may happen; the rest are queued.
    """
    settings.SYNC_ENRICH_BUDGET = 2

    pubs = []
    for i in range(4):
        lat = 50.05 + i * 0.01
        lng = 14.40 + i * 0.01
        pubs.append({"name": f"Pub {i}", "lat": lat, "lng": lng})

    mock_source = MagicMock()
    mock_source.fetch.return_value = _GOOD_RAW

    with patch("pubs.api.cache.FirmyHoursSource", return_value=mock_source):
        results = get_or_enrich(pubs, sync_budget=5)

    # Only 2 sync fetches despite the client asking for 5.
    assert mock_source.fetch.call_count == 2
    statuses = [r["status"] for r in results]
    assert statuses.count("pending") == 2


# ---------------------------------------------------------------------------
# Test: sync-enriching a queued key closes its open EnrichTask (MEDIUM 7)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_sync_enrich_closes_open_enrich_task():
    """A pub queued (budget=0) then sync-enriched (budget=1) closes the task.

    Otherwise refresh_hours would later re-fetch a pub we already have fresh.
    """
    # Phase 1: budget exhausted → task queued, no fetch.
    with patch("pubs.api.cache.FirmyHoursSource"):
        get_or_enrich([_PUB_ENTRY], sync_budget=0)

    task = EnrichTask.objects.get(cache_key=_FLEKY_KEY)
    assert task.done is False

    # Phase 2: same key sync-enriched successfully.
    mock_source = MagicMock()
    mock_source.fetch.return_value = _GOOD_RAW
    with patch("pubs.api.cache.FirmyHoursSource", return_value=mock_source):
        get_or_enrich([_PUB_ENTRY], sync_budget=1)

    task.refresh_from_db()
    assert task.done is True
    # And a fresh PubHours row exists.
    assert PubHours.objects.get(cache_key=_FLEKY_KEY).status == PubHours.Status.OK


@pytest.mark.django_db
def test_sync_enrich_error_does_not_close_task():
    """A transient ERROR sync result must NOT close the task (it should retry)."""
    with patch("pubs.api.cache.FirmyHoursSource"):
        get_or_enrich([_PUB_ENTRY], sync_budget=0)

    mock_source = MagicMock()
    mock_source.fetch.side_effect = RuntimeError("daily cap exceeded")
    with patch("pubs.api.cache.FirmyHoursSource", return_value=mock_source):
        get_or_enrich([_PUB_ENTRY], sync_budget=1)

    task = EnrichTask.objects.get(cache_key=_FLEKY_KEY)
    assert task.done is False


# ---------------------------------------------------------------------------
# Test: geohash-8 collision — a different business must not get cached hours
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_geohash_collision_serves_unknown_not_wrong_hours():
    """Two DISTINCT businesses in one ~38 m geohash cell share a cache_key. The
    second must NOT be served the first's hours: it gets 'unknown', no fetch is
    triggered, and the cached row is left untouched (no flip-flop)."""
    _make_fresh_row()  # name "Restaurace U Fleků", has hours

    other = {"name": "Pizzeria Grosseto", "lat": _FLEKY_LAT, "lng": _FLEKY_LNG}
    assert geohash8(other["lat"], other["lng"]) == _FLEKY_KEY  # same cell

    with patch("pubs.api.cache.FirmyHoursSource") as mock_cls:
        results = get_or_enrich([other], sync_budget=3)

    # A name mismatch on a fresh cell must not re-fetch (would overwrite the row).
    mock_cls.assert_not_called()
    assert results[0]["status"] == "unknown"
    assert results[0]["opening_hours"] is None
    assert results[0]["name"] == "Pizzeria Grosseto"

    # The cached row for the original business is unchanged.
    row = PubHours.objects.get(cache_key=_FLEKY_KEY)
    assert row.name == _FLEKY_NAME
    assert row.opening_hours_raw == _FLEKY_HOURS


# ---------------------------------------------------------------------------
# Test: a transient fetch error is persisted as 'error' and self-heals
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_transient_fetch_error_cools_down_before_refetch(settings):
    """A transient proxy/network error (e.g. a proxy 502) is persisted as
    'error', not a sticky 'unknown'. A short retry cooldown prevents the very
    next request from spending another proxy fetch, then the row self-heals
    once the cooldown has expired."""
    from pubs.enrichment import TransientFetchError

    settings.FIRMY_ERROR_RETRY_COOLDOWN_MINUTES = 15

    failing = MagicMock()
    failing.fetch.side_effect = TransientFetchError("proxy 502 Bad Gateway")
    with patch("pubs.api.cache.FirmyHoursSource", return_value=failing):
        results = get_or_enrich([_PUB_ENTRY], sync_budget=1)

    assert results[0]["status"] == "error"
    assert results[0]["opening_hours"] is None
    row = PubHours.objects.get(cache_key=_FLEKY_KEY)
    assert row.status == PubHours.Status.ERROR

    # Next request during cooldown: return the cached error without a fetch.
    cooling_source = MagicMock()
    cooling_source.fetch.return_value = _GOOD_RAW
    with patch("pubs.api.cache.FirmyHoursSource", return_value=cooling_source):
        results2 = get_or_enrich([_PUB_ENTRY], sync_budget=1)

    cooling_source.fetch.assert_not_called()
    assert results2[0]["status"] == "error"
    assert results2[0]["opening_hours"] is None

    # After cooldown: the error row is retryable → re-fetch → succeeds → ok.
    row.fetched_at = dj_tz.now() - timedelta(minutes=16)
    row.save(update_fields=["fetched_at"])

    ok_source = MagicMock()
    ok_source.fetch.return_value = _GOOD_RAW
    with patch("pubs.api.cache.FirmyHoursSource", return_value=ok_source):
        results3 = get_or_enrich([_PUB_ENTRY], sync_budget=1)

    ok_source.fetch.assert_called_once()
    assert results3[0]["status"] == "ok"
    assert results3[0]["opening_hours"] == _FLEKY_HOURS
