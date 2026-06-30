"""
pubs.enrichment.firmy — opening-hours scraper for Firmy.cz (Seznam business directory).

LEGAL / ROBOTS NOTICE
---------------------
firmy.cz robots.txt declares "User-agent: * / Disallow: /", which means automated
crawling is prohibited. This module is designed as a *low-volume, lazy-fill* cache
loader and implements the following mitigations:

  * All requests route through an optional residential proxy (FIRMY_PROXY_URL).
    In production the proxy MUST be set. In dev/tests it may be omitted (direct).
  * A configurable minimum interval (FIRMY_MIN_INTERVAL_SEC, default 3 s) is
    enforced between consecutive HTTP requests.
  * A hard daily cap (FIRMY_DAILY_CAP, default 2 000 requests/day) is checked
    before each request; if exceeded the fetch is refused.
  * Aggressive caching (HOURS_TTL_DAYS, default 30 days) means each pub is
    re-fetched at most ~12 times a year.
  * Only *lazy fill* is performed — data is fetched on user demand, never
    bulk pre-crawled.
  * This proxy is used exclusively by this module; the mobile app's Mapy.cz
    key never shares identity with this scraper.

For production-scale usage, pursue a **Seznam B2B / Mapy.com data license**
(see https://o-seznam.cz/kontakty/) instead of relying on scraping.

Pipeline
--------
1. SEARCH:  GET https://www.firmy.cz/?q={name}+{city}
   - A plain cookie-aware requests.Session with a browser User-Agent. No login
     or warmup is needed — the search page is served directly.
   - Extract the first /detail/{firmId}-{slug}.html link from the search HTML.
   - HTTP status: firmy.cz answers 410 Gone (and 404) for a search with ZERO
     results — that is a genuine no-match (→ None), NOT a transient failure.
     Only 429 (rate limit) and 5xx (server) are retryable.

2. DETAIL:  GET https://www.firmy.cz/detail/{firmId}-{slug}.html
   - Served directly to a plain cookie-aware session; the LocalBusiness JSON-LD
     block carries openingHours (string | list | openingHoursSpecification).
   - HTTP status: a firm removed between search and detail answers 410/404 —
     a genuine "firm gone" no-match (→ None). Only 429 and 5xx are retryable.
   - Seznam can bounce automated traffic from flagged (datacenter) IPs to its
     GDPR consent wall (cmp.seznam.cz, reason=missing). If that happens, route
     requests through FIRMY_PROXY_URL (a residential proxy). _is_consent_wall
     detects the bounce and logs an actionable warning. A residential IP is not
     bounced, so no autologin / consent handshake is performed.

   NOTE: an earlier version "warmed up" the session via the szn.cz autologin
   endpoint — that actively pushed the session INTO the consent wall and broke
   every live fetch. Do not reintroduce it; the plain path below works.

3. NORMALISE + MATCH:
   - normalize_to_osm → OSM grammar string.
   - verify_match → confidence 0-1; reject if below MIN_CONFIDENCE.
"""

from __future__ import annotations

import json
import logging
import math
import re
import threading
import time
from dataclasses import dataclass, field
from html import unescape
from urllib.parse import quote_plus, urlparse

import requests

from ._daily_counter import DailyCounter
from .matcher import _haversine_m, verify_match
from .normalizer import normalize_to_osm

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)

# IMPORTANT: send ONLY a User-Agent. Verified empirically that adding an
# `Accept` header or a multi-language `Accept-Language` (e.g.
# "cs-CZ,cs;q=0.9,en;q=0.8") makes firmy.cz/Seznam 302 the request to the GDPR
# consent wall (login.szn.cz/autologin) instead of serving the page — a UA-only
# request is served directly. Do not add request headers here without re-testing
# a live detail fetch.

_SEARCH_URL = "https://www.firmy.cz/?q={query}"
# NB: do NOT append ?noredirect=1 — that flag suppresses the cookie-wall's
# return redirect. Letting the redirect chain run naturally is what lets a
# (residential-IP) session land on the detail page with its content.
_DETAIL_URL = "https://www.firmy.cz/detail/{firm_id}-{slug}.html"

# Hosts the Seznam GDPR cookie-wall redirects to when consent is missing.
# If a request lands on one of these, we were bounced by the consent wall
# (typically because the request came from a flagged datacenter IP — use
# FIRMY_PROXY_URL with a residential proxy in production).
_CONSENT_WALL_HOSTS = ("cmp.seznam.cz", "cmp.firmy.cz")
# Path token the consent wall uses; matched against the URL PATH only (never the
# query string) so a user-controlled ?q= search term can't false-trigger it.
_CONSENT_WALL_PATH_TOKEN = "nastaveni-souhlasu"

# Minimum confidence required to accept a Firmy.cz result.
# Raised from 0.40 to 0.55 together with the matcher's hard name-similarity gate
# so that geo proximity alone can never clear the acceptance bar (a different
# business at the same geohash cell must be rejected).
MIN_CONFIDENCE = 0.55

# Distance (metres) beyond which a search hit is treated as a different physical
# location and the detail fetch is skipped to save residential-proxy bandwidth.
# Deliberately generous (5 km): the detail page of a given firm_id carries the
# SAME geo as its search card, so geo is stable across search→detail — a hit this
# far away is a same-named business in another city that the detail fetch cannot
# relocate. The threshold is wide enough that GPS drift / coarse geocoding never
# drops a true nearby match; we reject only clearly-different-location hits.
SEARCH_REJECT_DISTANCE_M = 5000

# Hard cap on redirects per request. A hostile/compromised proxy could otherwise
# chain redirects to DoS the worker (requests' default is 30). 10 leaves room for
# the occasional legitimate Seznam consent redirect while staying bounded.
_MAX_REDIRECTS = 10

# Maximum response body we will read into memory before parsing (~2 MB).
# Larger responses are truncated to bound memory; legitimate firmy.cz pages are
# well under this.
_MAX_BODY_BYTES = 2 * 1024 * 1024

# Registered domains whose responses we are willing to parse. The FINAL URL of
# every request (after redirects) must be either the exact domain or a real
# subdomain — a hostile proxy must not be able to redirect us to an arbitrary
# lookalike host and have us parse its JSON-LD.
_ALLOWED_HOST_DOMAINS = ("firmy.cz", "seznam.cz")

# Regex to extract detail links from search page HTML
_DETAIL_RE = re.compile(
    r'href="https://www\.firmy\.cz/detail/(\d+)-([^"]+)\.html"'
)

# Category / tag extraction from the detail page.
#
# The detail page carries a `<div class="detailLists">` with two sibling blocks:
#   <div class="list lcat"> … category <a> links … </div>
#   <div class="list ltag"> … /stitek/{slug} <a> links … </div>
# We FIRST isolate each block up to its closing </div> so we never sweep in the
# page footer (which has its own generic /stitek/ links, e.g.
# /stitek/samosber-jahod, outside the ltag section). The blocks contain no
# nested <div>, so a non-greedy match to the first </div> bounds them cleanly.
_LCAT_BLOCK_RE = re.compile(r'<div class="list lcat">(.*?)</div>', re.DOTALL)
_LTAG_BLOCK_RE = re.compile(r'<div class="list ltag">(.*?)</div>', re.DOTALL)
# Category names are the link texts inside the lcat block.
_CATEGORY_LINK_RE = re.compile(r"<a [^>]*>([^<]+)</a>")
# Tag slugs are the /stitek/{slug} path segments inside the ltag block.
_TAG_SLUG_RE = re.compile(r'/stitek/([^"/?#]+)')

# Rating extraction from the detail page. Firmy.cz renders the same Mapy rating
# badge in the page HTML, e.g. reviewBadgeNew=4,1 + badgeReviewCount.
_RATING_VALUE_RE = re.compile(
    r'<span[^>]*class=["\'][^"\']*\breviewBadgeNew\b[^"\']*["\'][^>]*>\s*([^<]+)\s*</span>',
    re.IGNORECASE,
)
_RATING_COUNT_RE = re.compile(
    r'<span[^>]*class=["\'][^"\']*\bbadgeReviewCount\b[^"\']*["\'][^>]*>\s*([^<]+)\s*</span>',
    re.IGNORECASE,
)
_RATING_LABEL_RE = re.compile(
    r'<span[^>]*class=["\'][^"\']*\bbadgeLabelValue\b[^"\']*["\'][^>]*>\s*([^<]+)\s*</span>',
    re.IGNORECASE,
)
_WHITESPACE_RE = re.compile(r"\s+")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _coerce_coord(*candidates: object) -> float | None:
    """Return the first candidate coercible to a finite float, else None.

    Accepts numbers and numeric strings; a legitimate 0.0 is preserved. Returns
    None when no candidate is a parseable, finite coordinate (None, empty, or
    non-numeric strings all fall through).
    """
    for value in candidates:
        if value is None:
            continue
        try:
            coord = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if math.isfinite(coord):
            return coord
    return None


def _clean_text(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", unescape(value).replace("\xa0", " ")).strip()


# ---------------------------------------------------------------------------
# Public dataclass
# ---------------------------------------------------------------------------


class TransientFetchError(Exception):
    """
    Raised by FirmyHoursSource on a RETRYABLE failure (proxy 502/Bad Gateway,
    connection reset, timeout, or a consent-wall bounce).

    Distinguishing this from a genuine "no confident match" (fetch returns None)
    is the whole point: the caller persists a transient error as status 'error'
    (which is NOT cache-fresh, so the next request re-fetches it), whereas a real
    no-match is persisted as 'unknown' and cached for HOURS_TTL_DAYS. Without this
    split, an intermittent proxy 502 would freeze a pub as a fresh 'unknown' for
    30 days even though the next attempt would have succeeded.
    """


@dataclass
class RawHours:
    """Raw result returned by FirmyHoursSource.fetch()."""

    opening_hours_raw: str | None
    source: str
    source_ref: str | None
    matched_name: str | None
    matched_lat: float | None
    matched_lng: float | None
    confidence: float
    rating_value: float | None = None
    rating_count: int | None = None
    rating_label: str | None = None
    # Firmy.cz category names (link texts) and tag slugs scraped from the detail
    # page, used to classify whether the venue serves draft beer. Default empty
    # so older call sites / fixtures without category data keep working.
    categories: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Daily-cap counter (process-wide, resets at midnight) — shared DailyCounter
# ---------------------------------------------------------------------------

_global_counter = DailyCounter()

# ---------------------------------------------------------------------------
# FirmyHoursSource
# ---------------------------------------------------------------------------


class FirmyHoursSource:
    """
    Fetch opening hours for a pub from Firmy.cz.

    Parameters
    ----------
    session : requests.Session | None
        Supply a pre-configured session (e.g. in tests with a mocked adapter).
        If None, a plain cookie-aware session with a browser User-Agent is
        created (no login / warmup — detail pages are served directly).
    proxy_url : str | None
        HTTP/SOCKS proxy URL for all Firmy.cz requests.
        Example: "http://user:pass@proxy:8888"
    min_interval : float
        Minimum seconds between consecutive HTTP requests (rate limiting).
    timeout : int
        Per-request HTTP timeout in seconds.
    daily_cap : int
        Hard cap on the number of Firmy.cz requests per UTC calendar day.
    min_confidence : float
        Minimum verify_match score required to accept a result.
    """

    def __init__(
        self,
        session: requests.Session | None = None,
        proxy_url: str | None = None,
        min_interval: float = 3.0,
        timeout: int = 15,
        daily_cap: int = 2000,
        min_confidence: float = MIN_CONFIDENCE,
    ) -> None:
        self._min_interval = min_interval
        self._timeout = timeout
        self._daily_cap = daily_cap
        self._min_confidence = min_confidence
        self._last_request_at: float = 0.0
        self._lock = threading.Lock()

        if session is not None:
            self._session = session
            self._owns_session = False
        else:
            self._session = self._build_session(proxy_url)
            self._owns_session = True

        # Cap redirect chains on every session (injected or built) so a
        # hostile/compromised proxy cannot loop us (requests' default is 30).
        self._session.max_redirects = _MAX_REDIRECTS

    # ------------------------------------------------------------------
    # Session construction
    # ------------------------------------------------------------------

    def _build_session(self, proxy_url: str | None) -> requests.Session:
        s = requests.Session()
        s.headers.update({"User-Agent": _BROWSER_UA})
        # Cap redirect chains so a hostile/compromised proxy cannot loop us.
        s.max_redirects = _MAX_REDIRECTS
        if proxy_url:
            s.proxies = {"http": proxy_url, "https": proxy_url}

        # No warmup: a plain cookie-aware session reaches search + detail pages
        # directly. (A previous autologin "warmup" pushed the session into the
        # Seznam consent wall and broke every live fetch — see module docstring.)
        self._session = s
        return s

    # ------------------------------------------------------------------
    # Rate limiting
    # ------------------------------------------------------------------

    def _throttle(self) -> None:
        """Block until min_interval has elapsed since the last request."""
        with self._lock:
            elapsed = time.monotonic() - self._last_request_at
            if elapsed < self._min_interval:
                time.sleep(self._min_interval - elapsed)
            self._last_request_at = time.monotonic()

    def _check_cap(self) -> bool:
        return _global_counter.increment_and_check(self._daily_cap)

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _host_allowed(url: str | None) -> bool:
        """True if *url*'s host is within the firmy.cz / seznam.cz families."""
        if not url:
            return False
        host = (urlparse(url).hostname or "").lower()
        if not host:
            return False
        return any(
            host == domain or host.endswith(f".{domain}")
            for domain in _ALLOWED_HOST_DOMAINS
        )

    @staticmethod
    def _read_bounded_body(resp: requests.Response) -> None:
        """Read at most _MAX_BODY_BYTES of *resp* into resp._content.

        Bounds memory against a hostile/compromised proxy streaming an
        unbounded body. Safe to call on already-materialised responses (e.g.
        test mocks): in that case the existing content is truncated in place.
        """
        existing = resp._content
        if existing is not None and existing is not False:
            # Body already materialised (mock or non-streamed) — just truncate.
            if len(existing) > _MAX_BODY_BYTES:
                logger.warning(
                    "firmy: response body from %s exceeds %d bytes — truncating",
                    resp.url, _MAX_BODY_BYTES,
                )
                resp._content = existing[:_MAX_BODY_BYTES]
            return

        chunks: list[bytes] = []
        total = 0
        try:
            for chunk in resp.iter_content(chunk_size=65536):
                if not chunk:
                    continue
                chunks.append(chunk)
                total += len(chunk)
                if total >= _MAX_BODY_BYTES:
                    logger.warning(
                        "firmy: response body from %s exceeds %d bytes — truncating",
                        resp.url, _MAX_BODY_BYTES,
                    )
                    break
        finally:
            resp._content = b"".join(chunks)[:_MAX_BODY_BYTES]

    def _get(self, url: str, **kwargs) -> requests.Response:
        """Throttled, cap-checked GET request with redirect/size/host guards."""
        if not self._check_cap():
            raise RuntimeError(
                f"firmy: daily request cap of {self._daily_cap} exceeded — "
                "not making further requests today."
            )
        self._throttle()
        kwargs.setdefault("stream", True)
        resp = self._session.get(url, timeout=self._timeout, **kwargs)

        # Reject responses that ended up off the firmy.cz / seznam.cz families
        # (a hostile proxy could redirect us elsewhere). We still return the
        # response object so consent-wall detection (cmp.seznam.cz) keeps
        # working, but we refuse to read/parse a foreign body.
        if not self._host_allowed(resp.url):
            logger.warning(
                "firmy: response final host %r is outside the allowed "
                "firmy.cz/seznam.cz families — not reading body.",
                resp.url,
            )
            resp._content = b""
            return resp

        self._read_bounded_body(resp)
        return resp

    # ------------------------------------------------------------------
    # JSON-LD extraction helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_ld_blocks(html: str) -> list[dict]:
        """Return all parsed JSON-LD blocks from an HTML page."""
        blocks = []
        for raw in re.findall(
            r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            html,
            re.DOTALL,
        ):
            try:
                data = json.loads(raw.strip())
                blocks.append(data)
            except json.JSONDecodeError:
                pass
        return blocks

    @staticmethod
    def _local_business_block(blocks: list[dict]) -> dict | None:
        """Return the first LocalBusiness / Restaurant block."""
        for b in blocks:
            t = b.get("@type", "")
            if isinstance(t, list):
                if any(x in ("LocalBusiness", "Restaurant", "FoodEstablishment", "BarOrPub") for x in t):
                    return b
            elif t in ("LocalBusiness", "Restaurant", "FoodEstablishment", "BarOrPub"):
                return b
        return None

    # ------------------------------------------------------------------
    # Category / tag extraction
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_categories_tags(html: str) -> tuple[list[str], list[str]]:
        """Return (category names, tag slugs) scraped from a detail page.

        Tolerant regex extraction (the repo deliberately avoids BeautifulSoup).
        Each list is restricted to its own ``div.list.lcat`` / ``div.list.ltag``
        block so unrelated footer links (e.g. generic /stitek/ links outside the
        tag section) are never swept in. Missing sections yield empty lists.
        """
        categories: list[str] = []
        lcat_match = _LCAT_BLOCK_RE.search(html)
        if lcat_match:
            for text in _CATEGORY_LINK_RE.findall(lcat_match.group(1)):
                name = text.strip()
                if name:
                    categories.append(name)

        tags: list[str] = []
        ltag_match = _LTAG_BLOCK_RE.search(html)
        if ltag_match:
            for slug in _TAG_SLUG_RE.findall(ltag_match.group(1)):
                slug = slug.strip()
                if slug:
                    tags.append(slug)

        return categories, tags

    @staticmethod
    def _extract_rating(html: str) -> tuple[float | None, int | None, str | None]:
        """Return (rating value, rating count, label) from a detail page."""
        rating_value: float | None = None
        value_match = _RATING_VALUE_RE.search(html)
        if value_match:
            raw_value = _clean_text(value_match.group(1)).replace(",", ".")
            try:
                parsed_value = float(raw_value)
            except ValueError:
                parsed_value = math.nan
            if math.isfinite(parsed_value) and 0.0 <= parsed_value <= 5.0:
                rating_value = parsed_value

        rating_count: int | None = None
        count_match = _RATING_COUNT_RE.search(html)
        if count_match:
            digits = re.sub(r"\D", "", _clean_text(count_match.group(1)))
            if digits:
                rating_count = int(digits)

        rating_label: str | None = None
        label_match = _RATING_LABEL_RE.search(html)
        if label_match:
            rating_label = _clean_text(label_match.group(1)) or None

        return rating_value, rating_count, rating_label

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def _search(self, name: str, city: str | None) -> tuple[str, str, dict] | None:
        """
        Search Firmy.cz and return (firm_id, slug, ld_block) for the first hit,
        or None if nothing was found.
        """
        query = name if not city else f"{name} {city}"
        url = _SEARCH_URL.format(query=quote_plus(query))

        try:
            resp = self._get(url)
        except requests.RequestException as exc:
            # Network / proxy error (no HTTP response) — retryable. Raise so the
            # caller persists 'error' (re-fetched next request) instead of a
            # sticky 'unknown'.
            logger.warning("firmy: search request failed for %r: %s", query, exc)
            raise TransientFetchError(f"search request failed for {query!r}: {exc}") from exc

        # HTTP status semantics: firmy.cz answers 410 Gone (and 404) for searches
        # with ZERO results — the SSR no-results page. That is a GENUINE no-match,
        # not a transient failure: retrying it forever spams logs and burns proxy
        # quota instead of caching 'unknown' for HOURS_TTL_DAYS. So any 4xx EXCEPT
        # 429 means "no result" → return None. 429 (rate limit) and 5xx (server)
        # stay retryable → TransientFetchError.
        if 400 <= resp.status_code < 500 and resp.status_code != 429:
            logger.info(
                "firmy: search for %r returned HTTP %d (no results) — treating as no-match",
                query, resp.status_code,
            )
            return None
        if resp.status_code >= 400:
            logger.warning(
                "firmy: search for %r returned retryable HTTP %d", query, resp.status_code
            )
            raise TransientFetchError(
                f"search for {query!r} returned HTTP {resp.status_code}"
            )

        # SEARCH is the FIRST request, so a flagged/datacenter proxy IP is bounced
        # to the Seznam consent wall HERE (HTTP 200 from cmp.seznam.cz, no detail
        # link). Detect it so it raises (retryable) instead of degrading to a
        # "no results" None → a sticky 30-day 'unknown'. (Mirror of _fetch_detail.)
        if self._is_consent_wall(resp):
            logger.warning(
                "firmy: search for %r was bounced to the Seznam consent wall (%s) — "
                "the proxy IP is likely flagged; use a residential FIRMY_PROXY_URL.",
                query, resp.url,
            )
            raise TransientFetchError(
                f"search for {query!r} bounced to consent wall ({resp.url})"
            )

        html = resp.text

        # Extract first detail link
        m = _DETAIL_RE.search(html)
        if not m:
            logger.debug("firmy: no detail link found for query %r", query)
            return None

        firm_id = m.group(1)
        slug = m.group(2)

        # Also extract LocalBusiness JSON-LD from the search page
        # (contains name + geo, useful for verify_match)
        ld_blocks = self._extract_ld_blocks(html)
        lb = self._local_business_block(ld_blocks)

        return firm_id, slug, lb or {}

    # ------------------------------------------------------------------
    # Detail
    # ------------------------------------------------------------------

    @staticmethod
    def _is_consent_wall(resp: requests.Response) -> bool:
        """True if *resp* was bounced to the Seznam GDPR cookie-wall.

        Matches the parsed hostname / path (NOT the raw URL) so a user-controlled
        query string — e.g. a pub literally named 'nastaveni-souhlasu' reaching
        the ?q= search URL — can never false-trigger the consent detection.
        """
        parsed = urlparse(resp.url or "")
        host = (parsed.hostname or "").lower()
        if host in _CONSENT_WALL_HOSTS:
            return True
        return _CONSENT_WALL_PATH_TOKEN in parsed.path.lower()

    def _fetch_detail(
        self, firm_id: str, slug: str
    ) -> tuple[dict, list[str], list[str], float | None, int | None, str | None] | None:
        """
        Fetch a Firmy.cz detail page and return a tuple of
        (LocalBusiness JSON-LD block, category names, tag slugs, rating value,
        rating count, rating label), or None on failure (no detail content /
        consent wall / firm gone).
        """
        url = _DETAIL_URL.format(firm_id=firm_id, slug=slug)
        try:
            resp = self._get(url)
        except requests.RequestException as exc:
            # Network / proxy error (no HTTP response) — retryable.
            logger.warning("firmy: detail request failed for %s/%s: %s", firm_id, slug, exc)
            raise TransientFetchError(
                f"detail request failed for {firm_id}/{slug}: {exc}"
            ) from exc

        # HTTP status semantics (mirror of _search): a firm removed between the
        # search and detail fetch answers 410 Gone (or 404). That is a genuine
        # "firm gone" no-match → return None, not a retry. Any 4xx EXCEPT 429 is a
        # no-match; 429 (rate limit) and 5xx (server) stay retryable.
        if 400 <= resp.status_code < 500 and resp.status_code != 429:
            logger.info(
                "firmy: detail for firm %s returned HTTP %d (gone) — treating as no-match",
                firm_id, resp.status_code,
            )
            return None
        if resp.status_code >= 400:
            logger.warning(
                "firmy: detail for firm %s returned retryable HTTP %d",
                firm_id, resp.status_code,
            )
            raise TransientFetchError(
                f"detail for firm {firm_id} returned HTTP {resp.status_code}"
            )

        # If the cookie-wall bounced us to the consent page we never reached the
        # detail content. With a residential proxy this should not happen; when it
        # does it is a transient proxy-rotation flag, so treat it as retryable
        # (raise) rather than caching a sticky 'unknown' for 30 days.
        if self._is_consent_wall(resp):
            logger.warning(
                "firmy: detail for firm %s was bounced to the Seznam consent wall "
                "(%s). Consent could not be established for this session — in "
                "production route requests through FIRMY_PROXY_URL (residential).",
                firm_id,
                resp.url,
            )
            raise TransientFetchError(
                f"detail for firm {firm_id} bounced to consent wall ({resp.url})"
            )

        html = resp.text
        ld_blocks = self._extract_ld_blocks(html)
        lb = self._local_business_block(ld_blocks)
        if lb is None:
            return None
        categories, tags = self._extract_categories_tags(html)
        rating_value, rating_count, rating_label = self._extract_rating(html)
        return lb, categories, tags, rating_value, rating_count, rating_label

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def fetch(
        self,
        name: str,
        lat: float,
        lng: float,
        city: str | None = None,
    ) -> RawHours | None:
        """
        Fetch opening hours for a pub from Firmy.cz.

        Returns
        -------
        RawHours | None
            RawHours with opening_hours_raw=None if the pub was found but has
            no published hours.  Returns None if no confident match was found.

        Raises
        ------
        RuntimeError
            Daily request cap exceeded.
        TransientFetchError
            A retryable network/proxy/consent-wall failure — the caller should
            persist 'error' (re-fetched next request), not a sticky 'unknown'.
        """
        try:
            return self._fetch_inner(name, lat, lng, city)
        except (RuntimeError, TransientFetchError):
            # Daily cap exceeded, or a retryable fetch failure — propagate so the
            # caller distinguishes it from a genuine no-match (None).
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("firmy: unexpected error fetching %r: %s", name, exc, exc_info=True)
            return None

    def _fetch_inner(
        self,
        name: str,
        lat: float,
        lng: float,
        city: str | None,
    ) -> RawHours | None:
        # Step 1: Search
        result = self._search(name, city)
        if result is None:
            return None

        firm_id, slug, search_lb = result
        if self._search_hit_is_geographically_distant(lat, lng, search_lb):
            logger.debug(
                "firmy: search hit for firm %s is geographically distant — "
                "skipping detail fetch to save proxy bandwidth",
                firm_id,
            )
            return None

        # Step 2: Fetch detail
        detail = self._fetch_detail(firm_id, slug)
        if detail is None:
            logger.debug("firmy: no LocalBusiness block on detail page for firm %s", firm_id)
            return None
        detail_lb, categories, tags, rating_value, rating_count, rating_label = detail

        # Step 3: Extract candidate metadata
        c_name: str = detail_lb.get("name") or search_lb.get("name") or ""
        geo = detail_lb.get("geo") or search_lb.get("geo") or {}
        c_lat: float | None = None
        c_lng: float | None = None
        try:
            c_lat = float(geo.get("latitude") or geo.get("lat") or 0) or None
            c_lng = float(geo.get("longitude") or geo.get("lng") or 0) or None
        except (TypeError, ValueError):
            pass

        # Step 4: Verify match
        confidence = verify_match(name, lat, lng, c_name, c_lat, c_lng)
        if confidence < self._min_confidence:
            logger.debug(
                "firmy: low confidence %.2f for %r → %r (firm %s) — discarding",
                confidence, name, c_name, firm_id,
            )
            return None

        # Step 5: Normalise opening hours
        raw_oh = detail_lb.get("openingHours") or detail_lb.get("openingHoursSpecification")
        osm_hours = normalize_to_osm(raw_oh)

        return RawHours(
            opening_hours_raw=osm_hours,
            source="firmy",
            source_ref=firm_id,
            matched_name=c_name or None,
            matched_lat=c_lat,
            matched_lng=c_lng,
            confidence=confidence,
            rating_value=rating_value,
            rating_count=rating_count,
            rating_label=rating_label,
            categories=categories,
            tags=tags,
        )

    def _search_hit_is_geographically_distant(
        self,
        lat: float,
        lng: float,
        search_lb: dict,
    ) -> bool:
        """Return True when the search hit is far enough to be a different place.

        A geo-only pre-filter: the detail page of a given firm_id carries the
        SAME coordinates as its search card, so a hit that is geographically
        distant from the query is a same-named business in another city that the
        detail fetch cannot relocate — skipping it is safe and saves proxy
        bandwidth. We never reject on the (possibly truncated/parent) search
        NAME, because the authoritative gate prefers the better detail name.

        Coords are parsed robustly; if they cannot be parsed we return False so
        the caller falls through to the detail fetch — the safe default.
        """
        geo = search_lb.get("geo")
        if not isinstance(geo, dict):
            return False

        c_lat = _coerce_coord(geo.get("latitude"), geo.get("lat"))
        c_lng = _coerce_coord(geo.get("longitude"), geo.get("lng"))
        if c_lat is None or c_lng is None:
            return False

        return _haversine_m(lat, lng, c_lat, c_lng) > SEARCH_REJECT_DISTANCE_M

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------

    def __enter__(self) -> FirmyHoursSource:
        return self

    def __exit__(self, *_: object) -> None:
        if self._owns_session:
            self._session.close()
