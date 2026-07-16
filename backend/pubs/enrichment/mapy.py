"""
pubs.enrichment.mapy — server-side Mapy.com add-pub location lookup.

WHY THIS EXISTS
---------------
The mobile app must not ship a public Mapy key. Add-pub autocomplete and
geocoding therefore go through this backend client. GET /v1/pubs/near is served
from the imported directory and legacy seed rows and never instantiates this
client for nearby discovery.

It deliberately does NOT port the client's name heuristics / blocklist: the
mobile client still feeds the raw suggest items into its existing filtering
pipeline, so this module only fetches + lightly trims items. The one piece of
the client logic it does mirror is the "break as soon as a usable pub appeared"
behaviour of the progressive bbox widening — approximated here by checking
ALLOWED_LABELS (the client breaks once it has accepted >=1 item, and an accepted
item always has an allowed label).

Legacy nearby import strategy
-----------------------------
``search_near`` is retained only for offline tooling/tests around the historical
import shape. Runtime API views do not call it.

* 4 query terms ("hospoda", "bar", "pivnice", "pivovar").
* Progressive bbox widening over steps [5, 15, 50, 100] km filtered to the
  steps strictly below the requested radius, plus the radius itself (consecutive
  duplicates removed).
* For each step: run the 4 term queries, merge items, dedupe by (lat, lon)
  rounded to 5 decimals, and BREAK as soon as any merged item carries a label in
  ALLOWED_LABELS.
* Partial success is OK: a step succeeds if ANY of its 4 queries succeeded
  (mirror of the client's `anyRequestSucceeded`). Only if ALL queries in a step
  fail (and none in earlier steps succeeded) do we raise.

A process-wide daily request cap (MAPY_DAILY_CAP) counts INDIVIDUAL HTTP
requests, exactly like FirmyHoursSource. On exceed the cap raises RuntimeError
so the view can serve stale cache or 503.
"""

from __future__ import annotations

import logging
import math
import unicodedata
from dataclasses import dataclass, field

import requests

from ._daily_counter import DailyCounter

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants (ported from src/data/mapyClient.ts)
# ---------------------------------------------------------------------------

_SUGGEST_URL = "https://api.mapy.cz/v1/suggest"
_GEOCODE_URL = "https://api.mapy.cz/v1/geocode"
# The Mapy.cz API key is restricted in the developer portal to an allow-list of
# User-Agents — it returns 403 for anything other than this exact value (even a
# browser UA is rejected). The mobile client (src/data/mapyClient.ts) sends the
# same string, and this proxy reuses the same key, so it must match. To run the
# backend under its own UA, add it to the key's allowed-User-Agents list in the
# Mapy.com portal first, then change this constant.
_USER_AGENT = "napivo-ios/1.0"

QUERY_TERMS = ["hospoda", "bar", "pivnice", "pivovar"]
MAX_RESULTS_PER_QUERY = 15  # Mapy.cz API limit.
SUGGEST_BBOX_STEPS_KM = (5, 15, 50, 100)

# Mapy.cz returns mixed categories under our text queries. These are the labels
# that mark a place where you can actually drink a beer; the presence of any one
# of them in a step's merged items is our "a usable pub appeared" break signal
# (it mirrors the client accepting >=1 item before breaking). 'Vinárna' (wine
# bar) is intentionally absent — wine bars do not pour beer.
ALLOWED_LABELS = {
    "Hospoda",
    "Bar",
    "Pivovar",
    "Pivnice",
    "Restaurace a pohostinství",
    "Klub",
}

TRUSTED_PUB_LABELS = {"Hospoda", "Pivnice", "Pivovar"}

POSITIVE_NAME_KEYWORDS = (
    "hospoda",
    "hospudka",
    "hostinec",
    "pivnice",
    "pivovar",
    "pivni",
    "pivo",
    "pivoteka",
    "vycep",
    "senk",
    "tankovna",
    "nalevarna",
    "lokal",
    "pub",
    "beer",
)

# Per-request HTTP timeout (seconds).
_DEFAULT_TIMEOUT = 10


# ---------------------------------------------------------------------------
# Public exceptions / dataclass
# ---------------------------------------------------------------------------


class MapyDailyCapExceededError(RuntimeError):
    """Raised when the process-wide daily Mapy.cz request cap is exhausted."""


class MapyAllQueriesFailedError(RuntimeError):
    """Raised when every suggest query in every attempted step failed.

    Mirrors the mobile client's "All Mapy.cz suggest queries failed" error: a
    genuine fetch failure (network / HTTP) that the view turns into a stale-cache
    fallback or a 503.
    """


@dataclass
class MapySuggestResult:
    """Result of a near-pubs search.

    ``items`` is a list of TRIMMED raw Mapy suggest items, each shaped exactly
    like the client expects:
        {"name": str, "label": str,
         "position": {"lat": float, "lon": float},
         "regionalStructure": [{"name": str, "type": str}, ...]}
    ``regionalStructure`` is omitted when absent on the source item.
    """

    items: list[dict] = field(default_factory=list)


# ---------------------------------------------------------------------------
# bbox math (mirror of mapyClient.ts buildPreferBBox + buildSuggestRadiusSteps)
# ---------------------------------------------------------------------------


def build_prefer_bbox(lat: float, lng: float, km_radius: float) -> str:
    """Return "lonMin,latMin,lonMax,latMax" for Mapy preferBBox.

    Approximation (same as the client and views._haversine_km style):
    1° lat ≈ 111 km; 1° lng ≈ 111 km * cos(lat).
    """
    d_lat = km_radius / 111.0
    d_lng = km_radius / (111.0 * math.cos(math.radians(lat)))
    return f"{lng - d_lng},{lat - d_lat},{lng + d_lng},{lat + d_lat}"


def build_suggest_radius_steps(km_radius: float) -> list[float]:
    """Steps strictly below the radius, plus the radius itself; dedup consecutive."""
    steps = [step for step in SUGGEST_BBOX_STEPS_KM if step < km_radius]
    combined = [*steps, km_radius]
    return [
        step
        for index, step in enumerate(combined)
        if index == 0 or step != combined[index - 1]
    ]


# ---------------------------------------------------------------------------
# Item trimming
# ---------------------------------------------------------------------------


def _trim_item(item: dict) -> dict | None:
    """Trim a raw Mapy suggest item to the wire shape the client consumes.

    Keeps name, label, position{lat,lon}, and regionalStructure (each entry
    trimmed to name+type). Returns None for an item missing name or a usable
    position (the client itemToPub also drops those).
    """
    name = item.get("name")
    position = item.get("position") or {}
    lat = position.get("lat")
    lon = position.get("lon")
    if not name or lat is None or lon is None:
        return None

    trimmed: dict = {
        "name": name,
        "label": item.get("label") or "",
        "position": {"lat": lat, "lon": lon},
    }

    rs = item.get("regionalStructure")
    if isinstance(rs, list):
        trimmed["regionalStructure"] = [
            {"name": entry.get("name"), "type": entry.get("type")}
            for entry in rs
            if isinstance(entry, dict)
        ]

    return trimmed


def _trim_location_item(item: dict) -> dict | None:
    trimmed = _trim_item(item)
    if trimmed is None:
        return None
    item_type = item.get("type")
    if isinstance(item_type, str) and item_type:
        trimmed["type"] = item_type
    location = item.get("location")
    if isinstance(location, str) and location:
        trimmed["location"] = location
    return trimmed


def _dedupe_key(item: dict) -> str:
    """Name + (lat, lon) rounded to 5 decimals.

    Mapy can return distinct businesses at the same mapped point (for example a
    restaurant and the beer venue inside/next to it). Coordinate-only dedupe
    silently dropped one of them before the client could choose the better pub
    candidate.
    """
    pos = item["position"]
    name = (item.get("name") or "").strip().casefold()
    return f"{round(pos['lat'], 5)},{round(pos['lon'], 5)}|{name}"


def _normalize_for_match(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value.lower())
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def _tokenize_name(value: str) -> list[str]:
    token = []
    tokens = []
    for ch in _normalize_for_match(value):
        if ch.isalnum():
            token.append(ch)
        elif token:
            tokens.append("".join(token))
            token = []
    if token:
        tokens.append("".join(token))
    return tokens


def _pub_signal_priority(item: dict) -> int:
    """Higher value means old coordinate-deduping clients should see it first."""
    tokens = _tokenize_name(item.get("name") or "")
    if any(any(token.startswith(keyword) for token in tokens) for keyword in POSITIVE_NAME_KEYWORDS):
        return 3
    if item.get("label") in TRUSTED_PUB_LABELS:
        return 2
    if item.get("label") in ALLOWED_LABELS:
        return 1
    return 0


# ---------------------------------------------------------------------------
# Daily-cap counter (process-wide, resets at midnight UTC) — shared DailyCounter
# ---------------------------------------------------------------------------

_global_counter = DailyCounter()


# ---------------------------------------------------------------------------
# MapySuggestSource
# ---------------------------------------------------------------------------


class MapySuggestSource:
    """
    Fetch Mapy.com suggestions/geocodes for adding a missing pub.

    Parameters
    ----------
    api_key : str
        Mapy.cz API key (settings.MAPY_API_KEY). Required.
    session : requests.Session | None
        Supply a pre-configured session (e.g. in tests with a mocked adapter).
        If None, a plain session with a fixed User-Agent is created.
    timeout : int
        Per-request HTTP timeout in seconds.
    daily_cap : int
        Hard cap on the number of lookup HTTP requests per UTC calendar day,
        counted across the whole process.
    """

    def __init__(
        self,
        api_key: str,
        session: requests.Session | None = None,
        timeout: int = _DEFAULT_TIMEOUT,
        daily_cap: int = 5000,
    ) -> None:
        self._api_key = api_key
        self._timeout = timeout
        self._daily_cap = daily_cap

        if session is not None:
            self._session = session
            self._owns_session = False
        else:
            self._session = requests.Session()
            self._session.headers.update({"User-Agent": _USER_AGENT})
            self._owns_session = True

    # ------------------------------------------------------------------
    # Single query (mirror of mapyClient.ts suggestQuery)
    # ------------------------------------------------------------------

    def _check_cap(self) -> None:
        if not _global_counter.increment_and_check(self._daily_cap):
            raise MapyDailyCapExceededError(
                f"mapy: daily request cap of {self._daily_cap} exceeded — "
                "not making further requests today."
            )

    def _get_items(self, url: str, params, log_label: str) -> list[dict]:
        """GET *url* and return its raw ``items``.

        Cap-checked, and retries ONCE on a 429/5xx (the only retryable statuses)
        before giving up. Non-429 4xx responses are user-recoverable lookup misses
        and return an empty list. ``log_label`` identifies the request in the retry
        warning.
        """
        self._check_cap()
        resp = self._session.get(url, params=params, timeout=self._timeout)
        if resp.status_code == 429 or resp.status_code >= 500:
            logger.warning(
                "mapy: %s returned retryable HTTP %d — retrying once",
                log_label,
                resp.status_code,
            )
            # The retried request also counts against the daily cap.
            self._check_cap()
            resp = self._session.get(url, params=params, timeout=self._timeout)
        try:
            resp.raise_for_status()
        except requests.HTTPError:
            if 400 <= resp.status_code < 500 and resp.status_code != 429:
                logger.info(
                    "mapy: %s returned non-retryable HTTP %d — treating as no results",
                    log_label,
                    resp.status_code,
                )
                return []
            raise
        data = resp.json()
        return data.get("items") or []

    def _suggest_query(self, query: str, prefer_bbox: str) -> list[dict]:
        """Run one suggest query; return its raw items. Raises on HTTP/network error."""
        params = {
            "query": query,
            "lang": "cs",
            "limit": str(MAX_RESULTS_PER_QUERY),
            "preferBBox": prefer_bbox,
            "apikey": self._api_key,
        }
        return self._get_items(_SUGGEST_URL, params, f"query {query!r}")

    def _items_query(self, url: str, params: list[tuple[str, str]]) -> list[dict]:
        return self._get_items(url, params, "lookup")

    # ------------------------------------------------------------------
    # Public API (mirror of mapyClient.ts searchPubsNear)
    # ------------------------------------------------------------------

    def search_near(self, lat: float, lng: float, km_radius: float) -> MapySuggestResult:
        """
        Return trimmed Mapy suggest items near (lat, lng) within km_radius.

        Raises
        ------
        MapyDailyCapExceededError
            The process-wide daily request cap was hit.
        MapyAllQueriesFailedError
            Every query in every attempted step failed (no request succeeded).
        """
        seen: set[str] = set()
        merged: list[dict] = []
        any_request_succeeded = False

        for bbox_radius_km in build_suggest_radius_steps(km_radius):
            prefer_bbox = build_prefer_bbox(lat, lng, bbox_radius_km)

            step_items: list[dict] = []
            for term in QUERY_TERMS:
                try:
                    raw_items = self._suggest_query(term, prefer_bbox)
                except MapyDailyCapExceededError:
                    # Hard stop — propagate so the view can serve stale / 503.
                    raise
                except (requests.RequestException, ValueError) as exc:
                    # ValueError covers a non-JSON body (resp.json()). Partial
                    # success is fine — log and keep going (mirror Promise.allSettled).
                    logger.warning("mapy: query %r failed: %s", term, exc)
                    continue
                any_request_succeeded = True
                step_items.extend(raw_items)

            for raw in step_items:
                trimmed = _trim_item(raw)
                if trimmed is None:
                    continue
                key = _dedupe_key(trimmed)
                if key in seen:
                    continue
                seen.add(key)
                merged.append(trimmed)

            # Break as soon as any usable pub appeared — mirrors the client's
            # "if (pubs.length > 0) break" (an accepted pub always has an allowed
            # label). We don't port the name heuristics; the client re-filters.
            if any(item["label"] in ALLOWED_LABELS for item in merged):
                break

        if not any_request_succeeded:
            raise MapyAllQueriesFailedError("All Mapy.cz suggest queries failed")

        # Older mobile builds dedupe by coordinate and keep the first item. Put
        # stronger pub-like names first so a colocated generic venue does not
        # hide "Lokál", "Pivovar", etc.
        merged.sort(key=lambda item: _pub_signal_priority(item), reverse=True)
        return MapySuggestResult(items=merged)

    def suggest_locations(
        self,
        query: str,
        *,
        lat: float | None = None,
        lng: float | None = None,
        limit: int = 8,
    ) -> MapySuggestResult:
        """Return trimmed POI suggestions for a user-typed pub name."""
        params = [
            ("query", query),
            ("lang", "cs"),
            ("limit", str(max(1, min(limit, MAX_RESULTS_PER_QUERY)))),
            ("type", "poi"),
            ("locality", "cz,sk"),
            ("apikey", self._api_key),
        ]
        if lat is not None and lng is not None:
            params.extend(
                [
                    ("preferNear", f"{lng},{lat}"),
                    ("preferNearPrecision", "2500"),
                ]
            )

        raw_items = self._items_query(_SUGGEST_URL, params)
        items = [item for raw in raw_items if (item := _trim_location_item(raw)) is not None]
        return MapySuggestResult(items=items)

    def geocode_location(
        self,
        query: str,
        *,
        lat: float | None = None,
        lng: float | None = None,
        limit: int = 3,
    ) -> MapySuggestResult:
        """Return trimmed geocode matches for a full name/address query."""
        params = [
            ("query", query),
            ("lang", "cs"),
            ("limit", str(max(1, min(limit, MAX_RESULTS_PER_QUERY)))),
            ("type", "poi"),
            ("type", "regional.address"),
            ("locality", "cz,sk"),
            ("apikey", self._api_key),
        ]
        if lat is not None and lng is not None:
            params.extend(
                [
                    ("preferNear", f"{lng},{lat}"),
                    ("preferNearPrecision", "2500"),
                ]
            )

        raw_items = self._items_query(_GEOCODE_URL, params)
        items = [item for raw in raw_items if (item := _trim_location_item(raw)) is not None]
        return MapySuggestResult(items=items)

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------

    def __enter__(self) -> MapySuggestSource:
        return self

    def __exit__(self, *_: object) -> None:
        if self._owns_session:
            self._session.close()
