"""
Tests for pubs.management.commands.refresh_hours.

Network policy
--------------
FirmyHoursSource is ALWAYS mocked — no live network calls. Tests use
pytest-django's `db` fixture for database access (SQLite in-memory for speed).
"""

from __future__ import annotations

from datetime import timedelta
from io import StringIO
from unittest.mock import MagicMock, patch

import pytest
from django.core.management import call_command
from django.utils import timezone

from pubs.enrichment.firmy import RawHours
from pubs.enrichment.matcher import geohash8
from pubs.models import EnrichTask, PubHours

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PUB_NAME = "Restaurace U Fleků"
_LAT = 50.078914
_LNG = 14.416990
_CACHE_KEY = geohash8(_LAT, _LNG)

_GOOD_RESULT = RawHours(
    opening_hours_raw="Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00",
    source="firmy",
    source_ref="272313",
    matched_name="Restaurace U Fleků",
    matched_lat=_LAT,
    matched_lng=_LNG,
    confidence=0.95,
)

_NO_HOURS_RESULT = RawHours(
    opening_hours_raw=None,
    source="firmy",
    source_ref="272313",
    matched_name="Restaurace U Fleků",
    matched_lat=_LAT,
    matched_lng=_LNG,
    confidence=0.85,
)


def _make_task(**kwargs) -> EnrichTask:
    """Create and return a pending EnrichTask with sensible defaults."""
    defaults = {
        "cache_key": _CACHE_KEY,
        "name": _PUB_NAME,
        "lat": _LAT,
        "lng": _LNG,
        "city": "Praha",
        "attempts": 0,
        "max_attempts": 3,
        "done": False,
    }
    defaults.update(kwargs)
    return EnrichTask.objects.create(**defaults)


def _make_pub_hours(fetched_at=None, status=PubHours.Status.OK, **kwargs) -> PubHours:
    """Create and return a PubHours row with sensible defaults."""
    defaults = {
        "cache_key": _CACHE_KEY,
        "name": _PUB_NAME,
        "lat": _LAT,
        "lng": _LNG,
        "opening_hours_raw": "Mo-Su 10:00-23:00",
        "source": "firmy",
        "source_ref": "272313",
        "confidence": 0.9,
        "status": status,
        "fetched_at": fetched_at or timezone.now(),
    }
    defaults.update(kwargs)
    return PubHours.objects.create(**defaults)


def _run_command(*args, **kwargs) -> tuple[str, str]:
    """Call refresh_hours management command, capture stdout/stderr."""
    out, err = StringIO(), StringIO()
    call_command("refresh_hours", *args, stdout=out, stderr=err, **kwargs)
    return out.getvalue(), err.getvalue()


# ---------------------------------------------------------------------------
# Patch helper: replace FirmyHoursSource in the management command module
# ---------------------------------------------------------------------------

FIRMY_SOURCE_PATH = "pubs.management.commands.refresh_hours.FirmyHoursSource"


# ===========================================================================
# Test classes
# ===========================================================================


@pytest.mark.django_db
class TestPendingTaskIsProcessed:
    """A pending EnrichTask is fetched and persisted into PubHours."""

    def test_pending_task_creates_pub_hours(self):
        task = _make_task()

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            _run_command()

        # PubHours row was created
        ph = PubHours.objects.get(cache_key=_CACHE_KEY)
        assert ph.status == PubHours.Status.OK
        assert ph.opening_hours_raw == "Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00"
        assert ph.source_ref == "272313"
        assert ph.confidence == pytest.approx(0.95)
        assert ph.fetched_at is not None

        # Task marked done
        task.refresh_from_db()
        assert task.done is True
        assert task.attempts == 1

    def test_pending_task_no_hours_status_unknown(self):
        """Pub found on Firmy but no opening hours → status unknown."""
        task = _make_task()

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _NO_HOURS_RESULT

            _run_command()

        ph = PubHours.objects.get(cache_key=_CACHE_KEY)
        assert ph.status == PubHours.Status.UNKNOWN
        assert ph.opening_hours_raw is None

        task.refresh_from_db()
        assert task.done is True

    def test_no_match_returns_unknown_status(self):
        """fetch() returns None (no confident match) → status unknown."""
        task = _make_task()

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = None

            _run_command()

        ph = PubHours.objects.get(cache_key=_CACHE_KEY)
        assert ph.status == PubHours.Status.UNKNOWN

        task.refresh_from_db()
        assert task.done is True

    def test_already_done_tasks_are_skipped(self):
        """Tasks with done=True are not processed."""
        _make_task(done=True, attempts=1)

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            _run_command()

        assert instance.fetch.call_count == 0
        assert not PubHours.objects.filter(cache_key=_CACHE_KEY).exists()

    def test_task_max_attempts_exceeded_not_processed(self):
        """Tasks where attempts >= max_attempts are not picked up again."""
        _make_task(attempts=3, max_attempts=3, done=False)

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            _run_command()

        # fetch was never called
        assert instance.fetch.call_count == 0


@pytest.mark.django_db
class TestFreshRowSkipsPendingTask:
    """A pending task whose PubHours row is already fresh is closed, not fetched.

    Reproduces MEDIUM 7: a request sync-enriched the same cache_key after the
    task was queued; refresh_hours must not spend a fetch re-fetching it.
    """

    def test_task_skipped_when_fresh_row_exists(self):
        task = _make_task()
        # A fresh PubHours row already exists for the same cache_key.
        _make_pub_hours(fetched_at=timezone.now())

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            _run_command()

        # No fetch was spent on this task.
        assert instance.fetch.call_count == 0
        # Task was closed.
        task.refresh_from_db()
        assert task.done is True

    def test_task_still_processed_when_row_stale(self):
        """If the existing row is stale, the task is still fetched normally."""
        task = _make_task()
        _make_pub_hours(fetched_at=timezone.now() - timedelta(days=31))

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            _run_command()

        assert instance.fetch.call_count == 1
        task.refresh_from_db()
        assert task.done is True


@pytest.mark.django_db
class TestDailyCapRespected:
    """When FirmyHoursSource raises RuntimeError (cap exceeded), command stops."""

    def test_daily_cap_exceeded_stops_processing(self):
        # Create multiple tasks
        for i in range(3):
            EnrichTask.objects.create(
                cache_key=geohash8(_LAT + i * 0.01, _LNG),
                name=f"Pub {i}",
                lat=_LAT + i * 0.01,
                lng=_LNG,
                attempts=0,
                max_attempts=3,
                done=False,
            )

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            # First call succeeds, second raises cap error
            instance.fetch.side_effect = [
                _GOOD_RESULT,
                RuntimeError("firmy: daily request cap of 1 exceeded"),
                _GOOD_RESULT,  # This should never be reached
            ]

            out, _ = _run_command()

        # Only 1 task should have produced a PubHours row (the successful one)
        assert PubHours.objects.count() == 1
        assert "daily cap" in out.lower() or "Stopped" in out

    def test_cap_exceeded_on_first_call_stops_immediately(self):
        _make_task()

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.side_effect = RuntimeError("firmy: daily request cap exceeded")

            out, _ = _run_command()

        assert PubHours.objects.count() == 0
        assert "Stopped" in out or "daily cap" in out.lower()


@pytest.mark.django_db
class TestMinIntervalPassedToSource:
    """FIRMY_MIN_INTERVAL_SEC is forwarded to FirmyHoursSource."""

    def test_min_interval_setting_forwarded(self):
        _make_task()

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            with patch("django.conf.settings.FIRMY_MIN_INTERVAL_SEC", 7.5):
                _run_command()

            # Check FirmyHoursSource was instantiated with min_interval=7.5
            call_kwargs = MockSource.call_args[1]
            assert call_kwargs.get("min_interval") == 7.5


@pytest.mark.django_db
class TestStaleRowsAreRefreshed:
    """PubHours rows older than TTL are picked up and refreshed."""

    def test_stale_row_is_re_fetched(self):
        stale_time = timezone.now() - timedelta(days=31)
        ph = _make_pub_hours(fetched_at=stale_time)
        original_hours = ph.opening_hours_raw

        new_result = RawHours(
            opening_hours_raw="Mo-Fr 11:00-22:00",
            source="firmy",
            source_ref="272313",
            matched_name=_PUB_NAME,
            matched_lat=_LAT,
            matched_lng=_LNG,
            confidence=0.90,
        )

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = new_result

            _run_command()

        ph.refresh_from_db()
        assert ph.opening_hours_raw == "Mo-Fr 11:00-22:00"
        assert ph.opening_hours_raw != original_hours

    def test_fresh_row_not_re_fetched(self):
        """A row fetched recently (within TTL) must not be re-queried."""
        _make_pub_hours(fetched_at=timezone.now() - timedelta(days=5))

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            _run_command()

        # No stale rows → fetch should never be called
        assert instance.fetch.call_count == 0

    def test_error_status_row_is_refreshed(self):
        """Rows with status=error are stale-refreshed even within TTL."""
        stale_time = timezone.now() - timedelta(days=31)
        ph = _make_pub_hours(fetched_at=stale_time, status=PubHours.Status.ERROR)

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            _run_command()

        ph.refresh_from_db()
        assert ph.status == PubHours.Status.OK

    def test_recent_error_status_row_waits_for_retry_cooldown(self, settings):
        """A recent transient error is not retried by cron on every run."""
        settings.FIRMY_ERROR_RETRY_COOLDOWN_MINUTES = 15
        ph = _make_pub_hours(
            fetched_at=timezone.now() - timedelta(minutes=5),
            status=PubHours.Status.ERROR,
        )

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            _run_command()

        instance.fetch.assert_not_called()
        ph.refresh_from_db()
        assert ph.status == PubHours.Status.ERROR

    def test_stale_row_with_open_task_is_not_refreshed_twice(self):
        """The stale-refresh phase skips keys already represented by an open task."""
        stale_time = timezone.now() - timedelta(days=31)
        ph = _make_pub_hours(fetched_at=stale_time)
        _make_task()

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.side_effect = Exception("proxy outage")

            _run_command()

        # One fetch for the task; no second fetch for the same stale PubHours row.
        assert instance.fetch.call_count == 1
        ph.refresh_from_db()
        assert ph.opening_hours_raw == "Mo-Su 10:00-23:00"

    def test_stale_row_with_maxed_out_task_is_refreshed(self):
        """A row whose EnrichTask is stuck (done=False, attempts==max_attempts) is
        not shielded from stale-refresh — phase 1 can't process the task, so
        phase 2 must heal the row."""
        stale_time = timezone.now() - timedelta(days=31)
        ph = _make_pub_hours(fetched_at=stale_time, status=PubHours.Status.ERROR)
        # Task is stuck at max attempts but never marked done.
        _make_task(attempts=3, max_attempts=3, done=False)

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            _run_command()

        # Phase 1 skips the maxed-out task; phase 2 refreshes the stale row.
        assert instance.fetch.call_count == 1
        ph.refresh_from_db()
        assert ph.status == PubHours.Status.OK

    def test_pending_rows_not_touched_by_stale_refresh(self):
        """PubHours with status=pending are not touched by the stale-refresh phase."""
        stale_time = timezone.now() - timedelta(days=31)
        _make_pub_hours(fetched_at=stale_time, status=PubHours.Status.PENDING)

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            _run_command()

        # Stale refresh skips pending rows
        assert instance.fetch.call_count == 0


@pytest.mark.django_db
class TestDryRun:
    """--dry-run fetches from Firmy but writes nothing to the database."""

    def test_dry_run_pending_task_no_db_write(self):
        task = _make_task()

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            out, _ = _run_command("--dry-run")

        # No PubHours row was created
        assert not PubHours.objects.filter(cache_key=_CACHE_KEY).exists()

        # Task was NOT modified
        task.refresh_from_db()
        assert task.done is False
        assert task.attempts == 0

        assert "dry-run" in out.lower()

    def test_dry_run_stale_row_not_updated(self):
        stale_time = timezone.now() - timedelta(days=31)
        ph = _make_pub_hours(fetched_at=stale_time)
        original_hours = ph.opening_hours_raw

        new_result = RawHours(
            opening_hours_raw="Mo-Fr 09:00-21:00",
            source="firmy",
            source_ref="272313",
            matched_name=_PUB_NAME,
            matched_lat=_LAT,
            matched_lng=_LNG,
            confidence=0.88,
        )

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = new_result

            _run_command("--dry-run")

        ph.refresh_from_db()
        assert ph.opening_hours_raw == original_hours  # unchanged

    def test_dry_run_outputs_warning(self):
        _make_task()

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            out, _ = _run_command("--dry-run")

        assert "dry-run" in out.lower()


@pytest.mark.django_db
class TestLimitFlag:
    """--limit N caps total rows processed."""

    def test_limit_caps_pending_tasks(self):
        # Create 5 pending tasks
        for i in range(5):
            EnrichTask.objects.create(
                cache_key=geohash8(_LAT + i * 0.01, _LNG),
                name=f"Pub {i}",
                lat=_LAT + i * 0.01,
                lng=_LNG,
                attempts=0,
                max_attempts=3,
                done=False,
            )

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            _run_command("--limit", "2")

        assert instance.fetch.call_count == 2
        assert PubHours.objects.count() == 2

    def test_limit_zero_means_no_limit(self):
        for i in range(4):
            EnrichTask.objects.create(
                cache_key=geohash8(_LAT + i * 0.01, _LNG),
                name=f"Pub {i}",
                lat=_LAT + i * 0.01,
                lng=_LNG,
                attempts=0,
                max_attempts=3,
                done=False,
            )

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            _run_command("--limit", "0")

        assert instance.fetch.call_count == 4

    def test_limit_across_tasks_and_stale(self):
        """Limit applies to the sum of pending tasks + stale refreshes."""
        # 1 pending task
        _make_task()

        # 1 stale PubHours row (different cache_key)
        stale_key = geohash8(_LAT + 0.1, _LNG + 0.1)
        stale_time = timezone.now() - timedelta(days=31)
        PubHours.objects.create(
            cache_key=stale_key,
            name="Other Pub",
            lat=_LAT + 0.1,
            lng=_LNG + 0.1,
            opening_hours_raw="Mo-Fr 10:00-22:00",
            source="firmy",
            status=PubHours.Status.OK,
            fetched_at=stale_time,
        )

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            # Limit 1 → only the pending task is processed; stale refresh is skipped
            _run_command("--limit", "1")

        assert instance.fetch.call_count == 1


@pytest.mark.django_db
class TestAttemptTracking:
    """attempts counter increments; after max_attempts task is marked done."""

    def test_attempts_incremented_on_each_run(self):
        task = _make_task(attempts=0, max_attempts=3)

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            # Simulate fetch raising a non-cap exception
            instance.fetch.side_effect = Exception("network glitch")

            _run_command()

        task.refresh_from_db()
        assert task.attempts == 1
        assert task.done is False  # Still has remaining attempts

    def test_recent_failed_task_waits_for_retry_cooldown(self, settings):
        settings.FIRMY_ERROR_RETRY_COOLDOWN_MINUTES = 15
        task = _make_task(
            attempts=1,
            max_attempts=3,
            last_attempt_at=timezone.now() - timedelta(minutes=5),
        )

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            _run_command()

        instance.fetch.assert_not_called()
        task.refresh_from_db()
        assert task.attempts == 1
        assert task.done is False

    def test_task_marked_done_after_max_attempts(self):
        task = _make_task(attempts=2, max_attempts=3)

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.side_effect = Exception("still failing")

            _run_command()

        task.refresh_from_db()
        assert task.attempts == 3
        assert task.done is True

    def test_successful_fetch_marks_done(self):
        task = _make_task(attempts=1, max_attempts=3)

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            _run_command()

        task.refresh_from_db()
        assert task.done is True
        assert task.attempts == 2


@pytest.mark.django_db
class TestOutputMessages:
    """Verify informational output messages are present."""

    def test_success_output_contains_count(self):
        _make_task()

        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()
            instance.fetch.return_value = _GOOD_RESULT

            out, _ = _run_command()

        assert "1" in out
        assert "Done" in out or "done" in out.lower()

    def test_zero_items_output(self):
        """No tasks, no stale rows → output says 0 processed."""
        with patch(FIRMY_SOURCE_PATH) as MockSource:
            instance = MockSource.return_value
            instance._owns_session = True
            instance._session = MagicMock()

            out, _ = _run_command()

        assert "0" in out
