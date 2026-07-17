"""Tests for pubs.enrichment.is_open."""

import zoneinfo
from datetime import datetime

from pubs.enrichment.is_open import is_open_now, next_change

TZ = "Europe/Prague"
PRAGUE = zoneinfo.ZoneInfo(TZ)


def dt(year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    """Create a timezone-aware Prague datetime."""
    return datetime(year, month, day, hour, minute, tzinfo=PRAGUE)


class TestIsOpenNow:
    # -------------------------------------------------------------------------
    # Basic cases
    # -------------------------------------------------------------------------

    def test_open_within_hours(self):
        # Monday 2024-01-15 12:00 Prague, pub is Mo-Su 10:00-23:00
        result = is_open_now("Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00", dt(2024, 1, 15, 12))
        assert result is True

    def test_closed_before_opening(self):
        result = is_open_now("Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00", dt(2024, 1, 15, 9))
        assert result is False

    def test_closed_after_hours(self):
        result = is_open_now("Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00", dt(2024, 1, 15, 23, 30))
        assert result is False

    def test_24_7_always_open(self):
        result = is_open_now("24/7", dt(2024, 1, 15, 3, 0))
        assert result is True

    def test_closed_on_day_off(self):
        # Weekday-only pub, checking on Sunday (2024-01-14)
        result = is_open_now("Mo-Fr 09:00-17:00", dt(2024, 1, 14, 12))  # Sunday
        assert result is False

    def test_open_on_weekday(self):
        # Monday 2024-01-15 10:00
        result = is_open_now("Mo-Fr 09:00-17:00", dt(2024, 1, 15, 10))
        assert result is True

    # -------------------------------------------------------------------------
    # Overnight hours
    # -------------------------------------------------------------------------

    def test_overnight_open_before_midnight(self):
        # Mo-Fr 18:00-02:00 — Monday 23:00 → open
        result = is_open_now("Mo-Fr 18:00-02:00", dt(2024, 1, 15, 23, 0))
        assert result is True

    def test_overnight_open_after_midnight(self):
        # Mo-Fr 18:00-02:00 — Tuesday 01:00 → still open from Monday
        result = is_open_now("Mo-Fr 18:00-02:00", dt(2024, 1, 16, 1, 0))
        assert result is True

    def test_overnight_closed_midday(self):
        # Mo-Fr 18:00-02:00 — Tuesday 10:00 → closed
        result = is_open_now("Mo-Fr 18:00-02:00", dt(2024, 1, 16, 10, 0))
        assert result is False

    def test_midnight_close_open_before(self):
        # closes at 00:00 = midnight; 23:00 should be open
        result = is_open_now("Mo-Fr 10:00-00:00", dt(2024, 1, 15, 23, 0))
        assert result is True

    def test_off_token_is_closed(self):
        """The OSM 'off' token must evaluate as CLOSED (not open 24h).

        ('off' is valid OSM grammar for an explicitly-closed day. Note: Firmy.cz
        itself conveys a closed day by OMITTING it, not via 'off' — see
        test_firmy_real_formats — but the evaluator must still handle 'off'.)
        """
        # Sunday 2024-01-14 12:00 Prague
        result = is_open_now("Mo-Sa 10:00-22:00; Su off", dt(2024, 1, 14, 12, 0))
        assert result is False

    def test_open_range_with_closed_sunday(self):
        """Sanity: the Mo-Sa range is still honoured when Sunday is 'off'."""
        # Monday 2024-01-15 12:00 → open
        result = is_open_now("Mo-Sa 10:00-22:00; Su off", dt(2024, 1, 15, 12, 0))
        assert result is True

    # -------------------------------------------------------------------------
    # U Fleků real example
    # -------------------------------------------------------------------------

    def test_ufleku_open_at_noon_monday(self):
        result = is_open_now("Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00", dt(2024, 1, 15, 14, 0))
        assert result is True

    def test_ufleku_closed_before_opening(self):
        result = is_open_now("Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00", dt(2024, 1, 15, 8, 0))
        assert result is False

    # -------------------------------------------------------------------------
    # Edge cases
    # -------------------------------------------------------------------------

    def test_empty_string_returns_none(self):
        assert is_open_now("", dt(2024, 1, 15, 12)) is None

    def test_none_like_unparseable_returns_none(self):
        assert is_open_now("NOT_VALID_HOURS ??##", dt(2024, 1, 15, 12)) is None

    def test_naive_datetime_treated_as_prague(self):
        # naive dt should be treated as Prague
        naive = datetime(2024, 1, 15, 12, 0)
        result = is_open_now("Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00", naive)
        assert result is True

    def test_utc_datetime_converted(self):
        import zoneinfo as zi
        utc_noon = datetime(2024, 1, 15, 11, 0, tzinfo=zi.ZoneInfo("UTC"))
        # UTC 11:00 = Prague 12:00 (CET is UTC+1)
        result = is_open_now("Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00", utc_noon)
        assert result is True


class TestNextChange:
    def test_next_change_from_closed(self):
        # Monday 09:00 (closed) → next change is 10:00 (opening)
        result = next_change("Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00", dt(2024, 1, 15, 9, 0))
        assert result is not None
        assert result.hour == 10
        assert result.minute == 0

    def test_next_change_from_open(self):
        # Monday 12:00 (open) → next change is 23:00 (closing)
        result = next_change("Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00", dt(2024, 1, 15, 12, 0))
        assert result is not None
        assert result.hour == 23
        assert result.minute == 0

    def test_24_7_next_change_is_none(self):
        # 24/7 never changes state
        result = next_change("24/7", dt(2024, 1, 15, 12, 0))
        assert result is None

    def test_empty_string_returns_none(self):
        assert next_change("", dt(2024, 1, 15, 12)) is None
