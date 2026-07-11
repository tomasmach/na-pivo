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

from pubs.enrichment.firmy import (
    _DETAIL_RE,
    FirmyHoursSource,
    RawHours,
    TransientFetchError,
    _build_search_queries,
    _core_name,
)

# ---------------------------------------------------------------------------
# Fixture paths
# ---------------------------------------------------------------------------

FIXTURES_DIR = pathlib.Path(__file__).parent / "fixtures"
UFLEKU_HTML = (FIXTURES_DIR / "firmy_ufleku.html").read_text(encoding="utf-8")
DETAIL_LISTS_HTML = (FIXTURES_DIR / "firmy_detail_lists.html").read_text(encoding="utf-8")


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


def _make_search_card(firm_id: str, slug: str, name: str, lat: float, lng: float) -> str:
    """Return a representative Firmy.cz SSR search-result card."""
    return f'''<a class="titleLinkOverlay" id="prem-{firm_id}" data-dot="premise"
    data-dot-data="{{&quot;premise-id&quot;:{firm_id}}}"
    href="https://www.firmy.cz/detail/{firm_id}-{slug}.html">
      <h3 class="h3 title" title="Detail firmy {name}">{name}</h3>
    </a>
    <div class="content"><ul class="tags"><li>Hospody a hostince</li></ul>
    <address class="address noBreak"><a data-dot="address" class="noBreak"
      href="https://mapy.com/cs/zakladni?planovani-trasy&amp;x={lng}&amp;y={lat}&amp;z=17&amp;ri=&amp;ri={firm_id}">
      Adresa</a></address></div>'''


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

    def test_fixture_rating(self):
        rating_value, rating_count, rating_label = FirmyHoursSource._extract_rating(UFLEKU_HTML)
        assert rating_value == pytest.approx(4.1)
        assert rating_count == 364
        assert rating_label == "Velmi dobré"

    def test_fixture_name_and_geo(self):
        blocks = FirmyHoursSource._extract_ld_blocks(UFLEKU_HTML)
        lb = FirmyHoursSource._local_business_block(blocks)
        assert lb["name"] == "Restaurace U Fleků"
        assert abs(lb["geo"]["latitude"] - 50.078914) < 0.01
        assert abs(lb["geo"]["longitude"] - 14.416990) < 0.01


# ---------------------------------------------------------------------------
# Tests: category / tag extraction (div.list.lcat / div.list.ltag)
# ---------------------------------------------------------------------------

class TestCategoryTagExtraction:
    """Parse the lcat/ltag blocks from realistic SSR HTML, footer noise and all."""

    def test_extracts_category_names_from_lcat(self):
        cats, _tags = FirmyHoursSource._extract_categories_tags(DETAIL_LISTS_HTML)
        assert cats == ["České a staročeské restaurace", "Restaurace"]

    def test_extracts_tag_slugs_from_ltag(self):
        _cats, tags = FirmyHoursSource._extract_categories_tags(DETAIL_LISTS_HTML)
        assert tags == ["jitrnice", "tocene-pivo", "darkove-poukazy", "svickova", "salat"]

    def test_footer_stitek_links_are_not_swept_in(self):
        """Generic /stitek/ links in the page footer (outside the ltag block)
        must NOT leak into the extracted tags."""
        _cats, tags = FirmyHoursSource._extract_categories_tags(DETAIL_LISTS_HTML)
        assert "samosber-jahod" not in tags
        assert "vanocni-stromky" not in tags

    def test_real_ufleku_fixture_extraction(self):
        """The full real U Fleků page extracts the same lists."""
        cats, tags = FirmyHoursSource._extract_categories_tags(UFLEKU_HTML)
        assert "České a staročeské restaurace" in cats
        assert "Restaurace" in cats
        assert "tocene-pivo" in tags

    def test_missing_sections_yield_empty_lists(self):
        cats, tags = FirmyHoursSource._extract_categories_tags(
            "<html><body>no detail lists here</body></html>"
        )
        assert cats == []
        assert tags == []

    def test_only_lcat_present(self):
        html = (
            '<div class="detailLists"><div class="list lcat"><ul>'
            '<li><a href="https://www.firmy.cz/x">Pivnice</a></li>'
            "</ul></div></div>"
        )
        cats, tags = FirmyHoursSource._extract_categories_tags(html)
        assert cats == ["Pivnice"]
        assert tags == []


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
        assert result.rating_value is None
        assert result.rating_count is None
        assert result.rating_label is None

    def test_successful_fetch_returns_rating(self):
        name = "Restaurace U Fleků"
        lat, lng = 50.078914, 14.416990
        search_html = _make_search_html("272313", "restaurace-u-fleku", name, lat, lng)
        detail_html = (
            self._detail_html_with_hours(name, lat, lng, "Mo-Su 10:00-23:00")
            + '<span class="reviewBadgeNew medium">4,1</span>'
            + '<span class="badgeLabelValue">Velmi dobré</span>'
            + '<span class="badgeReviewCount">364 hodnocení</span>'
        )
        src = _make_source(search_html, detail_html)

        result = src.fetch(name, lat, lng, city="Praha")
        assert result is not None
        assert result.rating_value == pytest.approx(4.1)
        assert result.rating_count == 364
        assert result.rating_label == "Velmi dobré"

    def test_fetch_populates_categories_and_tags(self):
        """A successful fetch carries the scraped categories/tags on RawHours."""
        name = "Restaurace U Fleků"
        lat, lng = 50.078914, 14.416990
        search_html = _make_search_html("272313", "u-fleku", name, lat, lng)
        ld = {
            "@context": "http://schema.org",
            "@type": "LocalBusiness",
            "name": name,
            "geo": {"latitude": lat, "longitude": lng},
            "openingHours": "Mo-Su 10:00-23:00",
        }
        detail_html = (
            f'<html><script type="application/ld+json">{json.dumps(ld)}</script>'
            '<div class="list lcat"><ul>'
            '<li><a href="https://www.firmy.cz/x">České a staročeské restaurace</a></li>'
            '<li><a href="https://www.firmy.cz/y">Restaurace</a></li></ul></div>'
            '<div class="list ltag"><ul>'
            '<li><a href="https://www.firmy.cz/stitek/tocene-pivo">Točené pivo</a></li>'
            "</ul></div></html>"
        )
        src = _make_source(search_html, detail_html, firm_id="272313", slug="u-fleku")

        result = src.fetch(name, lat, lng, city="Praha")
        assert result is not None
        assert result.categories == ["České a staročeské restaurace", "Restaurace"]
        assert result.tags == ["tocene-pivo"]

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

    def test_distant_search_metadata_skips_detail_fetch(self):
        """A search hit in another city (here Brno vs a Prague query, ~185 km)
        is geographically distant, so the detail fetch is skipped to save proxy
        bandwidth — detail is never hit."""
        name = "Restaurace Na Rohu"
        q_lat, q_lng = 50.078914, 14.416990
        c_lat, c_lng = 49.195060, 16.606837  # Brno
        search_html = _make_search_html(
            "111111", "restaurace-na-rohu", "McDonald's Brno", c_lat, c_lng
        )

        session = requests.Session()
        detail_calls = 0

        def handle_search(_req):
            return _make_response(search_html)

        def handle_detail(_req):
            nonlocal detail_calls
            detail_calls += 1
            return _make_response(
                self._detail_html_with_hours(
                    "McDonald's Brno", c_lat, c_lng, "Mo-Su 09:00-22:00"
                )
            )

        adapter = MockFirmyAdapter({
            r"firmy\.cz/\?q=": handle_search,
            r"/detail/": handle_detail,
        })
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        src = FirmyHoursSource(session=session, min_interval=0.0)
        assert src.fetch(name, q_lat, q_lng) is None
        assert detail_calls == 0

    def test_nearby_search_hit_with_poor_name_still_fetches_detail(self):
        """A search card whose geo is CLOSE to the query but whose card NAME is
        poor/truncated must STILL fetch detail — the geo-only pre-filter never
        drops a near match on a bad search name; the better detail name then
        clears the post-detail confidence gate."""
        name = "Restaurace U Fleků"
        q_lat, q_lng = 50.078914, 14.416990
        # ~110 m north of the query — well inside SEARCH_REJECT_DISTANCE_M.
        c_lat, c_lng = 50.079914, 14.416990
        # Truncated/parent search-card name that would fail the name gate.
        search_html = _make_search_html(
            "272313", "u-fleku", "Restaurace", c_lat, c_lng
        )

        session = requests.Session()
        detail_calls = 0

        def handle_search(_req):
            return _make_response(search_html)

        def handle_detail(_req):
            nonlocal detail_calls
            detail_calls += 1
            # Detail page carries the full, correct name.
            return _make_response(
                self._detail_html_with_hours(
                    name, c_lat, c_lng, "Mo,Tu,We,Th,Fr,Sa,Su 10:00–23:00"
                )
            )

        adapter = MockFirmyAdapter({
            r"firmy\.cz/\?q=": handle_search,
            r"/detail/": handle_detail,
        })
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        src = FirmyHoursSource(session=session, min_interval=0.0)
        result = src.fetch(name, q_lat, q_lng)
        assert detail_calls >= 1
        assert result is not None
        assert result.opening_hours_raw == "Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00"

    def test_missing_search_metadata_keeps_detail_fallback(self):
        """Sparse search pages still fetch detail because only detail has metadata."""
        name = "Restaurace U Fleků"
        lat, lng = 50.078914, 14.416990
        search_html = (
            '<html><body><a href="https://www.firmy.cz/detail/272313-u-fleku.html">'
            "Restaurace U Fleků</a></body></html>"
        )
        detail_html = self._detail_html_with_hours(
            name, lat, lng, "Mo,Tu,We,Th,Fr,Sa,Su 10:00–23:00"
        )
        src = _make_source(search_html, detail_html, firm_id="272313", slug="u-fleku")

        result = src.fetch(name, lat, lng)
        assert result is not None
        assert result.opening_hours_raw == "Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00"

    def test_sparse_multiple_detail_links_keep_first_link_fallback(self):
        """Pages without cards or JSON-LD preserve the legacy first-link path."""
        name = "Hospoda U Testu"
        lat, lng = 50.0, 14.0
        search_html = (
            '<a href="https://www.firmy.cz/detail/111111-hospoda-u-testu.html">first</a>'
            '<a href="https://www.firmy.cz/detail/222222-hospoda-u-testu-jina.html">second</a>'
        )
        detail_html = self._detail_html_with_hours(name, lat, lng, "Mo-Su 10:00-22:00")
        src = _make_source(search_html, detail_html)

        result = src.fetch(name, lat, lng)
        assert result is not None
        assert result.source_ref == "111111"

    def test_second_matching_search_card_beats_distant_first_card(self):
        """Card metadata selects the Stará Říše result without a second search."""
        name = "Hostinec U Bláhů"
        lat, lng = 49.177567, 15.594928
        search_html = "<html><body>" + _make_search_card(
            "12000001", "hostinec-u-blahu-praha-zbraslav", name, 50.0, 14.4
        ) + _make_search_card(
            "13010131", "hostinec-u-blahu-stara-rise", name, lat, lng
        ) + "</body></html>"
        detail_html = self._detail_html_with_hours(name, lat, lng, "Mo-Su 11:00-22:00")
        src = _make_source(search_html, detail_html)

        result = src.fetch(name, lat, lng, city="Stará Říše")
        assert result is not None
        assert result.source_ref == "13010131"

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

    def test_network_error_on_detail_raises_transient(self):
        """A real network error on the detail fetch raises TransientFetchError
        (retryable) — the caller persists 'error', not a sticky 'unknown'."""
        name = "Test Pub"
        lat, lng = 50.0, 14.0
        search_html = _make_search_html("333333", "test-pub", name, lat, lng)

        session = requests.Session()

        def handle_autologin(_req):
            return _make_response("")

        def handle_search(_req):
            return _make_response(search_html)

        def handle_detail(_req):
            raise requests.exceptions.ConnectionError("network error")

        adapter = MockFirmyAdapter({
            r"autologin": handle_autologin,
            r"firmy\.cz/\?q=": handle_search,
            r"/detail/": handle_detail,
        })
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        src = FirmyHoursSource(session=session, min_interval=0.0)
        with pytest.raises(TransientFetchError):
            src.fetch(name, lat, lng)

    def test_proxy_error_on_search_raises_transient(self):
        """A proxy 502 (ProxyError) on the search request raises
        TransientFetchError rather than degrading to a no-match None. This is
        the real-world Webshare rotation blip that must NOT poison the cache."""
        name = "U Fleku"
        lat, lng = 50.0808, 14.4205

        session = requests.Session()

        def handle_search(_req):
            raise requests.exceptions.ProxyError(
                "Unable to connect to proxy: Tunnel connection failed: 502 Bad Gateway"
            )

        adapter = MockFirmyAdapter({r"firmy\.cz/\?q=": handle_search})
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        src = FirmyHoursSource(session=session, min_interval=0.0)
        with pytest.raises(TransientFetchError):
            src.fetch(name, lat, lng, city="Praha")

    def test_consent_wall_on_search_raises_transient(self):
        """A flagged proxy IP is bounced to the consent wall on the FIRST
        (search) request: HTTP 200 from cmp.seznam.cz with no detail link. This
        must raise TransientFetchError, not degrade to a sticky 'unknown'."""
        name = "U Fleku"
        lat, lng = 50.0808, 14.4205

        session = requests.Session()

        def handle_search(_req):
            # 200 OK, but the final URL is the Seznam GDPR consent wall.
            return _make_response(
                "<html><body>consent</body></html>",
                url="https://cmp.seznam.cz/cz/ochrana-udaju?reason=missing",
            )

        adapter = MockFirmyAdapter({r"firmy\.cz/\?q=": handle_search})
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        src = FirmyHoursSource(session=session, min_interval=0.0)
        with pytest.raises(TransientFetchError):
            src.fetch(name, lat, lng, city="Praha")

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
        assert not FirmyHoursSource._host_allowed("https://evilfirmy.cz/bad")
        assert not FirmyHoursSource._host_allowed("https://badseznam.cz/bad")
        assert not FirmyHoursSource._host_allowed(None)
        assert not FirmyHoursSource._host_allowed("")

    def test_is_consent_wall_matches_host_path_not_query(self):
        """Consent detection keys on host/path, never the user-controlled ?q=."""
        # Real consent-wall hosts → True.
        assert FirmyHoursSource._is_consent_wall(
            _make_response("", url="https://cmp.seznam.cz/cz/ochrana-udaju"))
        assert FirmyHoursSource._is_consent_wall(
            _make_response("", url="https://cmp.firmy.cz/x"))
        # The token on the PATH of a firmy/seznam host → True.
        assert FirmyHoursSource._is_consent_wall(
            _make_response("", url="https://www.firmy.cz/nastaveni-souhlasu"))
        # A normal search whose QUERY contains the token → NOT a consent wall.
        assert not FirmyHoursSource._is_consent_wall(
            _make_response("", url="https://www.firmy.cz/?q=U+nastaveni-souhlasu+Praha"))
        # An ordinary search result page → False.
        assert not FirmyHoursSource._is_consent_wall(
            _make_response("", url="https://www.firmy.cz/?q=U+Fleku+Praha"))

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
# Regression: constructing a source must NOT warm up the session.
#
# An earlier version "warmed up" the session via the szn.cz autologin endpoint
# to (supposedly) bypass the Seznam GDPR consent wall. In reality that warmup
# pushed the session INTO the consent wall and broke EVERY live detail fetch
# (the autologin redirect chain also overflowed max_redirects). A plain
# cookie-aware session reaches search + detail pages directly, so construction
# must make zero outbound requests.
# ---------------------------------------------------------------------------

class TestNoWarmup:
    def test_build_session_makes_no_warmup_requests(self):
        """Constructing FirmyHoursSource issues no homepage/autologin GETs."""
        from pubs.enrichment import firmy as firmy_mod

        firmy_mod._global_counter._day = None
        firmy_mod._global_counter._count = 0

        # If construction warmed up the session it would call Session.get here.
        with patch.object(requests.Session, "get", return_value=_make_response("")) as mock_get:
            src = FirmyHoursSource(min_interval=0.0)

        assert mock_get.call_count == 0
        assert firmy_mod._global_counter.current() == 0
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


# ---------------------------------------------------------------------------
# Tests: HTTP status semantics (410 = Firmy.cz "no search results")
# ---------------------------------------------------------------------------

class TestHttpStatusSemantics:
    """
    Live-verified 2026-06-11: firmy.cz/?q= answers HTTP 410 Gone for searches
    with ZERO results (e.g. 'bangladeshi & indian restaurant ostrava' — the '&'
    breaks tokenization so nothing matches; plain gibberish queries get 410
    too). A 410 is therefore a genuine no-match, NOT a transient failure:
    treating it as TransientFetchError makes the worker retry the same pub on
    every request forever (log spam + wasted proxy quota) instead of caching
    'unknown' for HOURS_TTL_DAYS.

    Contract: 4xx (except 429) → no-match (None); 429/5xx/network → transient.
    """

    def _source_with_search(self, handler) -> FirmyHoursSource:
        session = requests.Session()
        adapter = MockFirmyAdapter({r"firmy\.cz/\?q=": handler})
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        return FirmyHoursSource(session=session, min_interval=0.0)

    def test_search_410_no_results_returns_none(self):
        def handle_search(_req):
            return _make_response(
                "<html>no results page</html>", status_code=410,
                url="https://www.firmy.cz/?q=bangladeshi+%26+indian+restaurant+ostrava",
            )

        src = self._source_with_search(handle_search)
        assert src.fetch("Bangladeshi & Indian restaurant", 49.8, 18.2, city="Ostrava") is None

    def test_search_404_returns_none(self):
        def handle_search(_req):
            return _make_response("", status_code=404)

        src = self._source_with_search(handle_search)
        assert src.fetch("Test Pub", 50.0, 14.0) is None

    def test_search_429_raises_transient(self):
        def handle_search(_req):
            return _make_response("", status_code=429)

        src = self._source_with_search(handle_search)
        with pytest.raises(TransientFetchError):
            src.fetch("Test Pub", 50.0, 14.0)

    def test_search_500_raises_transient(self):
        def handle_search(_req):
            return _make_response("", status_code=500)

        src = self._source_with_search(handle_search)
        with pytest.raises(TransientFetchError):
            src.fetch("Test Pub", 50.0, 14.0)

    def test_detail_410_firm_gone_returns_none(self):
        """A firm removed between search and detail is a no-match, not a retry."""
        name = "Test Pub"
        lat, lng = 50.0, 14.0
        search_html = _make_search_html("444444", "test-pub", name, lat, lng)

        session = requests.Session()
        adapter = MockFirmyAdapter({
            r"firmy\.cz/\?q=": lambda _req: _make_response(search_html),
            r"/detail/": lambda _req: _make_response(
                "", status_code=410,
                url="https://www.firmy.cz/detail/444444-test-pub.html",
            ),
        })
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        src = FirmyHoursSource(session=session, min_interval=0.0)
        assert src.fetch(name, lat, lng) is None


# ---------------------------------------------------------------------------
# Search-query ladder + geo-aware selection (the cost-cutting coverage fix)
# ---------------------------------------------------------------------------

def _query_of(req: requests.PreparedRequest) -> str:
    """Extract the decoded ?q= search term from a mocked request URL."""
    from urllib.parse import parse_qs, urlparse

    return parse_qs(urlparse(req.url or "").query).get("q", [""])[0]


class TestBuildSearchQueries:
    """Pure unit tests for the query-form ladder (no HTTP)."""

    def test_name_only_first_city_last(self):
        # A city appended to the query 410s firmy.cz's tokenizer, so the
        # name-only form must be tried FIRST and name+city only as a fallback.
        qs = _build_search_queries("Pivnice U Zlatého slona", "Praha")
        assert qs[0] == "Pivnice U Zlatého slona"
        assert qs[-1] == "Pivnice U Zlatého slona Praha"

    def test_core_name_inserted_before_city_form(self):
        name = "Pilsner Urquell: The Original Beer Experience"
        qs = _build_search_queries(name, "Praha")
        assert _core_name(name) == "Pilsner Urquell"
        assert "Pilsner Urquell" in qs
        assert qs.index("Pilsner Urquell") < qs.index(f"{name} Praha")

    def test_dedupes_when_no_subtitle_no_city(self):
        # core == name, depunctuated == name, no city → a single query form.
        assert _build_search_queries("Pivovar Staré Město", None) == ["Pivovar Staré Město"]

    def test_dash_subtitle_core(self):
        assert _core_name("PLNÝ PEKÁČ - restaurace a pivnice") == "PLNÝ PEKÁČ"


class TestSearchLadderBehaviour:
    """End-to-end fetch() behaviour of the ladder + geo-aware selection."""

    def test_falls_back_to_core_name_when_full_name_410s(self):
        """A long subtitle name 410s in full but hits on its core name."""
        name = "Pilsner Urquell: The Original Beer Experience"
        lat, lng = 50.0875, 14.4213
        detail_html = _make_search_html("111", "pilsner-urquell-praha", name, lat, lng)

        def handle_search(req):
            q = _query_of(req)
            if "Original" in q:  # full name and name+city both carry the subtitle
                return _make_response("", status_code=410, url=req.url)
            # core "Pilsner Urquell" → a hit
            return _make_response(_make_search_html("111", "pilsner-urquell-praha", name, lat, lng))

        session = requests.Session()
        adapter = MockFirmyAdapter({
            r"firmy\.cz/\?q=": handle_search,
            r"/detail/": lambda _req: _make_response(detail_html),
        })
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        src = FirmyHoursSource(session=session, min_interval=0.0)
        result = src.fetch(name, lat, lng, city="Praha")
        assert result is not None
        assert result.source_ref == "111"

    def test_geo_aware_fallback_to_city_form_for_other_town_name(self):
        """A name carrying a different town ('… Hostomice', but the pub is in
        Prague) surfaces the distant other-town listing on the name-only search;
        the geo-aware ladder must reject it and pick the near name+city hit."""
        name = "Nalévárna Pivovaru Hostomice"
        q_lat, q_lng = 50.0875, 14.4213  # Prague
        far_lat, far_lng = 49.79, 14.04  # Hostomice town (~35 km away)

        # firm_id must be numeric — _DETAIL_RE only matches /detail/<digits>-…
        far_search = _make_search_html("900", "nalevarna-hostomice", name, far_lat, far_lng)
        near_search = _make_search_html("200", "nalevarna-praha", name, q_lat, q_lng)
        near_detail = _make_search_html("200", "nalevarna-praha", name, q_lat, q_lng)

        def handle_search(req):
            q = _query_of(req)
            if q.endswith("Praha"):       # name + city disambiguator → near hit
                return _make_response(near_search)
            return _make_response(far_search)  # name-only → distant hit

        session = requests.Session()
        adapter = MockFirmyAdapter({
            r"firmy\.cz/\?q=": handle_search,
            r"/detail/200": lambda _req: _make_response(near_detail),
            # /detail/900 must never be fetched — the distant hit is rejected
            # before any detail call.
            r"/detail/900": lambda _req: pytest.fail("fetched the distant FAR detail"),
        })
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        src = FirmyHoursSource(session=session, min_interval=0.0)
        result = src.fetch(name, q_lat, q_lng, city="Praha")
        assert result is not None
        assert result.source_ref == "200"
