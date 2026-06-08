"""
Tests for pubs.enrichment.firmy.

Network policy
--------------
The test suite NEVER hits the live network.  The U Fleků fixture HTML is
loaded from tests/fixtures/firmy_ufleku.html (fetched once and committed).
All HTTP calls are replaced by a mock adapter (MockFirmyAdapter) that
returns either the saved fixture or synthetic HTML.
"""

from __future__ import annotations

import json
import pathlib
import re
from collections.abc import Callable
from unittest.mock import patch

import pytest
import requests
from requests.adapters import HTTPAdapter
from requests.models import Response

from pubs.enrichment.firmy import _DETAIL_RE, FirmyHoursSource, RawHours

# ---------------------------------------------------------------------------
# Fixture paths
# ---------------------------------------------------------------------------

FIXTURES_DIR = pathlib.Path(__file__).parent / "fixtures"
UFLEKU_HTML = (FIXTURES_DIR / "firmy_ufleku.html").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Helper: build a fake Response
# ---------------------------------------------------------------------------

def _make_response(html: str, status_code: int = 200, url: str = "https://www.firmy.cz/") -> Response:
    resp = Response()
    resp.status_code = status_code
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    resp._content = html.encode("utf-8")
    resp.url = url
    resp.encoding = "utf-8"
    return resp


# ---------------------------------------------------------------------------
# Minimal search-page HTML with one detail link and LocalBusiness JSON-LD
# ---------------------------------------------------------------------------

def _make_search_html(firm_id: str, slug: str, name: str, lat: float, lng: float) -> str:
    ld = {
        "@context": "http://schema.org",
        "@type": "LocalBusiness",
        "name": name,
        "geo": {"@type": "Geocoordinates", "latitude": lat, "longitude": lng},
        "url": f"https://www.firmy.cz/detail/{firm_id}-{slug}.html",
    }
    ld_json = json.dumps(ld)
    return f"""
    <html><body>
    <a href="https://www.firmy.cz/detail/{firm_id}-{slug}.html">{name}</a>
    <script type="application/ld+json">{ld_json}</script>
    </body></html>
    """


# ---------------------------------------------------------------------------
# Mock HTTP adapter
# ---------------------------------------------------------------------------

class MockFirmyAdapter(HTTPAdapter):
    """
    Intercepts all HTTP requests and dispatches them to registered handlers.
    """

    def __init__(self, handlers: dict[str, Callable[[requests.PreparedRequest], Response]]) -> None:
        super().__init__()
        self._handlers = handlers

    def send(self, request: requests.PreparedRequest, **kwargs) -> Response:  # type: ignore[override]
        for pattern, handler in self._handlers.items():
            if re.search(pattern, request.url or ""):
                return handler(request)
        raise ConnectionError(f"MockFirmyAdapter: no handler for {request.url}")


# ---------------------------------------------------------------------------
# Helpers to build FirmyHoursSource with a fully mocked session
# ---------------------------------------------------------------------------

def _make_source(
    search_html: str,
    detail_html: str,
    firm_id: str = "272313",
    slug: str = "restaurace-u-fleku-praha-nove-mesto",
    min_interval: float = 0.0,
) -> FirmyHoursSource:
    """Return a FirmyHoursSource whose HTTP calls are mocked."""
    session = requests.Session()

    def handle_autologin(_req):
        return _make_response("", url="https://www.firmy.cz/")

    def handle_search(_req):
        return _make_response(search_html)

    def handle_detail(_req):
        return _make_response(detail_html)

    adapter = MockFirmyAdapter({
        r"autologin": handle_autologin,
        r"firmy\.cz/\?q=": handle_search,
        r"/detail/": handle_detail,
    })
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    return FirmyHoursSource(
        session=session,
        min_interval=min_interval,
        timeout=5,
    )


# ---------------------------------------------------------------------------
# Tests: fixture-based (U Fleků real HTML parsed offline)
# ---------------------------------------------------------------------------

class TestUflekuFixture:
    """Parse the real saved U Fleků HTML — no network involved."""

    def test_fixture_file_exists(self):
        assert (FIXTURES_DIR / "firmy_ufleku.html").exists()

    def test_fixture_has_opening_hours(self):
        assert "openingHours" in UFLEKU_HTML

    def test_extract_ld_blocks(self):
        blocks = FirmyHoursSource._extract_ld_blocks(UFLEKU_HTML)
        assert len(blocks) >= 1
        lb = FirmyHoursSource._local_business_block(blocks)
        assert lb is not None
        assert lb.get("@type") == "LocalBusiness"

    def test_fixture_normalized_hours(self):
        """The fixture should yield exactly 'Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00'."""
        from pubs.enrichment.normalizer import normalize_to_osm

        blocks = FirmyHoursSource._extract_ld_blocks(UFLEKU_HTML)
        lb = FirmyHoursSource._local_business_block(blocks)
        assert lb is not None

        raw_oh = lb.get("openingHours") or lb.get("openingHoursSpecification")
        normalized = normalize_to_osm(raw_oh)
        assert normalized == "Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00"

    def test_fixture_name_and_geo(self):
        blocks = FirmyHoursSource._extract_ld_blocks(UFLEKU_HTML)
        lb = FirmyHoursSource._local_business_block(blocks)
        assert lb["name"] == "Restaurace U Fleků"
        assert abs(lb["geo"]["latitude"] - 50.078914) < 0.01
        assert abs(lb["geo"]["longitude"] - 14.416990) < 0.01


# ---------------------------------------------------------------------------
# Tests: FirmyHoursSource.fetch() with mocked HTTP
# ---------------------------------------------------------------------------

class TestFirmyHoursSourceFetch:
    def _detail_html_with_hours(self, name: str, lat: float, lng: float, hours: str) -> str:
        ld = {
            "@context": "http://schema.org",
            "@type": "LocalBusiness",
            "name": name,
            "geo": {"@type": "Geocoordinates", "latitude": lat, "longitude": lng},
            "openingHours": hours,
        }
        return f'<html><script type="application/ld+json">{json.dumps(ld)}</script></html>'

    def _detail_html_no_hours(self, name: str, lat: float, lng: float) -> str:
        ld = {
            "@context": "http://schema.org",
            "@type": "LocalBusiness",
            "name": name,
            "geo": {"@type": "Geocoordinates", "latitude": lat, "longitude": lng},
        }
        return f'<html><script type="application/ld+json">{json.dumps(ld)}</script></html>'

    def test_successful_fetch_returns_raw_hours(self):
        name = "Restaurace U Fleků"
        lat, lng = 50.078914, 14.416990
        search_html = _make_search_html("272313", "restaurace-u-fleku", name, lat, lng)
        detail_html = self._detail_html_with_hours(name, lat, lng, "Mo,Tu,We,Th,Fr,Sa,Su 10:00–23:00")
        src = _make_source(search_html, detail_html)

        result = src.fetch(name, lat, lng, city="Praha")
        assert result is not None
        assert isinstance(result, RawHours)
        assert result.opening_hours_raw == "Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00"
        assert result.source == "firmy"
        assert result.source_ref == "272313"
        assert result.confidence > 0.4

    def test_no_hours_returns_raw_hours_with_none(self):
        """Firm found but no opening hours → RawHours(opening_hours_raw=None)."""
        name = "Pivnice Tichá"
        lat, lng = 50.0, 14.0
        search_html = _make_search_html("999999", "pivnice-ticha", name, lat, lng)
        detail_html = self._detail_html_no_hours(name, lat, lng)
        src = _make_source(search_html, detail_html, firm_id="999999", slug="pivnice-ticha")

        result = src.fetch(name, lat, lng)
        assert result is not None
        assert result.opening_hours_raw is None
        assert result.source == "firmy"

    def test_low_confidence_returns_none(self):
        """A bad geo match should be rejected."""
        # Query is in Prague, candidate is in Brno (~200 km away)
        name = "Restaurace Na Rohu"
        q_lat, q_lng = 50.078914, 14.416990
        c_lat, c_lng = 49.195060, 16.606837  # Brno
        search_html = _make_search_html("111111", "restaurace-na-rohu", "McDonald's Brno", c_lat, c_lng)
        detail_html = self._detail_html_with_hours("McDonald's Brno", c_lat, c_lng, "Mo-Su 09:00-22:00")
        src = _make_source(search_html, detail_html, firm_id="111111", slug="restaurace-na-rohu")

        result = src.fetch(name, q_lat, q_lng)
        assert result is None

    def test_no_search_results_returns_none(self):
        """Empty search page → None."""
        src = _make_source(
            search_html="<html><body>Žádné výsledky</body></html>",
            detail_html="<html></html>",
        )
        result = src.fetch("Neexistující hospoda", 50.0, 14.0)
        assert result is None

    def test_detail_has_no_local_business_block_returns_none(self):
        """Detail page with no LocalBusiness JSON-LD → None."""
        name = "Pivnice"
        lat, lng = 50.0, 14.0
        search_html = _make_search_html("123456", "pivnice", name, lat, lng)
        detail_html = '<html><script type="application/ld+json">{"@type": "WebSite"}</script></html>'
        src = _make_source(search_html, detail_html, firm_id="123456", slug="pivnice")

        result = src.fetch(name, lat, lng)
        assert result is None

    def test_openinghours_spec_normalised(self):
        """openingHoursSpecification on the detail page is converted correctly."""
        name = "Pivnice"
        lat, lng = 50.0, 14.0
        spec = [
            {"dayOfWeek": "http://schema.org/Monday", "opens": "10:00", "closes": "22:00"},
            {"dayOfWeek": "http://schema.org/Tuesday", "opens": "10:00", "closes": "22:00"},
        ]
        ld = {
            "@context": "http://schema.org",
            "@type": "LocalBusiness",
            "name": name,
            "geo": {"latitude": lat, "longitude": lng},
            "openingHoursSpecification": spec,
        }
        search_html = _make_search_html("222222", "pivnice", name, lat, lng)
        detail_html = f'<html><script type="application/ld+json">{json.dumps(ld)}</script></html>'
        src = _make_source(search_html, detail_html, firm_id="222222", slug="pivnice")

        result = src.fetch(name, lat, lng)
        assert result is not None
        assert result.opening_hours_raw == "Mo 10:00-22:00; Tu 10:00-22:00"

    def test_network_error_on_detail_returns_none(self):
        """Network error on detail fetch → None (graceful degradation)."""
        name = "Test Pub"
        lat, lng = 50.0, 14.0
        search_html = _make_search_html("333333", "test-pub", name, lat, lng)

        session = requests.Session()

        def handle_autologin(_req):
            return _make_response("")

        def handle_search(_req):
            return _make_response(search_html)

        def handle_detail(_req):
            raise ConnectionError("network error")

        adapter = MockFirmyAdapter({
            r"autologin": handle_autologin,
            r"firmy\.cz/\?q=": handle_search,
            r"/detail/": handle_detail,
        })
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        src = FirmyHoursSource(session=session, min_interval=0.0)
        result = src.fetch(name, lat, lng)
        assert result is None

    def test_daily_cap_exceeded_raises(self):
        """Exceeding daily cap raises RuntimeError."""

        name = "Pivnice"
        lat, lng = 50.0, 14.0
        search_html = _make_search_html("444444", "pivnice", name, lat, lng)
        detail_html = self._detail_html_with_hours(name, lat, lng, "Mo-Su 10:00-22:00")
        src = _make_source(search_html, detail_html, firm_id="444444", slug="pivnice")
        src._daily_cap = 0  # cap of 0 → always exceeded

        with pytest.raises(RuntimeError, match="daily request cap"):
            src.fetch(name, lat, lng)


# ---------------------------------------------------------------------------
# Tests: HTTP guardrails (redirect cap / body size / host allow-list)
# ---------------------------------------------------------------------------

class TestHttpGuardrails:
    def test_max_redirects_capped(self):
        """The session caps redirects at 5, not requests' default of 30."""
        from pubs.enrichment.firmy import _MAX_REDIRECTS

        src = _make_source(
            search_html="<html></html>",
            detail_html="<html></html>",
        )
        assert src._session.max_redirects == _MAX_REDIRECTS

    def test_host_allow_list(self):
        assert FirmyHoursSource._host_allowed("https://www.firmy.cz/detail/1-x.html")
        assert FirmyHoursSource._host_allowed("https://cmp.seznam.cz/check")
        assert FirmyHoursSource._host_allowed("https://firmy.cz/")
        # Hostile / foreign hosts rejected
        assert not FirmyHoursSource._host_allowed("https://evil.example.com/")
        assert not FirmyHoursSource._host_allowed("https://firmy.cz.evil.com/")
        assert not FirmyHoursSource._host_allowed(None)
        assert not FirmyHoursSource._host_allowed("")

    def test_foreign_host_body_not_read(self):
        """If the proxy redirects us off the allowed families, body is dropped."""
        name = "Pivnice"
        lat, lng = 50.0, 14.0
        search_html = _make_search_html("555555", "pivnice", name, lat, lng)
        # Detail handler returns content but from a foreign final URL.
        session = requests.Session()

        def handle_autologin(_req):
            return _make_response("", url="https://www.firmy.cz/")

        def handle_search(_req):
            return _make_response(search_html, url="https://www.firmy.cz/?q=x")

        def handle_detail(_req):
            return _make_response(
                self._detail_html(name, lat, lng),
                url="https://evil.example.com/detail/555555-pivnice.html",
            )

        adapter = MockFirmyAdapter({
            r"autologin": handle_autologin,
            r"firmy\.cz/\?q=": handle_search,
            r"/detail/": handle_detail,
        })
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        src = FirmyHoursSource(session=session, min_interval=0.0)

        # Body from the foreign host is dropped → no LocalBusiness → None.
        result = src.fetch(name, lat, lng)
        assert result is None

    def _detail_html(self, name, lat, lng):
        ld = {
            "@context": "http://schema.org",
            "@type": "LocalBusiness",
            "name": name,
            "geo": {"latitude": lat, "longitude": lng},
            "openingHours": "Mo-Su 10:00-22:00",
        }
        return f'<html><script type="application/ld+json">{json.dumps(ld)}</script></html>'

    def test_oversized_body_truncated(self):
        """A body larger than _MAX_BODY_BYTES is truncated before parsing."""
        from pubs.enrichment.firmy import _MAX_BODY_BYTES

        resp = _make_response("x" * (_MAX_BODY_BYTES + 1000))
        FirmyHoursSource._read_bounded_body(resp)
        assert len(resp._content) == _MAX_BODY_BYTES


# ---------------------------------------------------------------------------
# Tests: warmup respects throttle + daily cap (MEDIUM 4)
# ---------------------------------------------------------------------------

class TestWarmupGuardrails:
    def test_warmup_counts_against_daily_cap(self):
        """Homepage + autologin warmup GETs consume the daily cap."""
        from pubs.enrichment import firmy as firmy_mod

        # Reset the process-wide counter so the assertion is deterministic.
        firmy_mod._global_counter._day = None
        firmy_mod._global_counter._count = 0

        session = requests.Session()

        def handler(_req):
            return _make_response("<html></html>", url="https://www.firmy.cz/")

        adapter = MockFirmyAdapter({r".*": handler})
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        # Use a real (owned) session path by building one with a proxy=None,
        # but we must exercise _build_session — instead drive warmup directly.
        src = FirmyHoursSource(session=session, min_interval=0.0)
        # The injected-session path skips warmup; drive warmup explicitly to
        # confirm it routes through the cap.
        before = firmy_mod._global_counter.current()
        src._session.max_redirects = firmy_mod._MAX_REDIRECTS
        # Simulate the two warmup hits through the guarded path.
        for url in (firmy_mod._HOMEPAGE_URL, firmy_mod._AUTOLOGIN_URL):
            if src._check_cap():
                src._throttle()
                src._session.get(url, timeout=5, allow_redirects=True)
        after = firmy_mod._global_counter.current()
        assert after - before == 2

    def test_build_session_warmup_uses_cap(self):
        """_build_session routes warmup through the cap accounting."""
        from pubs.enrichment import firmy as firmy_mod

        firmy_mod._global_counter._day = None
        firmy_mod._global_counter._count = 0

        # Patch requests.Session.get used inside _build_session to avoid network.
        with patch.object(requests.Session, "get", return_value=_make_response("")) as mock_get:
            src = FirmyHoursSource(min_interval=0.0)

        # Two warmup GETs were issued and each consumed a cap slot.
        assert mock_get.call_count == 2
        assert firmy_mod._global_counter.current() == 2
        src.__exit__()


# ---------------------------------------------------------------------------
# Tests: detail link regex
# ---------------------------------------------------------------------------

class TestDetailRegex:
    def test_extracts_firm_id_and_slug(self):
        html = '<a href="https://www.firmy.cz/detail/272313-restaurace-u-fleku-praha-nove-mesto.html">link</a>'
        m = _DETAIL_RE.search(html)
        assert m is not None
        assert m.group(1) == "272313"
        assert m.group(2) == "restaurace-u-fleku-praha-nove-mesto"

    def test_no_match_on_empty(self):
        assert _DETAIL_RE.search("") is None

    def test_no_match_on_non_detail_url(self):
        assert _DETAIL_RE.search('<a href="https://www.firmy.cz/restaurace">link</a>') is None
