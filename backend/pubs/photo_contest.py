"""
pubs.photo_contest — FotoPivař biweekly photo contest domain logic.

Rounds are deterministic 14-day windows anchored at the ``PHOTO_CONTEST_EPOCH``
setting (an ISO date, interpreted as 00:00 UTC). Any request or worker tick can
compute the current window locally and lazily ``get_or_create`` its row — the
unique ``period_start`` makes concurrent creators converge on one row, so no
scheduler has to "open" a round on time.

Closing IS worker-driven (``advance_photo_contests``): it stamps the final top-3
ranks, pays XP and opens the next round. :func:`close_due_contests` holds that
logic so the management command stays a thin wrapper.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Count, F
from django.utils import timezone

from pubs.models import AccountUsageStats, PhotoContest

logger = logging.getLogger("pubs.photo_contest")

# One contest round spans exactly two weeks.
CONTEST_PERIOD = timedelta(days=14)

# XP paid per final rank (1-indexed), read lazily so env-tuned settings apply.
_RANK_SETTING_NAMES = (
    "PHOTO_CONTEST_XP_FIRST",
    "PHOTO_CONTEST_XP_SECOND",
    "PHOTO_CONTEST_XP_THIRD",
)


def contest_epoch() -> datetime:
    """The anchor instant every round window is computed from (00:00 UTC)."""
    return datetime.fromisoformat(settings.PHOTO_CONTEST_EPOCH).replace(tzinfo=UTC)


def current_period_bounds(now: datetime | None = None) -> tuple[datetime, datetime]:
    """Deterministic [start, end) of the 14-day window containing ``now``.

    Pure function of (now, PHOTO_CONTEST_EPOCH) — every caller everywhere
    computes the identical window, which is what makes the lazy row creation
    race-safe and worker-schedule-independent.
    """
    if now is None:
        now = timezone.now()
    # timedelta floor division rounds toward -inf, so pre-epoch instants also
    # land in a well-defined window instead of an off-by-one.
    periods = (now - contest_epoch()) // CONTEST_PERIOD
    period_start = contest_epoch() + periods * CONTEST_PERIOD
    return period_start, period_start + CONTEST_PERIOD


def current_photo_contest(now: datetime | None = None) -> PhotoContest:
    """Get or lazily create the contest row for the current window.

    Safe under concurrent callers: ``period_start`` is unique, so
    ``get_or_create`` converges on a single row even when two requests race the
    first creation of a round.
    """
    period_start, period_end = current_period_bounds(now)
    contest, _created = PhotoContest.objects.get_or_create(
        period_start=period_start,
        defaults={"period_end": period_end},
    )
    return contest


def _rank_xp(rank: int) -> int:
    return int(getattr(settings, _RANK_SETTING_NAMES[rank - 1]))


def close_due_contests(now: datetime | None = None) -> list[PhotoContest]:
    """Close every open contest whose window has ended; return the closed rows.

    Per contest, inside a transaction with ``select_for_update()`` and a status
    re-check (idempotent under concurrent workers / repeated runs):

    * rank the top 3 entries with AT LEAST ONE vote by vote count (tiebreak:
      earlier ``created_at``, then pk, wins) and stamp ``final_rank`` /
      ``final_votes`` — a zero-vote entry never ranks, so an uncontested round
      pays nothing;
    * pay ``PHOTO_CONTEST_XP_FIRST/SECOND/THIRD`` onto ``mapper_xp`` with F()
      increments (never a read-modify-write);
    * rank 1 also increments the monotonic ``photo_contest_wins_count``;
    * flip the contest to ``closed`` + ``closed_at``.

    Finally the next open round is lazily ensured via
    :func:`current_photo_contest`.
    """
    if now is None:
        now = timezone.now()

    due_ids = list(
        PhotoContest.objects.filter(
            status=PhotoContest.Status.OPEN,
            period_end__lte=now,
        ).values_list("pk", flat=True)
    )

    closed: list[PhotoContest] = []
    for contest_id in due_ids:
        with transaction.atomic():
            contest = (
                PhotoContest.objects.select_for_update()
                .filter(pk=contest_id, status=PhotoContest.Status.OPEN)
                .first()
            )
            if contest is None:
                # Another worker closed it between the id scan and the lock.
                continue

            # Only entries somebody actually voted for can rank: without the
            # >= 1 floor a lone zero-vote entrant would farm the FotoPivař
            # badge + rank-1 XP every round just by showing up.
            winners = list(
                contest.entries.annotate(vote_count=Count("votes"))
                .filter(vote_count__gte=1)
                .order_by("-vote_count", "created_at", "pk")[:3]
            )
            for rank, entry in enumerate(winners, start=1):
                entry.final_rank = rank
                entry.final_votes = entry.vote_count
                entry.save(update_fields=["final_rank", "final_votes"])

                inc: dict[str, object] = {"mapper_xp": F("mapper_xp") + _rank_xp(rank)}
                if rank == 1:
                    inc["photo_contest_wins_count"] = F("photo_contest_wins_count") + 1
                stats, _ = AccountUsageStats.objects.get_or_create(account_id=entry.account_id)
                AccountUsageStats.objects.filter(pk=stats.pk).update(**inc)

            contest.status = PhotoContest.Status.CLOSED
            contest.closed_at = now
            contest.save(update_fields=["status", "closed_at"])
            closed.append(contest)
            logger.info(
                "photo_contest: closed %s (%d winner(s))",
                contest.public_id,
                len(winners),
            )

    # Make sure the next round exists so clients never observe a gap.
    current_photo_contest(now)
    return closed
