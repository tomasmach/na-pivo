"""Tests for the shared Firmy.cz request accounting, coverage gate and TTLs."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from pubs.enrichment.coverage import in_cz_bbox
from pubs.firmy_policy import firmy_source_options, is_fresh
from pubs.models import ExternalApiDailyUsage, PubHours


def _usage() -> dict[str, int]:
    return dict(
        ExternalApiDailyUsage.objects.filter(provider="firmy").values_list(
            "operation", "request_count"
        )
    )


@pytest.mark.django_db
def test_direct_and_proxy_requests_are_counted_separately(settings):
    settings.FIRMY_DAILY_CAP = 10
    settings.FIRMY_PROXY_DAILY_CAP = 2
    reserve = firmy_source_options()["request_budget"]

    assert reserve("direct") is True
    assert reserve("proxy") is True
    assert reserve("proxy") is True
    # The proxy cap refuses the third proxy request; direct still works.
    assert reserve("proxy") is False
    assert reserve("direct") is True

    assert _usage() == {"http": 4, "http_direct": 2, "http_proxy": 2}


@pytest.mark.django_db
def test_total_cap_covers_both_routes(settings):
    settings.FIRMY_DAILY_CAP = 2
    settings.FIRMY_PROXY_DAILY_CAP = 5
    reserve = firmy_source_options()["request_budget"]

    assert reserve("direct") is True
    assert reserve("proxy") is True
    assert reserve("direct") is False
    assert reserve("proxy") is False

    assert _usage() == {"http": 2, "http_direct": 1, "http_proxy": 1}


@pytest.mark.django_db
def test_direct_block_is_shared_across_processes_until_it_expires(settings):
    settings.FIRMY_DIRECT_BLOCK_COOLDOWN_MINUTES = 60
    worker = firmy_source_options()["direct_block"]
    web = firmy_source_options()["direct_block"]

    assert web.is_blocked() is False
    worker.mark_blocked()
    assert web.is_blocked() is True
    assert _usage() == {"http_direct_blocked": 1}

    ExternalApiDailyUsage.objects.update(updated_at=timezone.now() - timedelta(minutes=61))
    assert web.is_blocked() is False


@pytest.mark.parametrize(
    ("lat", "lng"),
    [
        (50.0812, 14.4182),  # Praha
        (51.0557, 14.3164),  # Lobendava, northernmost point
        (48.5525, 14.3336),  # southernmost point near Vyšší Brod
        (50.2520, 12.0908),  # Krásná, westernmost point
        (49.5500, 18.8589),  # Bukovec, easternmost point
        (50.9900, 14.4500),  # Šluknov, cut off by the coarse CZ_POLYGON
        (50.2290, 17.2050),  # Jeseník, cut off by the coarse CZ_POLYGON
        (50.5850, 16.3300),  # Broumov, cut off by the coarse CZ_POLYGON
        (48.9000, 17.7100),  # Strání, put into Slovakia by the coarse polygons
    ],
)
def test_czech_pubs_are_covered(lat, lng):
    assert in_cz_bbox(lat, lng)


@pytest.mark.parametrize(
    ("lat", "lng"),
    [
        (48.1486, 17.1077),  # Bratislava
        (48.2082, 16.3738),  # Wien
        (47.4979, 19.0402),  # Budapest
        (50.0647, 19.9450),  # Kraków
        (56.9496, 24.1052),  # Riga
        (39.9042, 116.4074),  # Beijing
    ],
)
def test_foreign_pubs_are_not_covered(lat, lng):
    assert not in_cz_bbox(lat, lng)


@pytest.mark.parametrize(
    ("status", "age_days", "fresh"),
    [
        (PubHours.Status.OK, 89, True),
        (PubHours.Status.OK, 91, False),
        (PubHours.Status.UNKNOWN, 179, True),
        (PubHours.Status.UNKNOWN, 181, False),
        (PubHours.Status.ERROR, 0, False),
    ],
)
def test_ok_and_unknown_rows_have_separate_ttls(status, age_days, fresh):
    row = PubHours(status=status, fetched_at=timezone.now() - timedelta(days=age_days))
    assert is_fresh(row) is fresh
