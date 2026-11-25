"""Web analytics: which pages of na-pivo.cz people open, where they came from and what Google shows them.

Every web page reports its view and a tap on a store link (``/web/stats``). Per
Prague day only the page, its language, the kind of referrer and its host, the
link's campaign and whether it is an iPhone, an Android phone or anything else
are counted. No cookie, address or browser detail is kept, so it needs no
consent banner and counts visits, not people.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import asdict, dataclass, replace
from datetime import date, timedelta
from urllib.parse import urlsplit

from django.db import connection
from django.db.models import F, FloatField, Max, Min, Sum
from django.db.models.functions import Cast
from django.urls import Resolver404, resolve

from pubs import pub_reach
from pubs.models import SearchConsoleDaily, WebStatsDaily
from pubs.web.routes import EN_SUFFIX, base_name

VIEW = WebStatsDaily.Metric.VIEW
STORE_IOS = WebStatsDaily.Metric.STORE_IOS
STORE_ANDROID = WebStatsDaily.Metric.STORE_ANDROID
NOT_FOUND = "not_found"
SEARCH = {"google", "seznam", "bing", "other_search"}
# Sources whose host says more than the kind does.
_HOST_SOURCES = {"link", "social", "ai", "other_search"}
# Public content pages whose address is worth keeping; the rest are counted by page only.
CONTENT_PAGES = {
    "web-pub", "web-pubs-city", "beer", "beer-brand", "beer-prices-city", "web-rankings-region", "web-tour",
}
_HOST_PREFIXES = ("www.", "lm.", "l.", "m.")
_CAMPAIGN_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,47}$")

PAGE_LABELS = {
    "home": "Úvod",
    "web-pub": "Hospoda",
    "web-pubs": "Hospody",
    "web-pubs-city": "Hospody ve městě",
    "beer-prices": "Ceny piva",
    "beer-prices-city": "Ceny piva ve městě",
    "beer-list": "Piva",
    "beer": "Pivo",
    "beer-brand": "Značka piva",
    "web-rankings": "Žebříčky",
    "web-rankings-region": "Žebříček kraje",
    "web-news": "Novinky",
    "web-tours": "Trasy",
    "web-tour": "Trasa",
    "web-beer-index": "Pivní index",
    "web-about": "O appce",
    "web-search": "Hledání",
    "web-privacy": "Ochrana soukromí",
    "web-terms": "Podmínky",
    "public-profile": "Veřejný profil",
    "pub-share-landing": "Sdílená hospoda z appky",
    "friend-invite-landing": "Pozvánka od kamaráda",
    "party-invite-landing": "Pozvánka do party",
    "tour-invite-landing": "Pozvánka na tour",
    "web-plan-invite": "Pozvánka na plán",
    "web-login": "Přihlášení",
    "web-register": "Registrace",
    "web-diary": "Deník",
    "web-delete-account": "Smazání účtu",
    NOT_FOUND: "Neexistující stránka (404)",
}
DEVICE_LABELS = {"ios": "iPhone a iPad", "android": "Android", "desktop": "Počítač a ostatní"}
LANG_LABELS = {"cs": "Česky", "en": "Anglicky"}
INTERNAL_LABEL = "Proklik uvnitř webu"


@dataclass(frozen=True)
class Hit:
    day: date
    page: str
    path: str
    lang: str
    metric: str
    source: str
    referrer: str
    campaign: str
    device: str


def page_of(path: str, missing: bool) -> tuple[str, str, str] | None:
    """(page, kept path, language) of a web address, or None when it is not a web page."""

    if not path.startswith("/") or len(path) > 300:
        return None
    lang = "en" if path == "/en" or path.startswith("/en/") else "cs"
    if missing:
        return NOT_FOUND, "", lang
    try:
        match = resolve(path)
    except Resolver404:
        return NOT_FOUND, "", lang
    name = match.url_name or ""
    if not name or name.startswith("admin") or match.app_name or path.startswith(("/v1/", "/web/")):
        return None
    page = base_name(name)
    if name.endswith(EN_SUFFIX):
        lang = "en"
    kept = path[:160] if page in CONTENT_PAGES else ""
    return page, kept, lang


def device_of(user_agent: str) -> str:
    agent = user_agent.lower()
    if "iphone" in agent or "ipad" in agent or "ipod" in agent:
        return "ios"
    if "android" in agent:
        return "android"
    return "desktop"


def campaign_of(value: str) -> str:
    value = (value or "").strip().lower()[:48]
    return value if _CAMPAIGN_RE.match(value) else ""


def referrer_host(referrer: str, source: str) -> str:
    if source not in _HOST_SOURCES:
        return ""
    host = (urlsplit((referrer or "").strip()).hostname or "").lower()
    # l.facebook.com, lm.facebook.com and m.facebook.com are all Facebook.
    for prefix in _HOST_PREFIXES:
        if host.startswith(prefix) and host.count(".") > 1:
            host = host.removeprefix(prefix)
            break
    return host[:100]


MAX_ROWS_PER_DAY = 5000


def _day_is_full(hit: Hit) -> bool:
    return (
        not WebStatsDaily.objects.filter(**asdict(hit)).exists()
        and WebStatsDaily.objects.filter(day=hit.day).count() >= MAX_ROWS_PER_DAY
    )


def record(hit: Hit) -> None:
    if _day_is_full(hit):
        hit = replace(hit, path="", referrer="", campaign="")
    table = connection.ops.quote_name(WebStatsDaily._meta.db_table)
    # PostgreSQL and SQLite share this upsert syntax.
    with connection.cursor() as cursor:
        cursor.execute(
            f"INSERT INTO {table} (day, page, path, lang, metric, source, referrer, campaign, device, count) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 1) "
            "ON CONFLICT (day, page, path, lang, metric, source, referrer, campaign, device) "
            f"DO UPDATE SET count = {table}.count + 1",
            [
                connection.ops.adapt_datefield_value(hit.day), hit.page, hit.path, hit.lang, hit.metric,
                hit.source, hit.referrer, hit.campaign, hit.device,
            ],
        )


def _empty() -> dict:
    return {"views": 0, "entrances": 0, "search": 0, "google": 0, "store_ios": 0, "store_android": 0}


def _add(bucket: dict, metric: str, source: str, n: int) -> None:
    if metric == VIEW:
        bucket["views"] += n
        if source != "internal":
            bucket["entrances"] += n
        if source in SEARCH:
            bucket["search"] += n
        if source == "google":
            bucket["google"] += n
    elif metric == STORE_IOS:
        bucket["store_ios"] += n
    elif metric == STORE_ANDROID:
        bucket["store_android"] += n


def _finish(bucket: dict) -> dict:
    store = bucket["store_ios"] + bucket["store_android"]
    rate = round(100 * store / bucket["entrances"], 1) if bucket["entrances"] else None
    return {**bucket, "store": store, "store_rate": rate}


def _sorted(groups: dict, limit: int | None = None) -> list[dict]:
    rows = sorted(
        ({"key": k, **_finish(v)} for k, v in groups.items()), key=lambda r: (-r["views"], -r["store"], str(r["key"]))
    )
    return rows[:limit] if limit else rows


def _web_totals(start: date, end: date) -> dict:
    bucket = _empty()
    for metric, source, n in (
        WebStatsDaily.objects.filter(day__range=(start, end))
        .values_list("metric", "source")
        .annotate(n=Sum("count"))
        .order_by()
    ):
        _add(bucket, metric, source, n)
    return _finish(bucket)


def _search_row(clicks: int, impressions: int, weighted: float) -> dict:
    return {
        "clicks": clicks,
        "impressions": impressions,
        "ctr": round(100 * clicks / impressions, 1) if impressions else None,
        "position": round(weighted / impressions, 1) if impressions else None,
    }


def _weighted() -> dict:
    return {"c": Sum("clicks"), "i": Sum("impressions"), "w": Sum(F("position") * Cast("impressions", FloatField()))}


def _search_totals(start: date, end: date) -> dict:
    totals = SearchConsoleDaily.objects.filter(kind=SearchConsoleDaily.Kind.TOTAL, day__range=(start, end)).aggregate(
        **_weighted()
    )
    return _search_row(totals["c"] or 0, totals["i"] or 0, totals["w"] or 0)


def _search_top(kind: str, start: date, end: date, limit: int = 50) -> list[dict]:
    rows = (
        SearchConsoleDaily.objects.filter(kind=kind, day__range=(start, end))
        .values("key")
        .annotate(**_weighted())
        .order_by("-c", "-i", "key")[:limit]
    )
    return [
        {"key": r["key"], "path": urlsplit(r["key"]).path or "/", **_search_row(r["c"], r["i"], r["w"] or 0)}
        for r in rows
    ]


WEB_HEADLINE = (
    ("views", "Otevření stránek", "count"),
    ("entrances", "Příchody na web", "count"),
    ("search", "Příchody z vyhledávačů", "count"),
    ("google", "Příchody z Googlu", "count"),
    ("store_ios", "Klepnutí na App Store", "count"),
    ("store_android", "Klepnutí na Google Play", "count"),
    ("store_rate", "Klepnutí do storu na 100 příchodů", "rate"),
)
SEARCH_HEADLINE = (
    ("impressions", "Ukázáno ve výsledcích Googlu", "count"),
    ("clicks", "Kliky z výsledků Googlu", "count"),
    ("ctr", "Míra prokliku (CTR, %)", "rate"),
    ("position", "Průměrná pozice", "rate"),
)


def _windows(start: date, end: date, last_day: date | None, first_day: date | None) -> dict | None:
    """The part of the range that has complete data, and the equally long range just before it.

    The before range is None when it reaches back before the data starts, so a missing
    week does not pass for a week of zeros.
    """

    if last_day is not None and last_day < end:
        end = last_day
    if first_day is None or end < start:
        return None
    length = (end - start).days + 1
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=length - 1)
    previous = (previous_start, previous_end) if previous_start >= first_day else None
    return {"now": (start, end), "before": previous}


def _compare(windows: dict | None, totals, spec) -> dict | None:
    if windows is None:
        return None
    now = totals(*windows["now"])
    before = totals(*windows["before"]) if windows["before"] else None
    rows = []
    for key, label, kind in spec:
        then = before[key] if before else None
        change = round(100 * (now[key] - then) / then) if kind == "count" and then else None
        rows.append({"label": label, "now": now[key], "before": then, "change": change})
    return {**windows, "rows": rows}


def _periods(start: date, end: date) -> list[tuple[date, date]]:
    """Days of the range, newest first; weeks from Monday once the range is longer than two months."""

    if (end - start).days < 62:
        return [(end - timedelta(days=n), end - timedelta(days=n)) for n in range((end - start).days + 1)]
    periods, cursor = [], end
    while cursor >= start:
        monday = max(cursor - timedelta(days=cursor.weekday()), start)
        periods.append((monday, cursor))
        cursor = monday - timedelta(days=1)
    return periods


def report(start: date, end: date, today: date) -> dict:
    """Everything the admin page shows for one range."""

    rows = (
        WebStatsDaily.objects.filter(day__range=(start, end))
        .values_list("day", "page", "path", "lang", "metric", "source", "referrer", "campaign", "device")
        .annotate(n=Sum("count"))
        .order_by()
    )
    days, sources, referrers, campaigns = defaultdict(_empty), defaultdict(_empty), defaultdict(_empty), defaultdict(_empty)
    pages, paths, devices, langs = defaultdict(_empty), defaultdict(_empty), defaultdict(_empty), defaultdict(_empty)
    path_pages: dict[str, str] = {}
    for day, page, path, lang, metric, source, referrer, campaign, device, n in rows:
        _add(days[day], metric, source, n)
        _add(sources[source], metric, source, n)
        _add(pages[page], metric, source, n)
        _add(devices[device], metric, source, n)
        _add(langs[lang], metric, source, n)
        if referrer:
            _add(referrers[referrer], metric, source, n)
        if campaign:
            _add(campaigns[campaign], metric, source, n)
        if path:
            _add(paths[path], metric, source, n)
            path_pages[path] = page

    first_day = WebStatsDaily.objects.order_by("day").values_list("day", flat=True).first()
    totals = SearchConsoleDaily.objects.filter(kind=SearchConsoleDaily.Kind.TOTAL)
    search_span = totals.aggregate(first=Min("day"), last=Max("day"), at=Max("synced_at"))
    google_days = dict(totals.filter(day__range=(start, end)).values_list("day", "impressions"))
    google_clicks = dict(totals.filter(day__range=(start, end)).values_list("day", "clicks"))

    period_rows = []
    for period_start, period_end in _periods(start, end):
        bucket = _empty()
        for offset in range((period_end - period_start).days + 1):
            for key, value in days.get(period_start + timedelta(days=offset), _empty()).items():
                bucket[key] += value
        measured = first_day is not None and period_end >= first_day
        span = [period_start + timedelta(days=n) for n in range((period_end - period_start).days + 1)]
        reported = [day for day in span if day in google_days]
        period_rows.append({
            "start": period_start,
            "end": period_end,
            "web": _finish(bucket) if measured else None,
            "g_impressions": sum(google_days[d] for d in reported) if reported else None,
            "g_clicks": sum(google_clicks[d] for d in reported) if reported else None,
        })
    peak = max([row["web"]["views"] for row in period_rows if row["web"]] + [1])
    for row in period_rows:
        row["bar"] = round(100 * row["web"]["views"] / peak) if row["web"] and row["web"]["views"] else 0

    yesterday = today - timedelta(days=1)
    web_last = yesterday if start <= yesterday < end else None
    source_rows = [
        {**row, "label": INTERNAL_LABEL if row["key"] == "internal" else pub_reach.SOURCE_LABELS.get(row["key"], row["key"])}
        for row in _sorted(sources)
    ]
    return {
        "web": _compare(_windows(start, end, web_last, first_day), _web_totals, WEB_HEADLINE),
        "google": _compare(
            _windows(start, end, search_span["last"], search_span["first"]), _search_totals, SEARCH_HEADLINE
        ),
        "weekly": (end - start).days >= 62,
        "periods": period_rows,
        "sources": sorted(source_rows, key=lambda row: row["key"] == "internal"),
        "referrers": _sorted(referrers, 40),
        "campaigns": _sorted(campaigns, 40),
        "pages": [{**row, "label": PAGE_LABELS.get(row["key"], row["key"])} for row in _sorted(pages)],
        "paths": [{**row, "label": PAGE_LABELS.get(path_pages[row["key"]], "")} for row in _sorted(paths, 60)],
        "devices": [{**row, "label": DEVICE_LABELS.get(row["key"], row["key"])} for row in _sorted(devices)],
        "langs": [{**row, "label": LANG_LABELS.get(row["key"], row["key"])} for row in _sorted(langs)],
        "queries": _search_top(SearchConsoleDaily.Kind.QUERY, start, end),
        "search_pages": _search_top(SearchConsoleDaily.Kind.PAGE, start, end),
        "search_last_day": search_span["last"],
        "search_synced_at": search_span["at"],
        "first_day": first_day,
    }
