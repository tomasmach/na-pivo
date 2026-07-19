from __future__ import annotations

import json

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from pubs.models import PubDirectory, PubHours, UserAddedPub


def _directory_pub(name: str, lat: float, lng: float, country: str) -> None:
    PubDirectory.objects.create(
        name=name,
        lat=lat,
        lng=lng,
        city="Test",
        country=country,
        venue_kind=PubHours.VenueKind.PUB,
        source="test",
        refreshed_at=timezone.now(),
    )


@pytest.mark.django_db
def test_check_pub_coverage_reports_supported_and_community_only_samples(capsys):
    _directory_pub("Brněnská hospoda", 49.1951, 16.6068, "cz")
    UserAddedPub.objects.create(
        client_id="08b8e907-5bfd-4bd5-af5a-cdfdc18c1fb5",
        cache_key="28rzzzzz",
        name="Tenerife bar",
        lat=28.2916,
        lng=-16.6291,
    )

    call_command(
        "check_pub_coverage",
        "--sample",
        "Brno,49.1951,16.6068,5,1",
        "--sample",
        "Tenerife,28.2916,-16.6291,10,0",
    )

    body = json.loads(capsys.readouterr().out)
    assert body["failed_supported_samples"] == []
    assert body["samples"][0] == {
        "community_pubs": 0,
        "country": "cz",
        "directory_pubs": 1,
        "minimum_directory_pubs": 1,
        "mode": "directory_and_community",
        "name": "Brno",
        "passed": True,
        "radius_km": 5.0,
    }
    assert body["samples"][1]["mode"] == "community_only"
    assert body["samples"][1]["community_pubs"] == 1
    assert body["samples"][1]["passed"] is True


@pytest.mark.django_db
def test_check_pub_coverage_strict_fails_below_minimum(capsys):
    with pytest.raises(CommandError, match="Coverage below minimum: Brno"):
        call_command(
            "check_pub_coverage",
            "--sample",
            "Brno,49.1951,16.6068,5,1",
            "--strict",
        )

    body = json.loads(capsys.readouterr().out.splitlines()[0])
    assert body["failed_supported_samples"] == ["Brno"]
    assert body["samples"][0]["passed"] is False
