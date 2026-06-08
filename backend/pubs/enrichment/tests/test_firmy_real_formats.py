"""
Regression tests for the REAL opening-hours formats Firmy.cz serves.

These encode behaviour verified live against firmy.cz (2026-06-08) so the
pipeline's handling of nonstop / closed-by-omission / single-digit-hour /
midnight-close venues can never silently regress.

Facts locked in here:
  * nonstop = a bare weekday list with NO times ("Mo,Tu,...,Su") -> open 24h
  * a closed day is conveyed by OMITTING the day, never by "00:00-00:00"
  * times may be single-digit ("8:00") and close at midnight ("0:00")
"""

import datetime as dt
from zoneinfo import ZoneInfo

from pubs.enrichment import is_open_now, normalize_to_osm

TZ = ZoneInfo("Europe/Prague")


# 2024-01-15 is a Monday; 19 = Fri, 20 = Sat, 21 = Sun.
def _at(day: int, hour: int, minute: int = 0) -> dt.datetime:
    return dt.datetime(2024, 1, day, hour, minute, tzinfo=TZ)


class TestNonstopBareDays:
    """Casinos / non-stop venues: Firmy emits the day list with no times."""

    EXPR = "Mo,Tu,We,Th,Fr,Sa,Su"

    def test_normalizer_passes_bare_days_through(self):
        assert normalize_to_osm(self.EXPR) == self.EXPR

    def test_open_in_the_middle_of_the_night(self):
        assert is_open_now(self.EXPR, _at(16, 3)) is True  # Tue 03:00

    def test_open_on_sunday(self):
        assert is_open_now(self.EXPR, _at(21, 12)) is True


class TestClosedByOmission:
    """A closed day is simply absent from the list (no Sunday here)."""

    EXPR = "Mo,Tu,We,Th,Fr,Sa 11:00-22:00"

    def test_closed_on_omitted_sunday(self):
        assert is_open_now(self.EXPR, _at(21, 12)) is False

    def test_open_on_listed_monday(self):
        assert is_open_now(self.EXPR, _at(15, 12)) is True


class TestSingleDigitHours:
    """Firmy emits single-digit hours like '8:00'."""

    def test_normalizer_keeps_single_digit_open(self):
        assert normalize_to_osm(["Mo 8:00–23:00"]) == "Mo 8:00-23:00"

    def test_closed_before_single_digit_open(self):
        assert is_open_now("Mo 8:00-23:00", _at(15, 7)) is False

    def test_open_after_single_digit_open(self):
        assert is_open_now("Mo 8:00-23:00", _at(15, 9)) is True


class TestMidnightClose:
    """Real Firmy value: ['Tu,We,Th 17:00-22:00', 'Fr,Sa 17:00-0:00']."""

    EXPR = "Fr,Sa 17:00-0:00"

    def test_normalizer_list_with_midnight_close(self):
        result = normalize_to_osm(["Tu,We,Th 17:00–22:00", "Fr,Sa 17:00–0:00"])
        assert result == "Tu,We,Th 17:00-22:00; Fr,Sa 17:00-0:00"

    def test_closed_before_evening_open(self):
        assert is_open_now(self.EXPR, _at(19, 12)) is False  # Fri 12:00

    def test_open_friday_evening(self):
        assert is_open_now(self.EXPR, _at(19, 20)) is True  # Fri 20:00

    def test_open_just_before_midnight(self):
        assert is_open_now(self.EXPR, _at(19, 23, 30)) is True  # Fri 23:30


class TestZeroZeroRangeIsOpenNotClosed:
    """The crux: '00:00-00:00' must NEVER be produced as a stand-in for 'closed'.

    The evaluator reads it as open-24h, so the normalizer must never invent it
    to mean closed (the real closed signal is an omitted day).
    """

    def test_zero_zero_range_reads_as_open(self):
        assert is_open_now("Su 00:00-00:00", _at(21, 12)) is True
