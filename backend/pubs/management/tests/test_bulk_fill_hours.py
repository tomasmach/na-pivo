"""
Tests for pubs.management.commands.bulk_fill_hours.

Network policy
--------------
Neither Mapy.cz nor firmy.cz is hit live. The Mapy sweep is skipped entirely by
pre-writing the catalogue file (the command loads it when it exists), and
FirmyHoursSource is replaced by a fake. DB access via pytest-django's `db`.
"""

from __future__ import annotations

import json
from io import StringIO
from unittest.mock import MagicMock, patch

import pytest
from django.core.management import call_command
from django.utils import timezone

from pubs.enrichment.firmy import RawHours, TransientFetchError
from pubs.enrichment.matcher import geohash8
from pubs.management.commands import bulk_fill_hours as cmd
from pubs.models import PubHours

# ---------------------------------------------------------------------------
# Pure-helper unit tests (no DB, no network)
# ---------------------------------------------------------------------------


class TestGeoHelpers:
    def test_bbox_from_center_brackets_the_point(self):
        lon_min, lat_min, lon_max, lat_max = cmd._bbox_from_center(50.0, 14.0, 10)
        assert lon_min < 14.0 < lon_max
        assert lat_min < 50.0 < lat_max

    def test_grid_centers_cover_bbox(self):
        bbox = cmd._bbox_from_center(50.0, 14.0, 10)
        centers = cmd._grid_centers(bbox, cell_km=5)
        assert len(centers) >= 4  # a 20km-ish box at 5km cells tiles to a few
        # every centre lies inside the bbox
        lon_min, lat_min, lon_max, lat_max = bbox
        for lat, lng in centers:
            assert lat_min <= lat <= lat_max
            assert lon_min <= lng <= lon_max

    def test_municipality_prefers_municipality_type(self):
        item = {"regionalStructure": [
            {"name": "Staré Město", "type": "regional.region"},
            {"name": "Praha", "type": "regional.municipality"},
        ]}
        assert cmd._municipality(item) == "Praha"

    def test_municipality_falls_back_to_any_name(self):
        item = {"regionalStructure": [{"name": "Brno", "type": "regional.region"}]}
        assert cmd._municipality(item) == "Brno"

    def test_municipality_none_when_empty(self):
        assert cmd._municipality({}) is None

    def test_czech_border_polygon_filters_foreign_points(self):
        assert cmd._is_in_czechia(50.0755, 14.4378)  # Prague
        assert not cmd._is_in_czechia(49.9481, 11.5783)  # Bavaria


# ---------------------------------------------------------------------------
# Behavioural tests (DB + mocked FirmyHoursSource, catalogue from file)
# ---------------------------------------------------------------------------

_CATALOGUE = [
    {"name": "Pub A", "lat": 50.0800, "lng": 14.4200, "city": "Praha"},
    {"name": "Pub B", "lat": 50.0900, "lng": 14.4300, "city": "Praha"},
    {"name": "Pub C", "lat": 50.1000, "lng": 14.4400, "city": "Praha"},
]


def _good(name: str, lat: float, lng: float) -> RawHours:
    return RawHours(
        opening_hours_raw="Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00",
        source="firmy", source_ref="1", matched_name=name,
        matched_lat=lat, matched_lng=lng, confidence=0.95,
        rating_value=4.2, rating_count=10, rating_label="Velmi dobré",
    )


class _FakeSource:
    """Stand-in for FirmyHoursSource that records calls and replays a script."""

    def __init__(self, behaviour="ok", **_kwargs):
        self._behaviour = behaviour
        self._owns_session = True
        self._session = MagicMock()
        self.fetched: list[str] = []

    def fetch(self, name, lat, lng, city=None):
        self.fetched.append(name)
        if self._behaviour == "ban":
            raise TransientFetchError("bounced to consent wall")
        return _good(name, lat, lng)


def _write_catalogue(path, catalogue=_CATALOGUE):
    path.write_text(json.dumps(catalogue, ensure_ascii=False))


def _run(catalogue_path, **opts) -> str:
    out = StringIO()
    call_command(
        "bulk_fill_hours",
        catalogue=str(catalogue_path),
        throttle=0.0,            # no real sleeping in tests
        stdout=out,
        stderr=StringIO(),
        **opts,
    )
    return out.getvalue()


@pytest.mark.django_db
def test_full_fill_persists_all_rows(tmp_path):
    cat = tmp_path / "cat.json"
    _write_catalogue(cat)
    fake = _FakeSource(behaviour="ok")

    with patch.object(cmd, "FirmyHoursSource", return_value=fake):
        _run(cat, remaining_out=str(tmp_path / "rem.json"))

    assert PubHours.objects.count() == 3
    assert set(fake.fetched) == {"Pub A", "Pub B", "Pub C"}
    a = PubHours.objects.get(cache_key=geohash8(50.08, 14.42))
    assert a.status == PubHours.Status.OK
    assert a.rating_value == pytest.approx(4.2)


@pytest.mark.django_db
def test_catalogue_only_keeps_catalogue_and_skips_fill(tmp_path):
    cat = tmp_path / "cat.json"
    _write_catalogue(cat)
    fake = _FakeSource(behaviour="ok")

    with patch.object(cmd, "FirmyHoursSource", return_value=fake) as source_cls:
        out = _run(
            cat,
            remaining_out=str(tmp_path / "rem.json"),
            catalogue_only=True,
        )

    assert json.loads(cat.read_text()) == _CATALOGUE
    source_cls.assert_not_called()
    assert fake.fetched == []
    assert PubHours.objects.count() == 0
    assert "Catalogue-only: 3 unique pubs; fill phase skipped." in out


@pytest.mark.django_db
def test_resume_skips_already_fresh_rows(tmp_path):
    cat = tmp_path / "cat.json"
    _write_catalogue(cat)
    # Pre-seed Pub A as a fresh row → it must be skipped on resume.
    PubHours.objects.create(
        cache_key=geohash8(50.0800, 14.4200), name="Pub A",
        lat=50.0800, lng=14.4200, opening_hours_raw="Mo-Su 10:00-22:00",
        source="firmy", status=PubHours.Status.OK, fetched_at=timezone.now(),
    )
    fake = _FakeSource(behaviour="ok")

    with patch.object(cmd, "FirmyHoursSource", return_value=fake):
        out = _run(cat, remaining_out=str(tmp_path / "rem.json"))

    assert "Pub A" not in fake.fetched
    assert set(fake.fetched) == {"Pub B", "Pub C"}
    assert "1 already fresh, 2 to fill" in out


@pytest.mark.django_db
def test_ban_aborts_and_dumps_remaining(tmp_path):
    cat = tmp_path / "cat.json"
    _write_catalogue(cat)
    rem = tmp_path / "rem.json"
    fake = _FakeSource(behaviour="ban")

    with patch.object(cmd, "FirmyHoursSource", return_value=fake):
        out = _run(cat, remaining_out=str(rem), ban_threshold=2)

    # Aborted before persisting anything; remaining pubs dumped for Apify.
    assert PubHours.objects.count() == 0
    assert rem.exists()
    dumped = json.loads(rem.read_text())
    assert len(dumped) >= 1
    assert {"name", "lat", "lng", "city"} <= set(dumped[0].keys())
    assert "Aborting" in out


@pytest.mark.django_db
def test_limit_caps_and_dumps_remaining(tmp_path):
    cat = tmp_path / "cat.json"
    _write_catalogue(cat)
    rem = tmp_path / "rem.json"
    fake = _FakeSource(behaviour="ok")

    with patch.object(cmd, "FirmyHoursSource", return_value=fake):
        _run(cat, remaining_out=str(rem), limit=2)

    assert PubHours.objects.count() == 2
    assert len(fake.fetched) == 2
    assert json.loads(rem.read_text())  # the 3rd pub was dumped


@pytest.mark.django_db
def test_cz_only_skips_foreign_catalogue_pubs(tmp_path):
    cat = tmp_path / "cat.json"
    catalogue = [
        {"name": "Czech Pub", "lat": 50.0800, "lng": 14.4200, "city": "Praha"},
        {"name": "Bavarian Pub", "lat": 49.9481, "lng": 11.5783, "city": "Bayreuth"},
    ]
    _write_catalogue(cat, catalogue)
    fake = _FakeSource(behaviour="ok")

    with patch.object(cmd, "FirmyHoursSource", return_value=fake):
        out = _run(cat, remaining_out=str(tmp_path / "rem.json"), cz_only=True)

    assert fake.fetched == ["Czech Pub"]
    assert PubHours.objects.count() == 1
    assert "CZ-only: skipped 1 pub(s) outside CZ." in out


@pytest.mark.django_db
def test_fresh_keys_chunks_past_sqlite_variable_cap():
    """Resuming a whole-CR catalogue passes ~53k keys to ``_fresh_keys``. The
    ``cache_key__in`` lookup must be chunked, or SQLite raises 'too many SQL
    variables' (the variable cap is 32766). Regression for that crash.
    """
    fresh_key = geohash8(50.08, 14.42)
    PubHours.objects.create(
        cache_key=fresh_key, name="Pub A", lat=50.08, lng=14.42,
        opening_hours_raw="Mo-Su 10:00-22:00",
        source="firmy", status=PubHours.Status.OK, fetched_at=timezone.now(),
    )
    # One real fresh key plus >32766 misses, all in a single call.
    keys = [fresh_key] + [f"k{i:08d}" for i in range(40_000)]

    result = cmd.Command()._fresh_keys(keys, ttl_days=14)

    assert result == {fresh_key}
