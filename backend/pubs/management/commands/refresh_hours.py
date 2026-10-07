"""
pubs.management.commands.refresh_hours — process pending EnrichTasks and refresh
stale PubHours rows via FirmyHoursSource.

Intended to run via cron (e.g. every 5 minutes). Respects FIRMY_MIN_INTERVAL_SEC,
FIRMY_DAILY_CAP, FIRMY_PROXY_DAILY_CAP, FIRMY_REFRESH_DAILY_CAP and
FIRMY_ERROR_RETRY_COOLDOWN_MINUTES settings. Pubs outside Czechia are never
looked up. Each invocation processes up to --limit rows. --dry-run preserves
hours/tasks but still reserves the shared request budget when fetching data.

Usage
-----
  python manage.py refresh_hours
  python manage.py refresh_hours --limit 50
  python manage.py refresh_hours --dry-run
  python manage.py refresh_hours --limit 20 --dry-run
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import models
from django.utils import timezone

from pubs.enrichment import (
    FirmyDailyCapExceededError,
    FirmyHoursSource,
    RawHours,
    classify_venue,
    geohash8,
)
from pubs.enrichment.firmy import DIRECT, PROXY
from pubs.firmy_policy import (
    firmy_covered_q,
    firmy_covers,
    firmy_source_options,
    fresh_hours_q,
    reserve_refresh,
    stale_hours_q,
)
from pubs.models import EnrichTask, PubHours

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _persist_result(
    cache_key: str,
    name: str,
    lat: float,
    lng: float,
    result: RawHours | None,
    dry_run: bool,
) -> None:
    """
    Write a FirmyHoursSource result into PubHours (upsert).

    If *result* is None, records the row as "unknown" (no confident match).
    """
    if dry_run:
        logger.info("[dry-run] would persist result for %s (%s)", name, cache_key)
        return

    status = PubHours.Status.UNKNOWN
    opening_hours_raw: str | None = None
    source_ref: str | None = None
    confidence: float | None = None
    rating_value: float | None = None
    rating_count: int | None = None
    rating_label: str | None = None
    has_garden: bool | None = None
    error: str | None = None
    # No-match rows carry no classification — keep the safe 'unknown' default.
    venue_kind = PubHours.VenueKind.UNKNOWN
    venue_categories: list[str] = []
    venue_tags: list[str] = []

    if result is not None:
        if result.opening_hours_raw:
            status = PubHours.Status.OK
        else:
            # Found on Firmy.cz but no published hours
            status = PubHours.Status.UNKNOWN
        opening_hours_raw = result.opening_hours_raw
        source_ref = result.source_ref
        confidence = result.confidence
        rating_value = result.rating_value
        rating_count = result.rating_count
        rating_label = result.rating_label
        # Classify the venue (draft beer?) from the scraped categories/tags.
        venue_kind = classify_venue(result.categories, result.tags)
        venue_categories = result.categories
        venue_tags = result.tags
        has_garden = "se-zahradkou" in result.tags

    PubHours.objects.update_or_create(
        cache_key=cache_key,
        defaults={
            "name": name,
            "lat": lat,
            "lng": lng,
            "opening_hours_raw": opening_hours_raw,
            "source": result.source if result else "firmy",
            "source_ref": source_ref,
            "confidence": confidence,
            "rating_value": rating_value,
            "rating_count": rating_count,
            "rating_label": rating_label,
            "has_garden": has_garden,
            "venue_kind": venue_kind,
            "venue_categories": venue_categories,
            "venue_tags": venue_tags,
            "status": status,
            "error": error,
            "fetched_at": timezone.now(),
        },
    )


def _mark_task_done(task: EnrichTask, dry_run: bool) -> None:
    if dry_run:
        return
    task.done = True
    task.error = None
    task.last_attempt_at = timezone.now()
    task.save(update_fields=["done", "last_attempt_at", "attempts", "error"])


def _mark_task_failed(task: EnrichTask, error_msg: str, dry_run: bool) -> None:
    if dry_run:
        return
    task.error = error_msg
    task.last_attempt_at = timezone.now()
    # If max_attempts reached, mark done=True so we stop retrying
    if task.attempts >= task.max_attempts:
        task.done = True
        logger.warning(
            "EnrichTask %s exceeded max_attempts (%d) — marking done. error: %s",
            task.cache_key,
            task.max_attempts,
            error_msg,
        )
    task.save(update_fields=["done", "last_attempt_at", "attempts", "error"])


# ---------------------------------------------------------------------------
# Command
# ---------------------------------------------------------------------------


class Command(BaseCommand):
    help = (
        "Process pending EnrichTask rows and refresh stale PubHours via "
        "FirmyHoursSource. Respects FIRMY_MIN_INTERVAL_SEC and FIRMY_DAILY_CAP."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help=(
                "Maximum total rows to process in this run (pending tasks + stale "
                "refreshes). 0 = no limit (process everything)."
            ),
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Fetch data and reserve request budget, but do not change hours or tasks.",
        )

    def handle(self, *args, **options) -> None:
        limit: int = options["limit"]
        dry_run: bool = options["dry_run"]

        error_retry_cooldown_minutes: int = int(
            getattr(settings, "FIRMY_ERROR_RETRY_COOLDOWN_MINUTES", 15)
        )

        if dry_run:
            self.stdout.write(self.style.WARNING("[dry-run] Hours/tasks are unchanged; fetches still consume request budget."))

        processed = 0
        cap_exceeded = False

        source = FirmyHoursSource(**firmy_source_options())

        try:
            processed, cap_exceeded = self._process_pending_tasks(
                source=source,
                error_retry_cooldown_minutes=error_retry_cooldown_minutes,
                limit=limit,
                processed_so_far=processed,
                dry_run=dry_run,
            )

            if not cap_exceeded and (limit == 0 or processed < limit):
                processed, cap_exceeded = self._refresh_stale_rows(
                    source=source,
                    error_retry_cooldown_minutes=error_retry_cooldown_minutes,
                    limit=limit,
                    processed_so_far=processed,
                    dry_run=dry_run,
                )
        finally:
            source.close()

        verb = "(dry-run) " if dry_run else ""
        counts = source.request_counts
        self.stdout.write(
            f"{verb}Firmy.cz requests: {counts[DIRECT]} direct, {counts[PROXY]} via proxy."
        )
        if cap_exceeded:
            self.stdout.write(
                self.style.WARNING(
                    f"{verb}Stopped: Firmy.cz daily cap reached after {processed} item(s)."
                )
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"{verb}Done. Processed {processed} item(s)."
                )
            )

    # ------------------------------------------------------------------
    # Phase 1: pending EnrichTask rows
    # ------------------------------------------------------------------

    def _process_pending_tasks(
        self,
        source: FirmyHoursSource,
        error_retry_cooldown_minutes: int,
        limit: int,
        processed_so_far: int,
        dry_run: bool,
    ) -> tuple[int, bool]:
        """
        Process EnrichTask rows with done=False that have not exceeded max_attempts.

        Returns (total_processed, cap_exceeded).
        """
        qs = EnrichTask.objects.filter(done=False).extra(where=["attempts < max_attempts"])
        if error_retry_cooldown_minutes > 0:
            retry_cutoff = timezone.now() - timedelta(minutes=error_retry_cooldown_minutes)
            qs = qs.filter(
                models.Q(last_attempt_at__isnull=True) | models.Q(last_attempt_at__lt=retry_cutoff)
            )
        qs = qs.order_by("created_at")

        processed = processed_so_far
        cap_exceeded = False

        for task in qs.iterator():
            if limit > 0 and processed >= limit:
                break

            # If a fresh PubHours row already exists for this key (e.g. a later
            # request sync-enriched the same pub after the task was queued),
            # close the task without spending a fetch.
            already_fresh = PubHours.objects.filter(
                fresh_hours_q(timezone.now()), cache_key=task.cache_key
            ).exists()
            if already_fresh:
                logger.info(
                    "EnrichTask %s already has a fresh PubHours row — marking done",
                    task.cache_key,
                )
                _mark_task_done(task, dry_run)
                continue

            if not firmy_covers(task.lat, task.lng):
                logger.info(
                    "EnrichTask %s is outside Czechia, which Firmy.cz does not "
                    "list — marking done without a fetch",
                    task.cache_key,
                )
                _mark_task_done(task, dry_run)
                continue

            if not dry_run:
                # Persist only after an actual outcome. A cap denial (including
                # between search/detail requests) must not exhaust task retries.
                task.attempts += 1

            logger.info(
                "Processing EnrichTask %s: %s (attempt %d/%d)",
                task.cache_key,
                task.name,
                task.attempts,
                task.max_attempts,
            )

            try:
                result = source.fetch(
                    name=task.name,
                    lat=task.lat,
                    lng=task.lng,
                    city=task.city or None,
                )
            except FirmyDailyCapExceededError as exc:
                # Daily cap exceeded
                cap_exceeded = True
                logger.warning("Daily cap exceeded during task processing: %s", exc)
                if not dry_run:
                    task.error = str(exc)
                    task.save(update_fields=["error"])
                break
            except Exception as exc:  # noqa: BLE001
                error_msg = f"Unexpected error: {exc}"
                logger.error("Error processing task %s: %s", task.cache_key, exc, exc_info=True)
                _mark_task_failed(task, error_msg, dry_run)
                processed += 1
                continue

            cache_key = geohash8(task.lat, task.lng)
            _persist_result(
                cache_key=cache_key,
                name=task.name,
                lat=task.lat,
                lng=task.lng,
                result=result,
                dry_run=dry_run,
            )
            _mark_task_done(task, dry_run)
            processed += 1

            self.stdout.write(
                f"  task {task.cache_key} ({task.name}): "
                + (
                    f"ok — {result.opening_hours_raw!r} (confidence {result.confidence:.2f})"
                    if result and result.opening_hours_raw
                    else "unknown (no hours found)"
                    if result
                    else "no confident match"
                )
            )

        return processed, cap_exceeded

    # ------------------------------------------------------------------
    # Phase 2: refresh stale PubHours rows
    # ------------------------------------------------------------------

    def _refresh_stale_rows(
        self,
        source: FirmyHoursSource,
        error_retry_cooldown_minutes: int,
        limit: int,
        processed_so_far: int,
        dry_run: bool,
    ) -> tuple[int, bool]:
        """
        Re-fetch PubHours rows in Czechia older than HOURS_TTL_OK_DAYS ('ok') or
        HOURS_TTL_UNKNOWN_DAYS ('unknown'). Error rows use
        FIRMY_ERROR_RETRY_COOLDOWN_MINUTES instead. At most
        FIRMY_REFRESH_DAILY_CAP rows a day, so rows that expire together are
        spread over several days.

        Returns (total_processed, cap_exceeded).
        """
        now = timezone.now()
        error_retry_cutoff = now - timedelta(minutes=error_retry_cooldown_minutes)

        qs = PubHours.objects.filter(
            stale_hours_q(now)
            | models.Q(
                status=PubHours.Status.ERROR,
                fetched_at__lt=error_retry_cutoff,
            ),
            firmy_covered_q(),
        ).exclude(
            cache_key__in=EnrichTask.objects.filter(done=False)
            .extra(where=["attempts < max_attempts"])
            .values("cache_key")
        ).order_by("fetched_at")

        processed = processed_so_far
        cap_exceeded = False

        for row in qs.iterator():
            if limit > 0 and processed >= limit:
                break

            if not reserve_refresh():
                self.stdout.write(
                    "  daily refresh budget reached — stale rows wait for tomorrow"
                )
                break

            logger.info(
                "Refreshing stale PubHours %s: %s (last fetched %s)",
                row.cache_key,
                row.name,
                row.fetched_at,
            )

            try:
                result = source.fetch(
                    name=row.name,
                    lat=row.lat,
                    lng=row.lng,
                )
            except FirmyDailyCapExceededError as exc:
                cap_exceeded = True
                logger.warning("Daily cap exceeded during stale refresh: %s", exc)
                break
            except Exception as exc:  # noqa: BLE001
                logger.error("Error refreshing %s: %s", row.cache_key, exc, exc_info=True)
                if not dry_run:
                    row.status = PubHours.Status.ERROR
                    row.error = str(exc)
                    row.fetched_at = timezone.now()
                    row.save(update_fields=["status", "error", "fetched_at", "updated_at"])
                processed += 1
                continue

            _persist_result(
                cache_key=row.cache_key,
                name=row.name,
                lat=row.lat,
                lng=row.lng,
                result=result,
                dry_run=dry_run,
            )
            processed += 1

            self.stdout.write(
                f"  refresh {row.cache_key} ({row.name}): "
                + (
                    f"ok — {result.opening_hours_raw!r}"
                    if result and result.opening_hours_raw
                    else "unknown"
                    if result
                    else "no confident match"
                )
            )

        return processed, cap_exceeded
