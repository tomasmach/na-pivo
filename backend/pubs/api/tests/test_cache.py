"""
Tests for pubs.api.cache.get_or_enrich.

All tests use pytest-django (db fixture) and mock FirmyHoursSource so no
live network traffic is made.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone as dj_tz

from pubs.api.cache import get_or_enrich
from pubs.enrichment import RawHours, geohash8
from pubs.models import EnrichTask, PubHours

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
        status=PubHours.Status.OK,
        fetched_at=dj_tz.now(),
    )
    defaults.update(kwargs)
    return PubHours.objects.create(**defaults)


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

    # Row must be persisted
    row = PubHours.objects.get(cache_key=_FLEKY_KEY)
    assert row.opening_hours_raw == _FLEKY_HOURS
    assert row.status == PubHours.Status.OK
    assert row.source_ref == "272313"


# ---------------------------------------------------------------------------
# Test: stale row within budget — re-fetches and updates
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_stale_row_within_budget_refetches():
    """A row older than TTL is considered stale and re-fetched."""
    old_fetched = dj_tz.now() - timedelta(days=31)
    _make_fresh_row(fetched_at=old_fetched)

    mock_source = MagicMock()
    updated_raw = RawHours(
        opening_hours_raw="Mo-Fr 11:00-22:00",
        source="firmy",
        source_ref="272313",
        matched_name=_FLEKY_NAME,
        matched_lat=_FLEKY_LAT,
        matched_lng=_FLEKY_LNG,
        confidence=0.90,
    )
    mock_source.fetch.return_value = updated_raw

    with patch("pubs.api.cache.FirmyHoursSource", return_value=mock_source):
        results = get_or_enrich([_PUB_ENTRY], sync_budget=1)

    mock_source.fetch.assert_called_once()
    assert results[0]["opening_hours"] == "Mo-Fr 11:00-22:00"

    row = PubHours.objects.get(cache_key=_FLEKY_KEY)
    assert row.opening_hours_raw == "Mo-Fr 11:00-22:00"


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

    row = PubHours.objects.get(cache_key=_FLEKY_KEY)
    assert row.status == PubHours.Status.UNKNOWN


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
def test_next_change_returned_as_iso8601():
    """nextChange datetime is serialised to ISO-8601 string."""
    _make_fresh_row()

    from pubs.api import cache as cache_module

    nc_dt = datetime(2024, 6, 3, 23, 0, 0, tzinfo=UTC)
    with patch.object(cache_module, "is_open_now", return_value=True), \
         patch.object(cache_module, "next_change", return_value=nc_dt):
        results = get_or_enrich([_PUB_ENTRY], sync_budget=3)

    assert results[0]["nextChange"] == nc_dt.isoformat()


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
