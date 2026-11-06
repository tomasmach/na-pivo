"""Pub reach: how often a pub is seen on the map, opened and navigated to, in the app and on the web.

Counts are kept per pub, Prague day, channel and metric (``PubReachDaily``). The
app also keeps which accounts did it (``PubReachVisitor``, a keyed hash), so the
distinct people over any range are counted once. The web keeps no visitor at all,
no cookie, IP or fingerprint, so it needs no consent banner and counts visits only.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import connection
from django.db.models import Count, Exists, F, OuterRef, Sum
from django.utils import timezone

from pubs.models import (
    CanonicalPub,
    PubDirectory,
    PubHours,
    PubReach,
    PubReachDaily,
    PubReachVisitor,
    UserAddedPub,
)

PRAGUE = ZoneInfo("Europe/Prague")
CACHE_KEY_RE = re.compile(r"^[0-9b-hjkmnp-z]{8}$")
# An app batch flushed after the phone slept still lands on the day it happened.
MAX_EVENT_AGE = timedelta(days=2)

APP = PubReachDaily.Channel.APP
WEB = PubReachDaily.Channel.WEB

_SEARCH_HOSTS = (
    ("google", re.compile(r"(^|\.)google\.[a-z.]+$|^com\.google\.android\.")),
    ("seznam", re.compile(r"(^|\.)seznam\.cz$|^cz\.seznam\.")),
    ("bing", re.compile(r"(^|\.)bing\.com$")),
    (
        "other_search",
        re.compile(
            r"(^|\.)(duckduckgo\.com|search\.yahoo\.com|ecosia\.org|yandex\.[a-z]+|search\.brave\.com"
            r"|startpage\.com|qwant\.com|perplexity\.ai|chatgpt\.com)$"
        ),
    ),
)
# Crawlers that run JavaScript still say who they are; everything else has to run the page's script.
_BOT_UA = re.compile(
    r"bot|crawl|spider|slurp|archiver|facebookexternalhit|embedly|preview|headless|lighthouse"
    r"|pagespeed|phantomjs|puppeteer|playwright|selenium|python|curl|wget|httpclient|okhttp|java/|go-http",
    re.IGNORECASE,
)


def reach_day(moment: datetime) -> date:
    return timezone.localdate(moment, PRAGUE)


def visitor_id(account_pk: int) -> int:
    """Stable keyed hash of an account; the reach tables never hold the account itself."""

    digest = hmac.new(str(settings.SECRET_KEY).encode(), f"pub-reach:{account_pk}".encode(), hashlib.sha256).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


def is_bot(user_agent: str) -> bool:
    return not user_agent or bool(_BOT_UA.search(user_agent))


def web_source(referrer: str, own_hosts: set[str]) -> str:
    """Where a web visit came from, from the referrer's host only."""

    referrer = (referrer or "").strip()
    if not referrer:
        return "direct"
    host = (urlsplit(referrer).hostname or "").lower()
    if not host:
        return "direct"
    if host in own_hosts:
        return "internal"
    for source, pattern in _SEARCH_HOSTS:
        if pattern.search(host):
            return source
    return "link"


@dataclass(frozen=True)
class ReachEvent:
    cache_key: str
    day: date
    metric: str
    source: str = ""


def record(events: list[ReachEvent], channel: str, visitor: int | None = None) -> None:
    """Add events to the daily counts, and the visitor to the pubs it reached that day.

    Run it inside a transaction. The app caller holds the account's row lock, so the
    check for a visitor already counted that day cannot race another batch.
    """

    if not events:
        return
    counts = Counter((e.cache_key, e.day, e.metric, e.source) for e in events)
    new_visitors: set[tuple[str, date, str]] = set()
    if visitor is not None:
        reached = {(e.cache_key, e.day, e.metric) for e in events}
        known = set(
            PubReachVisitor.objects.filter(
                visitor=visitor,
                day__in={day for _, day, _ in reached},
                cache_key__in={key for key, _, _ in reached},
            ).values_list("cache_key", "day", "metric")
        )
        new_visitors = reached - known
        PubReachVisitor.objects.bulk_create(
            [PubReachVisitor(cache_key=k, day=d, metric=m, visitor=visitor) for k, d, m in sorted(new_visitors)],
            ignore_conflicts=True,
        )

    rows = [
        (key, connection.ops.adapt_datefield_value(day), channel, metric, source, count,
         1 if (key, day, metric) in new_visitors else 0)
        for (key, day, metric, source), count in sorted(counts.items())
    ]
    table = connection.ops.quote_name(PubReachDaily._meta.db_table)
    values = ", ".join(["(%s, %s, %s, %s, %s, %s, %s)"] * len(rows))
    # One statement for the whole batch; PostgreSQL and SQLite share this upsert syntax.
    # Rows go in one fixed order so two batches cannot lock them crosswise.
    with connection.cursor() as cursor:
        cursor.execute(
            f"INSERT INTO {table} (cache_key, day, channel, metric, source, count, visitors) VALUES {values} "
            "ON CONFLICT (cache_key, day, channel, metric, source) DO UPDATE SET "
            f"count = {table}.count + excluded.count, visitors = {table}.visitors + excluded.visitors",
            [value for row in rows for value in row],
        )


def merge_accounts(source_pk: int, target_pk: int) -> None:
    """Count a merged account as the account it joined, once per pub, day and metric.

    The merge holds both account locks, which the app batch also takes, so no batch
    can add rows for either hash meanwhile.
    """

    source, target = visitor_id(source_pk), visitor_id(target_pk)
    moving = PubReachVisitor.objects.filter(visitor=source)
    both = moving.filter(
        Exists(
            PubReachVisitor.objects.filter(
                visitor=target, cache_key=OuterRef("cache_key"), day=OuterRef("day"), metric=OuterRef("metric")
            )
        )
    )
    # Same row order as record(), so a merge and a batch cannot lock the counts crosswise.
    for key, day, metric in both.order_by("cache_key", "day", "metric").values_list("cache_key", "day", "metric"):
        PubReachDaily.objects.filter(
            cache_key=key, day=day, channel=APP, metric=metric, source="", visitors__gt=0
        ).update(visitors=F("visitors") - 1)
    both.delete()
    moving.update(visitor=target)


def forget_account(account_pk: int) -> None:
    """Remove which pubs a deleted account reached; the counts stay, they name nobody."""

    PubReachVisitor.objects.filter(visitor=visitor_id(account_pk)).delete()


# ---------- the admin report ----------

APP_LABELS = {
    PubReach.MAP_IMPRESSION: "Pin na mapě v zorném poli",
    PubReach.DETAIL_VIEW: "Otevřený detail hospody",
    PubReach.NAVIGATION: "Klik na navigaci",
}
WEB_LABELS = {PubReach.DETAIL_VIEW: "Zobrazená stránka hospody", PubReach.NAVIGATION: "Klik na navigaci"}
SOURCE_LABELS = {
    "google": "Google",
    "seznam": "Seznam",
    "bing": "Bing",
    "other_search": "Jiný vyhledávač",
    "direct": "Přímo, bez odkazu",
    "internal": "Z jiné stránky na-pivo.cz",
    "link": "Odkaz z jiného webu",
}


def visitor_history_start(today: date) -> date:
    return today - timedelta(days=settings.PUB_REACH_VISITOR_RETENTION_DAYS)


def pub_names(keys: set[str]) -> dict[str, str]:
    names: dict[str, str] = {}
    for model in (PubDirectory, UserAddedPub, PubHours, CanonicalPub):
        names.update(model.objects.filter(cache_key__in=keys).values_list("cache_key", "name"))
    return names


def find_pubs(query: str, limit: int = 20) -> list[tuple[str, str]]:
    """(cache_key, name) of pubs whose name contains the query, or the pub with that key."""

    query = query.strip()
    if CACHE_KEY_RE.match(query.lower()):
        key = query.lower()
        return [(key, pub_names({key}).get(key, ""))]
    found: dict[str, str] = {}
    for model in (CanonicalPub, PubDirectory, UserAddedPub, PubHours):
        for key, name in model.objects.filter(name__icontains=query).values_list("cache_key", "name")[:limit]:
            found.setdefault(key, name)
    return sorted(found.items(), key=lambda item: item[1])[:limit]


def pub_report(cache_key: str, start: date, end: date, today: date) -> dict:
    """Totals, distinct app visitors and day rows of one pub between start and end, both included."""

    daily = PubReachDaily.objects.filter(cache_key=cache_key, day__gte=start, day__lte=end)
    totals = {
        (row["channel"], row["metric"]): row["count"]
        for row in daily.values("channel", "metric").annotate(count=Sum("count"))
    }
    visitors = PubReachVisitor.objects.filter(cache_key=cache_key, day__gte=start, day__lte=end)
    app_visitors = dict(visitors.values("metric").annotate(n=Count("visitor", distinct=True)).values_list("metric", "n"))
    sources = Counter()
    for source, metric, count in daily.filter(channel=WEB).values_list("source", "metric").annotate(n=Sum("count")):
        sources[(source, metric)] = count

    days: dict[date, dict] = {}
    for day, channel, metric, count, people in daily.values_list("day", "channel", "metric").annotate(
        n=Sum("count"), v=Sum("visitors")
    ):
        row = days.setdefault(day, {"day": day})
        row[f"{channel}_{metric}"] = count
        if channel == APP:
            row[f"app_{metric}_visitors"] = people

    return {
        "app": [
            {
                "metric": metric,
                "label": label,
                "count": totals.get((APP, metric), 0),
                "visitors": app_visitors.get(metric, 0),
            }
            for metric, label in APP_LABELS.items()
        ],
        "app_visitors_any": visitors.aggregate(n=Count("visitor", distinct=True))["n"],
        "web": [
            {"metric": metric, "label": label, "count": totals.get((WEB, metric), 0)}
            for metric, label in WEB_LABELS.items()
        ],
        "web_sources": [
            {
                "source": SOURCE_LABELS[source],
                "views": sources.get((source, PubReach.DETAIL_VIEW), 0),
                "navigation": sources.get((source, PubReach.NAVIGATION), 0),
            }
            for source in SOURCE_LABELS
            if sources.get((source, PubReach.DETAIL_VIEW)) or sources.get((source, PubReach.NAVIGATION))
        ],
        "days": [days[day] for day in sorted(days, reverse=True)],
        "visitors_complete": start >= visitor_history_start(today),
    }


def top_pubs(start: date, end: date, limit: int = 50) -> list[dict]:
    """The pubs with the most reach in the range, for picking one to show its numbers."""

    rows = (
        PubReachDaily.objects.filter(day__gte=start, day__lte=end)
        .values("cache_key")
        .annotate(total=Sum("count"))
        .order_by("-total", "cache_key")[:limit]
    )
    keys = [row["cache_key"] for row in rows]
    per_metric: dict[str, dict] = {key: {} for key in keys}
    for key, channel, metric, count in (
        PubReachDaily.objects.filter(day__gte=start, day__lte=end, cache_key__in=keys)
        .values_list("cache_key", "channel", "metric")
        .annotate(n=Sum("count"))
    ):
        per_metric[key][f"{channel}_{metric}"] = count
    names = pub_names(set(keys))
    return [{"cache_key": key, "name": names.get(key, ""), **per_metric[key]} for key in keys]
