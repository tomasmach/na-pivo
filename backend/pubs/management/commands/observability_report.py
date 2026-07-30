"""Print an LLM-friendly observability and product-feedback report."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Count, Sum
from django.utils import timezone

from pubs.api.stats import drinking_day
from pubs.models import AccountUsageStats, ClientEvent, DrinkLog, FeedbackReport

_EMAIL_RE = re.compile(r"[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[A-Za-z]{2,}")
_BEARER_RE = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
_LONG_TOKEN_RE = re.compile(r"\b[A-Za-z0-9._~+/=-]{32,}\b")


def _clean_text(value: str, max_len: int = 240) -> str:
    text = (value or "").strip()
    text = _BEARER_RE.sub("Bearer [redacted]", text)
    text = _EMAIL_RE.sub("[redacted-email]", text)
    text = _LONG_TOKEN_RE.sub("[redacted-token]", text)
    return text[:max_len]


def _iso(value) -> str:
    return value.isoformat() if value else ""


class Command(BaseCommand):
    help = "Print app usage, client errors and feedback in JSON or Markdown."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=7, help="Lookback window in days.")
        parser.add_argument("--limit", type=int, default=10, help="Rows per section.")
        parser.add_argument(
            "--format",
            choices=("markdown", "json"),
            default="markdown",
            help="Output format for agents or scripts.",
        )

    def handle(self, *args, **options):
        days = max(1, int(options["days"]))
        limit = max(1, int(options["limit"]))
        since = timezone.now() - timedelta(days=days)
        report = self._build_report(since=since, days=days, limit=limit)

        if options["format"] == "json":
            self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(self._format_markdown(report))

    def _build_report(self, *, since, days: int, limit: int) -> dict[str, Any]:
        events = ClientEvent.objects.filter(created_at__gte=since)
        opened_events = events.filter(event=ClientEvent.Event.APP_OPEN)
        foreground_events = events.filter(event=ClientEvent.Event.APP_FOREGROUND)
        distance_events = events.filter(event=ClientEvent.Event.WALKING_DISTANCE)
        error_events = events.filter(severity=ClientEvent.Severity.ERROR)
        warning_events = events.filter(severity=ClientEvent.Severity.WARNING)
        screen_events = events.filter(event=ClientEvent.Event.SCREEN_VIEWED)
        interaction_events = events.filter(event=ClientEvent.Event.UI_INTERACTION)
        feedback = FeedbackReport.objects.filter(created_at__gte=since)
        counter_events = events.filter(
            event__in=[
                ClientEvent.Event.COUNTER_TAB_OPENED,
                ClientEvent.Event.COUNTER_SESSION_STARTED,
                ClientEvent.Event.DRINK_ADDED,
                ClientEvent.Event.DRINK_REMOVED,
                ClientEvent.Event.DRINK_SYNCED,
                ClientEvent.Event.DRINK_SYNC_FAILED,
                ClientEvent.Event.BEER_FORM_OPENED,
                ClientEvent.Event.BEER_PRICE_ADDED,
                ClientEvent.Event.COUNTER_RETURNED_SAME_DAY,
                ClientEvent.Event.COUNTER_RETURNED_LATER,
            ]
        )
        drinks_created = DrinkLog.objects.filter(created_at__gte=since)
        flagged_by_reason = list(
            drinks_created.filter(is_suspect=True)
            .values("suspect_reason")
            .annotate(count=Count("id"))
            .order_by("-count", "suspect_reason")
        )
        daily_counts: Counter[tuple[int, str, object]] = Counter()
        for account_id, nickname, drank_at in DrinkLog.objects.filter(
            drank_at__gte=since,
            drink_type=DrinkLog.DrinkType.BEER,
        ).values_list("account_id", "account__nickname", "drank_at"):
            daily_counts[(account_id, nickname or "", drinking_day(drank_at))] += 1
        max_daily_by_account: dict[int, dict[str, Any]] = {}
        for (account_id, nickname, _day), count in daily_counts.items():
            if count < settings.DRINK_DAILY_FLAG_CAP:
                continue
            current = max_daily_by_account.get(account_id)
            if current is None or count > current["count"]:
                max_daily_by_account[account_id] = {
                    "account_id": account_id,
                    "nickname": nickname,
                    "count": count,
                }
        top_daily_accounts = sorted(
            max_daily_by_account.values(),
            key=lambda row: (-row["count"], row["account_id"]),
        )[:10]

        period_distance_by_account: defaultdict[str, int] = defaultdict(int)
        period_distance_total_m = 0
        for event in distance_events.exclude(account__isnull=True).select_related("account"):
            distance_m = int((event.context or {}).get("distance_m") or 0)
            if distance_m <= 0:
                continue
            account_id = str(event.account.public_id)
            period_distance_by_account[account_id] += distance_m
            period_distance_total_m += distance_m

        api_failure_counter: Counter[tuple[str, str]] = Counter()
        for event in events.filter(event=ClientEvent.Event.API_FAILURE):
            context = event.context or {}
            operation = str(context.get("operation") or "unknown")
            status = str(context.get("status") or context.get("reason") or "unknown")
            api_failure_counter[(operation, status)] += 1

        drink_sync_failure_counter: Counter[tuple[str, str, str]] = Counter()
        for event in events.filter(event=ClientEvent.Event.DRINK_SYNC_FAILED):
            context = event.context or {}
            operation = str(context.get("operation") or "unknown")
            status = str(context.get("status") or context.get("reason") or "unknown")
            result = str(context.get("sync_result") or "unknown")
            drink_sync_failure_counter[(operation, status, result)] += 1

        screen_counts: Counter[str] = Counter()
        screen_accounts: defaultdict[str, set[int]] = defaultdict(set)
        for context, account_id in screen_events.values_list("context", "account_id"):
            screen = str((context or {}).get("screen") or "")
            if not screen:
                continue
            screen_counts[screen] += 1
            if account_id is not None:
                screen_accounts[screen].add(account_id)

        interaction_counts: Counter[tuple[str, str]] = Counter()
        interaction_accounts: defaultdict[tuple[str, str], set[int]] = defaultdict(set)
        interacting_account_ids: set[int] = set()
        for context, account_id in interaction_events.values_list("context", "account_id"):
            target = str((context or {}).get("target") or "")
            action = str((context or {}).get("action") or "")
            if not target or not action:
                continue
            key = (target, action)
            interaction_counts[key] += 1
            if account_id is not None:
                interaction_accounts[key].add(account_id)
                interacting_account_ids.add(account_id)

        recent_errors = [
            {
                "created_at": _iso(event.created_at),
                "event": event.event,
                "severity": event.severity,
                "message": _clean_text(event.message),
                "context": event.context,
                "app_version": event.app_version,
                "platform": event.platform,
                "account": str(event.account.public_id) if event.account_id else "",
            }
            for event in error_events.order_by("-created_at")[:limit]
        ]

        recent_feedback = [
            {
                "created_at": _iso(row.created_at),
                "id": row.id,
                "category": row.category,
                "status": row.status,
                "message": _clean_text(row.message, max_len=320),
                "app_version": row.app_version,
                "platform": row.platform,
                "account": str(row.account.public_id) if row.account_id else "",
            }
            for row in feedback.order_by("-created_at")[:limit]
        ]

        return {
            "window": {
                "days": days,
                "since": _iso(since),
                "generated_at": _iso(timezone.now()),
            },
            "usage": {
                "app_opens": opened_events.count(),
                "unique_opening_accounts": opened_events.exclude(account__isnull=True)
                .values("account_id")
                .distinct()
                .count(),
                "foregrounds": foreground_events.count(),
                "active_accounts": events.exclude(account__isnull=True)
                .values("account_id")
                .distinct()
                .count(),
                "walked_distance_m": period_distance_total_m,
                "walked_distance_km": round(period_distance_total_m / 1000, 2),
            },
            "all_time": {
                "accounts_with_opens": AccountUsageStats.objects.filter(
                    app_open_count__gt=0
                ).count(),
                "app_opens": AccountUsageStats.objects.aggregate(
                    total=Sum("app_open_count")
                )["total"]
                or 0,
                "walked_distance_m": AccountUsageStats.objects.aggregate(
                    total=Sum("walked_distance_m")
                )["total"]
                or 0,
            },
            "counter": {
                "events": counter_events.count(),
                "tab_opens": events.filter(event=ClientEvent.Event.COUNTER_TAB_OPENED).count(),
                "unique_counter_accounts": counter_events.exclude(account__isnull=True)
                .values("account_id")
                .distinct()
                .count(),
                "sessions_started": events.filter(
                    event=ClientEvent.Event.COUNTER_SESSION_STARTED
                ).count(),
                "drinks_added": events.filter(event=ClientEvent.Event.DRINK_ADDED).count(),
                "drinks_removed": events.filter(event=ClientEvent.Event.DRINK_REMOVED).count(),
                "drinks_synced": events.filter(event=ClientEvent.Event.DRINK_SYNCED).count(),
                "drink_sync_failures": events.filter(
                    event=ClientEvent.Event.DRINK_SYNC_FAILED
                ).count(),
                "beer_forms_opened": events.filter(event=ClientEvent.Event.BEER_FORM_OPENED).count(),
                "beer_prices_added": events.filter(event=ClientEvent.Event.BEER_PRICE_ADDED).count(),
                "returns_same_day": events.filter(
                    event=ClientEvent.Event.COUNTER_RETURNED_SAME_DAY
                ).count(),
                "returns_later": events.filter(event=ClientEvent.Event.COUNTER_RETURNED_LATER).count(),
                "drink_sync_failures_by_operation": [
                    {
                        "operation": operation,
                        "status": status,
                        "sync_result": result,
                        "count": count,
                    }
                    for (operation, status, result), count in drink_sync_failure_counter.most_common(
                        limit
                    )
                ],
            },
            "product": {
                "screen_views": screen_events.count(),
                "unique_viewing_accounts": screen_events.exclude(account__isnull=True)
                .values("account_id")
                .distinct()
                .count(),
                "screens": [
                    {
                        "screen": screen,
                        "views": count,
                        "unique_accounts": len(screen_accounts[screen]),
                    }
                    for screen, count in sorted(
                        screen_counts.items(),
                        key=lambda item: (-item[1], item[0]),
                    )[:limit]
                ],
                "interactions": sum(interaction_counts.values()),
                "unique_interacting_accounts": len(interacting_account_ids),
                "interaction_targets": [
                    {
                        "target": target,
                        "action": action,
                        "events": count,
                        "unique_accounts": len(interaction_accounts[(target, action)]),
                    }
                    for (target, action), count in sorted(
                        interaction_counts.items(),
                        key=lambda item: (-item[1], item[0][0], item[0][1]),
                    )[:limit]
                ],
            },
            "abuse": {
                "drinks_created": drinks_created.count(),
                "flagged": drinks_created.filter(is_suspect=True).count(),
                "flagged_by_reason": flagged_by_reason,
                "top_accounts_by_daily_drinks": top_daily_accounts,
            },
            "top_walkers_period": [
                {
                    "account": account_id,
                    "walked_distance_m": distance_m,
                    "walked_distance_km": round(distance_m / 1000, 2),
                }
                for account_id, distance_m in sorted(
                    period_distance_by_account.items(),
                    key=lambda item: item[1],
                    reverse=True,
                )[:limit]
            ],
            "top_walkers_all_time": [
                {
                    "account": str(row.account.public_id),
                    "walked_distance_m": row.walked_distance_m,
                    "walked_distance_km": row.walked_distance_km,
                    "app_open_count": row.app_open_count,
                    "last_app_open_at": _iso(row.last_app_open_at),
                }
                for row in AccountUsageStats.objects.select_related("account").order_by(
                    "-walked_distance_m", "-app_open_count"
                )[:limit]
            ],
            "client_health": {
                "events": events.count(),
                "warnings": warning_events.count(),
                "errors": error_events.count(),
                "api_failures": events.filter(event=ClientEvent.Event.API_FAILURE).count(),
                "events_by_type": list(
                    events.values("event")
                    .annotate(count=Count("id"))
                    .order_by("-count", "event")[:limit]
                ),
                "api_failures_by_operation": [
                    {"operation": operation, "status": status, "count": count}
                    for (operation, status), count in api_failure_counter.most_common(limit)
                ],
            },
            "recent_errors": recent_errors,
            "feedback": {
                "total": feedback.count(),
                "by_category": list(
                    feedback.values("category")
                    .annotate(count=Count("id"))
                    .order_by("-count", "category")
                ),
                "by_status": list(
                    feedback.values("status")
                    .annotate(count=Count("id"))
                    .order_by("-count", "status")
                ),
                "recent": recent_feedback,
            },
        }

    def _format_markdown(self, report: dict[str, Any]) -> str:
        usage = report["usage"]
        all_time = report["all_time"]
        counter = report["counter"]
        product = report["product"]
        abuse = report["abuse"]
        health = report["client_health"]
        lines = [
            "# Na pivo observability report",
            "",
            f"Window: last {report['window']['days']} days since {report['window']['since']}",
            "",
            "## Usage",
            "",
            f"- App opens: {usage['app_opens']} ({usage['unique_opening_accounts']} unique accounts)",
            f"- Foregrounds: {usage['foregrounds']}",
            f"- Active accounts: {usage['active_accounts']}",
            f"- Walked distance: {usage['walked_distance_km']} km",
            f"- All-time opens: {all_time['app_opens']} across {all_time['accounts_with_opens']} accounts",
            f"- All-time walked distance: {round(all_time['walked_distance_m'] / 1000, 2)} km",
            "",
            "## Product",
            "",
            f"- Screen views: {product['screen_views']} ({product['unique_viewing_accounts']} unique accounts)",
            f"- UI interactions: {product['interactions']} ({product['unique_interacting_accounts']} unique accounts)",
            "",
            "### Screens",
            "",
        ]
        lines.extend(
            self._table(
                product["screens"],
                ["screen", "views", "unique_accounts"],
            )
        )
        lines.extend(["", "### Interaction targets", ""])
        lines.extend(
            self._table(
                product["interaction_targets"],
                ["target", "action", "events", "unique_accounts"],
            )
        )
        lines.extend(
            [
                "",
                "## Counter",
                "",
                f"- Counter tab opens: {counter['tab_opens']} ({counter['unique_counter_accounts']} unique accounts)",
                f"- Sessions started: {counter['sessions_started']}",
                f"- Drinks added/removed: {counter['drinks_added']} / {counter['drinks_removed']}",
                f"- Drinks synced/failed: {counter['drinks_synced']} / {counter['drink_sync_failures']}",
                f"- Beer forms opened / prices added: {counter['beer_forms_opened']} / {counter['beer_prices_added']}",
                f"- Returns same day / later: {counter['returns_same_day']} / {counter['returns_later']}",
                "",
                "### Drink Sync Failures",
                "",
            ]
        )
        lines.extend(
            self._table(
                counter["drink_sync_failures_by_operation"],
                ["operation", "status", "sync_result", "count"],
            )
        )
        lines.extend(
            [
                "",
                "## Abuse",
                "",
                f"- Drinks created: {abuse['drinks_created']}",
                f"- Flagged drinks: {abuse['flagged']}",
                "",
                "### Flagged By Reason",
                "",
            ]
        )
        lines.extend(self._table(abuse["flagged_by_reason"], ["suspect_reason", "count"]))
        lines.extend(["", "### Top Accounts By Daily Drinks", ""])
        lines.extend(
            self._table(
                abuse["top_accounts_by_daily_drinks"],
                ["account_id", "nickname", "count"],
            )
        )
        lines.extend(
            [
                "",
                "## Top Walkers In Window",
                "",
            ]
        )
        lines.extend(self._table(report["top_walkers_period"], ["account", "walked_distance_km"]))
        lines.extend(
            [
                "",
                "## Top Walkers All Time",
                "",
            ]
        )
        lines.extend(
            self._table(
                report["top_walkers_all_time"],
                ["account", "walked_distance_km", "app_open_count", "last_app_open_at"],
            )
        )
        lines.extend(
            [
                "",
                "## Client Health",
                "",
                f"- Events: {health['events']}",
                f"- Warnings: {health['warnings']}",
                f"- Errors: {health['errors']}",
                f"- API failures: {health['api_failures']}",
                "",
                "### Events By Type",
                "",
            ]
        )
        lines.extend(self._table(health["events_by_type"], ["event", "count"]))
        lines.extend(["", "### API Failures By Operation", ""])
        lines.extend(
            self._table(health["api_failures_by_operation"], ["operation", "status", "count"])
        )
        lines.extend(["", "## Recent Errors", ""])
        lines.extend(
            self._table(
                report["recent_errors"],
                ["created_at", "event", "message", "app_version", "platform", "account"],
            )
        )
        lines.extend(["", "## Feedback", ""])
        lines.append(f"- Total: {report['feedback']['total']}")
        lines.extend(["", "### Recent Feedback", ""])
        lines.extend(
            self._table(
                report["feedback"]["recent"],
                ["created_at", "id", "category", "status", "message", "app_version", "platform"],
            )
        )
        return "\n".join(lines)

    def _table(self, rows: list[dict[str, Any]], columns: list[str]) -> list[str]:
        if not rows:
            return ["_No rows._"]
        lines = [
            "| " + " | ".join(columns) + " |",
            "| " + " | ".join("---" for _ in columns) + " |",
        ]
        for row in rows:
            values = [str(row.get(column, "")).replace("|", "\\|").replace("\n", " ") for column in columns]
            lines.append("| " + " | ".join(values) + " |")
        return lines
