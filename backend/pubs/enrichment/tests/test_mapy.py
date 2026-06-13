"""
Tests for pubs.enrichment.mapy (the server-side Mapy.cz suggest proxy).

Network policy
--------------
The test suite NEVER hits the live network. All HTTP is replaced by a mock
adapter (same pattern as test_firmy.py) that dispatches by query term.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable

import pytest
import requests
from requests.adapters import HTTPAdapter
from requests.models import Response

from pubs.enrichment import mapy as mapy_mod
from pubs.enrichment.mapy import (
    ALLOWED_LABELS,
    MapyAllQueriesFailedError,
    MapyDailyCapExceededError,
    MapySuggestSource,
    build_prefer_bbox,
    build_suggest_radius_steps,
)

# ---------------------------------------------------------------------------
# Helpers: fake Response + mock adapter
# ---------------------------------------------------------------------------


def _make_response(payload: dict | str, status_code: int = 200) -> Response:
    resp = Response()
    resp.status_code = status_code
    resp.headers["Content-Type"] = "application/json"
    body = payload if isinstance(payload, str) else json.dumps(payload)
    resp._content = body.encode("utf-8")
    resp.url = "https://api.mapy.cz/v1/suggest"
    resp.encoding = "utf-8"
    return resp


def _item(name: str, label: str, lat: float, lon: float, rs: list | None = None) -> dict:
    item = {"name": name, "label": label, "position": {"lat": lat, "lon": lon}}
    if rs is not None:
        item["regionalStructure"] = rs
    return item


class _MockAdapter(HTTPAdapter):
    """Dispatch requests to a handler keyed by the ``query`` param value."""

    def __init__(self, handler: Callable[[requests.PreparedRequest], Response]) -> None:
        super().__init__()
        self._handler = handler

    def send(self, request: requests.PreparedRequest, **kwargs) -> Response:  # type: ignore[override]
        return self._handler(request)


def _query_of(request: requests.PreparedRequest) -> str:
    m = re.search(r"[?&]query=([^&]+)", request.url or "")
    return m.group(1) if m else ""


def _make_source(handler: Callable, daily_cap: int = 5000) -> MapySuggestSource:
    session = requests.Session()
    adapter = _MockAdapter(handler)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return MapySuggestSource(api_key="test-key", session=session, daily_cap=daily_cap)


@pytest.fixture(autouse=True)
def _reset_counter():
    """Reset the process-wide daily counter between tests."""
    mapy_mod._global_counter._day = None
    mapy_mod._global_counter._count = 0
    yield
    mapy_mod._global_counter._day = None
    mapy_mod._global_counter._count = 0


# ---------------------------------------------------------------------------
# bbox / steps math
# ---------------------------------------------------------------------------


def test_build_suggest_radius_steps():
    assert build_suggest_radius_steps(25) == [5, 15, 25]
    assert build_suggest_radius_steps(5) == [5]
    assert build_suggest_radius_steps(100) == [5, 15, 50, 100]
    # A radius equal to a step is not duplicated.
    assert build_suggest_radius_steps(15) == [5, 15]
    assert build_suggest_radius_steps(3) == [3]


def test_build_prefer_bbox_format():
    bbox = build_prefer_bbox(50.0, 14.0, 5)
    parts = bbox.split(",")
    assert len(parts) == 4
    lon_min, lat_min, lon_max, lat_max = (float(p) for p in parts)
    assert lon_min < 14.0 < lon_max
    assert lat_min < 50.0 < lat_max


# ---------------------------------------------------------------------------
# search_near — happy path + trimming + dedupe + break
# ---------------------------------------------------------------------------


def test_search_returns_trimmed_items():
    def handler(req):
        return _make_response(
            {
                "items": [
                    _item(
                        "Hospoda U Test",
                        "Hospoda",
                        50.01,
                        14.01,
                        rs=[
                            {"name": "Praha", "type": "regional.municipality", "extra": "drop"},
                        ],
                    ),
                ]
            }
        )

    src = _make_source(handler)
    result = src.search_near(50.0, 14.0, 5)

    assert len(result.items) == 1
    item = result.items[0]
    # Only the allowed keys survive.
    assert set(item.keys()) == {"name", "label", "position", "regionalStructure"}
    assert item["name"] == "Hospoda U Test"
    assert item["label"] == "Hospoda"
    assert item["position"] == {"lat": 50.01, "lon": 14.01}
    # regionalStructure entries trimmed to name+type only.
    assert item["regionalStructure"] == [{"name": "Praha", "type": "regional.municipality"}]


def test_item_without_regional_structure_omits_key():
    def handler(req):
        return _make_response({"items": [_item("Bar X", "Bar", 50.0, 14.0)]})

    src = _make_source(handler)
    result = src.search_near(50.0, 14.0, 5)
    assert "regionalStructure" not in result.items[0]


def test_item_missing_position_is_dropped():
    def handler(req):
        return _make_response(
            {"items": [{"name": "No Pos", "label": "Bar"}, _item("Ok", "Bar", 50.0, 14.0)]}
        )

    src = _make_source(handler)
    result = src.search_near(50.0, 14.0, 5)
    names = [i["name"] for i in result.items]
    assert names == ["Ok"]


def test_dedupe_by_rounded_position():
    # Same business from multiple term queries collapses to one.
    def handler(req):
        return _make_response(
            {
                "items": [
                    _item("A", "Hospoda", 50.000001, 14.000001),
                    _item("A", "Hospoda", 50.000002, 14.000002),
                ]
            }
        )

    src = _make_source(handler)
    result = src.search_near(50.0, 14.0, 5)
    assert len(result.items) == 1


def test_distinct_names_at_same_position_are_preserved():
    """Do not drop a pub just because Mapy pins it to another venue's point."""

    def handler(req):
        return _make_response(
            {
                "items": [
                    _item("Terminál Karlín", "Restaurace a pohostinství", 50.0, 14.0),
                    _item("Lokál Hamburk", "Restaurace a pohostinství", 50.0, 14.0),
                ]
            }
        )

    src = _make_source(handler)
    result = src.search_near(50.0, 14.0, 5)
    assert [item["name"] for item in result.items] == ["Lokál Hamburk", "Terminál Karlín"]


def test_breaks_on_first_step_when_allowed_label_present():
    """A usable pub at the first (5 km) step stops the widening — only 4 queries."""
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        return _make_response({"items": [_item("Hospoda", "Hospoda", 50.0, 14.0)]})

    src = _make_source(handler)
    result = src.search_near(50.0, 14.0, 50)  # steps would be [5, 15, 50]
    assert len(result.items) == 1
    # Only the first step's 4 term queries ran (break after step 1).
    assert calls["n"] == len(mapy_mod.QUERY_TERMS)


def test_widens_when_no_allowed_label_until_radius():
    """No allowed-label item anywhere → all steps are queried."""
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        # 'Kavárna' is not in ALLOWED_LABELS, so it never triggers the break.
        return _make_response({"items": [_item("Kavárna", "Kavárna", 50.0, 14.0)]})

    src = _make_source(handler)
    result = src.search_near(50.0, 14.0, 25)  # steps [5, 15, 25] → 3 steps
    assert all(i["label"] not in ALLOWED_LABELS for i in result.items)
    assert calls["n"] == 3 * len(mapy_mod.QUERY_TERMS)


# ---------------------------------------------------------------------------
# Partial success / all-fail
# ---------------------------------------------------------------------------


def test_partial_failure_is_ok():
    """If some term queries fail but >=1 succeeds, the step still yields items."""

    def handler(req):
        term = _query_of(req)
        if term == "hospoda":
            return _make_response({"items": [_item("Hospoda", "Hospoda", 50.0, 14.0)]})
        # Other terms 500 (and retry-500), exhausting their one retry.
        return _make_response("err", status_code=500)

    src = _make_source(handler)
    result = src.search_near(50.0, 14.0, 5)
    assert len(result.items) == 1


def test_all_queries_fail_raises():
    def handler(req):
        raise requests.exceptions.ConnectionError("network down")

    src = _make_source(handler)
    with pytest.raises(MapyAllQueriesFailedError):
        src.search_near(50.0, 14.0, 5)


def test_retry_once_on_500_then_success():
    """A 500 is retried once; a subsequent 200 yields items."""
    state = {"hits": 0}

    def handler(req):
        state["hits"] += 1
        if state["hits"] == 1:
            return _make_response("err", status_code=500)
        return _make_response({"items": [_item("Hospoda", "Hospoda", 50.0, 14.0)]})

    src = _make_source(handler)
    result = src.search_near(50.0, 14.0, 5)
    assert len(result.items) == 1


# ---------------------------------------------------------------------------
# Daily cap
# ---------------------------------------------------------------------------


def test_daily_cap_exceeded_raises():
    def handler(req):
        return _make_response({"items": []})

    src = _make_source(handler, daily_cap=0)  # cap of 0 → first request refused
    with pytest.raises(MapyDailyCapExceededError):
        src.search_near(50.0, 14.0, 5)


def test_daily_cap_counts_individual_requests():
    def handler(req):
        # No allowed labels → would widen, but cap stops it.
        return _make_response({"items": [_item("Kavárna", "Kavárna", 50.0, 14.0)]})

    # Cap of 4 → exactly the first step's 4 term queries are allowed; the 5th
    # (first query of the 15 km step) trips the cap.
    src = _make_source(handler, daily_cap=4)
    with pytest.raises(MapyDailyCapExceededError):
        src.search_near(50.0, 14.0, 25)
    assert mapy_mod._global_counter.current() == 4
