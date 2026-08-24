from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection

from pubs.community_events import (
    COMMUNITY_EVENT_TEAM_MAX_MEMBERS,
    CommunityEvent,
    CommunityEventMembership,
    CommunityEventTeam,
    CommunityEventTeamMembership,
)
from pubs.management.commands.seed_dev_3_0 import (
    SEED_CLIENT_PREFIX,
    SEED_DEVICE_PREFIX,
    SEED_DIRECTORY_SOURCE,
)
from pubs.models import (
    Account,
    DrinkLog,
    Friendship,
    PubCommunityData,
    PubDirectory,
    PublishedNight,
    PubVisit,
)

pytestmark = pytest.mark.skipif(
    connection.vendor != "sqlite",
    reason="seed_dev_3_0 deliberately refuses every non-SQLite database",
)

NOW = datetime(2026, 8, 6, 12, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _debug_seed_settings(settings):
    settings.DEBUG = True


def _target(*, nickname: str | None = "Tester") -> Account:
    return Account.objects.create(
        device_id=f"target-{uuid.uuid4()}",
        nickname=nickname,
        display_name="Původní jméno",
        is_public=False,
        ghost_mode=True,
    )


def _run(*args: str) -> str:
    stdout = StringIO()
    with patch("pubs.management.commands.seed_dev_3_0.timezone.now", return_value=NOW):
        call_command("seed_dev_3_0", *args, stdout=stdout)
    return stdout.getvalue()


@pytest.mark.django_db
def test_seed_requires_debug_and_sqlite(settings):
    target = _target()
    settings.DEBUG = False
    with pytest.raises(CommandError, match="settings.DEBUG"):
        _run("--nickname", target.nickname)

    settings.DEBUG = True
    fake_connection = SimpleNamespace(vendor="postgresql")
    with patch("pubs.management.commands.seed_dev_3_0.connection", fake_connection):
        with pytest.raises(CommandError, match="not SQLite"):
            _run("--nickname", target.nickname)


@pytest.mark.django_db
def test_list_accounts_exposes_public_identifiers_not_device_ids():
    target = _target(nickname=None)
    seed = Account.objects.create(
        device_id=f"{SEED_DEVICE_PREFIX}existing",
        nickname="SeedUcet",
    )

    output = _run("--list-accounts")

    assert "bez přezdívky" in output
    assert str(target.public_id) in output
    assert target.device_id not in output
    assert str(seed.public_id) not in output
    assert seed.device_id not in output


@pytest.mark.django_db
def test_seed_populates_consistent_release_verification_data():
    target = _target()

    output = _run("--account-id", str(target.public_id))

    seed_accounts = list(
        Account.objects.filter(device_id__startswith=SEED_DEVICE_PREFIX).order_by("device_id")
    )
    assert len(seed_accounts) == 4
    assert all(account.is_public and not account.ghost_mode for account in seed_accounts)
    assert all(not account.avatar for account in seed_accounts)
    assert "10 published nights" in output
    assert "3 community events" in output
    assert "50.0876, 14.4211" in output

    accepted = Friendship.objects.filter(
        requester=target,
        status=Friendship.Status.ACCEPTED,
    )
    assert set(accepted.values_list("recipient__nickname", flat=True)) == {
        "KlaraNaCepu",
        "MarekStamgast",
    }
    incoming = Friendship.objects.get(
        requester__nickname="SonaPivniMapa",
        recipient=target,
    )
    assert incoming.status == Friendship.Status.PENDING
    assert not Friendship.objects.filter(
        requester__nickname="PavelNovyStul",
        recipient=target,
    ).exists()

    assert PubDirectory.objects.filter(source=SEED_DIRECTORY_SOURCE).count() == 4
    assert PubCommunityData.objects.count() == 4
    assert all(
        item["price_czk"] is None
        for row in PubCommunityData.objects.all()
        for item in row.beers
    )

    assert PubVisit.objects.filter(account=target).count() == 6
    assert DrinkLog.objects.filter(account=target).count() == 8
    assert PublishedNight.objects.filter(account=target).count() == 2

    for night in PublishedNight.objects.all():
        drinks = DrinkLog.objects.filter(
            account=night.account,
            drank_at__gte=night.started_at,
            drank_at__lte=night.ended_at,
        )
        assert night.beer_count == drinks.filter(
            drink_type=DrinkLog.DrinkType.BEER
        ).count()
        assert night.wine_count == drinks.filter(
            drink_type=DrinkLog.DrinkType.WINE
        ).count()
        assert night.soft_drink_count == drinks.filter(
            drink_type=DrinkLog.DrinkType.SOFT_DRINK
        ).count()
        assert night.shot_count == drinks.filter(
            drink_type=DrinkLog.DrinkType.SHOT
        ).count()
        visit_names = set(
            PubVisit.objects.filter(
                account=night.account,
                started_at__gte=night.started_at,
                started_at__lte=night.ended_at,
            ).values_list("name", flat=True)
        )
        assert set(night.pub_names) == visit_names

    assert CommunityEvent.objects.count() == 3
    joined = CommunityEventMembership.objects.get(
        event__title="Pivo a deskovky",
        account=target,
    )
    assert joined.status == CommunityEventMembership.Status.APPROVED
    pending = CommunityEventMembership.objects.get(
        event__title="Sraz Na Pivo",
        account__nickname="SonaPivniMapa",
    )
    assert pending.status == CommunityEventMembership.Status.PENDING

    teams = list(
        CommunityEventTeam.objects.filter(event=joined.event)
        .prefetch_related("memberships")
        .order_by("name")
    )
    assert {team.name for team in teams} == {"Pěna", "Říz"}
    target_team = CommunityEventTeamMembership.objects.get(
        event=joined.event,
        account=target,
    )
    assert target_team.team.name == "Pěna"
    assert target_team.slot == 1
    host_team = CommunityEventTeamMembership.objects.get(
        event=joined.event,
        account=joined.event.host,
    )
    assert host_team.team.name == "Říz"
    assert host_team.slot == 1
    assert all(
        team.memberships.count() < COMMUNITY_EVENT_TEAM_MAX_MEMBERS for team in teams
    )

    target.refresh_from_db()
    assert target.display_name == "Původní jméno"
    assert target.is_public is False
    assert target.ghost_mode is True


@pytest.mark.django_db
def test_seed_creates_two_joinable_teams_for_the_approved_event():
    target = _target()

    _run("--nickname", target.nickname)

    joined_event = CommunityEvent.objects.get(title="Pivo a deskovky")
    teams = list(
        CommunityEventTeam.objects.filter(event=joined_event)
        .prefetch_related("memberships")
        .order_by("name")
    )
    assert [team.name for team in teams] == ["Pěna", "Říz"]
    assert CommunityEventTeamMembership.objects.get(
        event=joined_event,
        account=target,
    ).team.name == "Pěna"
    assert all(
        team.memberships.count() < COMMUNITY_EVENT_TEAM_MAX_MEMBERS for team in teams
    )


@pytest.mark.django_db
def test_seed_is_idempotent():
    target = _target()
    args = ("--device-id", target.device_id)

    _run(*args)
    first = {
        "accounts": Account.objects.filter(device_id__startswith=SEED_DEVICE_PREFIX).count(),
        "friendships": Friendship.objects.count(),
        "pubs": PubDirectory.objects.filter(source=SEED_DIRECTORY_SOURCE).count(),
        "visits": PubVisit.objects.count(),
        "drinks": DrinkLog.objects.count(),
        "nights": PublishedNight.objects.count(),
        "events": CommunityEvent.objects.count(),
        "memberships": CommunityEventMembership.objects.count(),
        "teams": CommunityEventTeam.objects.count(),
        "team_memberships": CommunityEventTeamMembership.objects.count(),
    }
    night_ids = set(PublishedNight.objects.values_list("pk", flat=True))
    event_ids = set(CommunityEvent.objects.values_list("pk", flat=True))
    team_ids = set(CommunityEventTeam.objects.values_list("pk", flat=True))

    _run(*args)

    second = {
        "accounts": Account.objects.filter(device_id__startswith=SEED_DEVICE_PREFIX).count(),
        "friendships": Friendship.objects.count(),
        "pubs": PubDirectory.objects.filter(source=SEED_DIRECTORY_SOURCE).count(),
        "visits": PubVisit.objects.count(),
        "drinks": DrinkLog.objects.count(),
        "nights": PublishedNight.objects.count(),
        "events": CommunityEvent.objects.count(),
        "memberships": CommunityEventMembership.objects.count(),
        "teams": CommunityEventTeam.objects.count(),
        "team_memberships": CommunityEventTeamMembership.objects.count(),
    }
    assert second == first
    assert set(PublishedNight.objects.values_list("pk", flat=True)) == night_ids
    assert set(CommunityEvent.objects.values_list("pk", flat=True)) == event_ids
    assert set(CommunityEventTeam.objects.values_list("pk", flat=True)) == team_ids


@pytest.mark.django_db
def test_seed_preserves_a_real_night_on_a_conflicting_drinking_day():
    target = _target()
    day = (NOW - timedelta(days=1)).date()
    original = PublishedNight.objects.create(
        account=target,
        client_id="real-local-night",
        drinking_day=day,
        started_at=NOW - timedelta(days=1, hours=4),
        ended_at=NOW - timedelta(days=1),
        beer_count=7,
        wine_count=0,
        soft_drink_count=0,
        shot_count=0,
        pub_names=["Moje skutečná hospoda"],
        city="Praha",
        duration_minutes=240,
        visibility=PublishedNight.Visibility.PUBLIC,
        updated_at=NOW - timedelta(days=1),
    )

    output = _run("--nickname", target.nickname)

    original.refresh_from_db()
    assert original.client_id == "real-local-night"
    assert original.beer_count == 7
    assert original.pub_names == ["Moje skutečná hospoda"]
    assert not PublishedNight.objects.filter(
        account=target,
        client_id=f"{SEED_CLIENT_PREFIX}recent",
    ).exists()
    assert "Preserved 1 existing local night" in output


@pytest.mark.django_db
def test_seed_rejects_unknown_or_seed_target():
    with pytest.raises(CommandError, match="No active local account"):
        _run("--account-id", "not-a-uuid")

    seed = Account.objects.create(
        device_id=f"{SEED_DEVICE_PREFIX}target",
        nickname="SeedTarget",
    )
    with pytest.raises(CommandError, match="seed account"):
        _run("--nickname", seed.nickname)
