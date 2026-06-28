from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from django.core.management import call_command

from pubs.enrichment import geohash8
from pubs.models import UserAddedPub
from pubs.user_added_pub_geocoding import ResolvedPubLocation


@pytest.mark.django_db
def test_fix_user_added_pub_locations_dry_run_does_not_write(capsys):
    pub = UserAddedPub.objects.create(
        client_id="aaaaaaaa-0000-0000-0000-000000000001",
        cache_key=geohash8(50.08, 14.42),
        name="Hospoda U Testu",
        lat=50.08,
        lng=14.42,
        city="Praha",
        address="Pekařská 1",
        active=True,
    )
    resolved = ResolvedPubLocation(
        name="Hospoda U Testu",
        lat=49.1951,
        lng=16.6068,
        city="Brno",
        address="Pekařská 1",
        result_type="regional.address",
    )

    with patch(
        "pubs.management.commands.fix_user_added_pub_locations.resolve_user_added_pub_location",
        return_value=resolved,
    ):
        call_command("fix_user_added_pub_locations")

    pub.refresh_from_db()
    assert pub.lat == 50.08
    assert pub.lng == 14.42
    output = json.loads(capsys.readouterr().out)
    assert output["dry_run"] is True
    assert output["updates"] == 1
    assert output["records"][0]["new_cache_key"] == geohash8(resolved.lat, resolved.lng)


@pytest.mark.django_db
def test_fix_user_added_pub_locations_apply_updates_far_address(capsys):
    pub = UserAddedPub.objects.create(
        client_id="aaaaaaaa-0000-0000-0000-000000000001",
        cache_key=geohash8(50.08, 14.42),
        name="Hospoda U Testu",
        lat=50.08,
        lng=14.42,
        city="",
        address="Pekařská 1",
        active=True,
    )
    resolved = ResolvedPubLocation(
        name="Hospoda U Testu",
        lat=49.1951,
        lng=16.6068,
        city="Brno",
        address="Pekařská 1",
        result_type="regional.address",
    )

    with patch(
        "pubs.management.commands.fix_user_added_pub_locations.resolve_user_added_pub_location",
        return_value=resolved,
    ):
        call_command("fix_user_added_pub_locations", "--apply")

    pub.refresh_from_db()
    assert pub.lat == resolved.lat
    assert pub.lng == resolved.lng
    assert pub.cache_key == geohash8(resolved.lat, resolved.lng)
    assert pub.city == "Brno"
    output = json.loads(capsys.readouterr().out)
    assert output["dry_run"] is False
    assert output["updates"] == 1


@pytest.mark.django_db
def test_fix_user_added_pub_locations_skips_nearby_result(capsys):
    pub = UserAddedPub.objects.create(
        client_id="aaaaaaaa-0000-0000-0000-000000000001",
        cache_key=geohash8(50.08, 14.42),
        name="Hospoda U Testu",
        lat=50.08,
        lng=14.42,
        city="Praha",
        address="Testovací 12",
        active=True,
    )
    resolved = ResolvedPubLocation(
        name="Hospoda U Testu",
        lat=50.0801,
        lng=14.4201,
        city="Praha",
        address="Testovací 12",
        result_type="poi",
    )

    with patch(
        "pubs.management.commands.fix_user_added_pub_locations.resolve_user_added_pub_location",
        return_value=resolved,
    ):
        call_command("fix_user_added_pub_locations", "--apply")

    pub.refresh_from_db()
    assert pub.lat == 50.08
    assert pub.lng == 14.42
    output = json.loads(capsys.readouterr().out)
    assert output["updates"] == 0
    assert output["unchanged"] == 1
