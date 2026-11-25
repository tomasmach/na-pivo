"""Copy Google Search Console's search results for na-pivo.cz into ``SearchConsoleDaily``.

Each run replaces the days since shortly before the previous run, since Google keeps
adjusting recent days; the first run copies all 16 months Google still has.
"""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from urllib.parse import quote

from django.conf import settings
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

from pubs.models import SearchConsoleDaily

logger = logging.getLogger(__name__)

SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
API = "https://searchconsole.googleapis.com/webmasters/v3/sites/{site}/searchAnalytics/query"
HISTORY_DAYS = 486
REFRESH_DAYS = 10
SYNC_EVERY = timedelta(hours=6)
ROW_LIMIT = 25000
TIMEOUT = 30

Kind = SearchConsoleDaily.Kind


def configured() -> bool:
    return bool(settings.SEARCH_CONSOLE_SERVICE_ACCOUNT and settings.SEARCH_CONSOLE_SITE)


def due(now=None) -> bool:
    last = SearchConsoleDaily.objects.aggregate(at=Max("synced_at"))["at"]
    return last is None or (now or timezone.now()) - last >= SYNC_EVERY


def session() -> AuthorizedSession:
    info = json.loads(settings.SEARCH_CONSOLE_SERVICE_ACCOUNT)
    return AuthorizedSession(service_account.Credentials.from_service_account_info(info, scopes=[SCOPE]))


def _rows(http, start: date, end: date, dimensions: list[str]) -> list[dict]:
    url = API.format(site=quote(settings.SEARCH_CONSOLE_SITE, safe=""))
    rows: list[dict] = []
    while True:
        response = http.post(
            url,
            json={
                "startDate": start.isoformat(),
                "endDate": end.isoformat(),
                "dimensions": dimensions,
                "type": "web",
                "dataState": "final",
                "rowLimit": ROW_LIMIT,
                "startRow": len(rows),
            },
            timeout=TIMEOUT,
        )
        response.raise_for_status()
        batch = response.json().get("rows", [])
        rows += batch
        if len(batch) < ROW_LIMIT:
            return rows


def sync(http, today: date | None = None) -> int:
    """Replace the days from the refresh window on with what Google reports now. Returns rows written."""

    today = today or timezone.localdate()
    oldest = today - timedelta(days=HISTORY_DAYS)
    last = SearchConsoleDaily.objects.aggregate(at=Max("synced_at"))["at"]
    start = oldest if last is None else max(oldest, min(today, timezone.localdate(last)) - timedelta(days=REFRESH_DAYS))
    now = timezone.now()
    fresh: list[SearchConsoleDaily] = []
    for kind, dimensions in ((Kind.TOTAL, ["date"]), (Kind.QUERY, ["date", "query"]), (Kind.PAGE, ["date", "page"])):
        for row in _rows(http, start, today, dimensions):
            keys = row.get("keys", [])
            fresh.append(
                SearchConsoleDaily(
                    day=date.fromisoformat(keys[0]),
                    kind=kind,
                    key=keys[1][:300] if len(keys) > 1 else "",
                    clicks=int(row.get("clicks", 0)),
                    impressions=int(row.get("impressions", 0)),
                    position=float(row.get("position", 0)),
                    synced_at=now,
                )
            )
    with transaction.atomic():
        SearchConsoleDaily.objects.filter(day__gte=start).delete()
        SearchConsoleDaily.objects.bulk_create(fresh, batch_size=2000)
        if not fresh:
            # A day with no search results still marks the sync done, so the worker does not ask every 5 minutes.
            SearchConsoleDaily.objects.create(day=today, kind=Kind.TOTAL, synced_at=now)
    return len(fresh)
