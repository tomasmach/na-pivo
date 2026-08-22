import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from pubs import accounts
from pubs.models import (
    Account,
    CommunityEvent,
    CommunityEventMembership,
    CommunityEventTeam,
    CommunityEventTeamMembership,
    PartyEvening,
    PartyEveningMember,
    PartyGame,
    PartyGameEvent,
)


@pytest.mark.django_db
def test_hard_delete_nulls_shared_ownership_fields():
    now = timezone.now()
    host = Account.objects.create(device_id=uuid.uuid4().hex)
    other = Account.objects.create(device_id=uuid.uuid4().hex)

    evening = PartyEvening.objects.create(
        client_id=uuid.uuid4(),
        join_code="ABCD1234",
        host=host,
        pub_name="U tří sudů",
    )
    PartyEveningMember.objects.create(evening=evening, account=other)

    game = PartyGame.objects.create(
        client_id=uuid.uuid4(),
        evening=evening,
        started_by=host,
        catalog_key="quiz",
        name="Kvíz",
    )

    game_event = PartyGameEvent.objects.create(
        game=game,
        account=host,
        subject=host,
        client_id=uuid.uuid4(),
        kind=PartyGameEvent.Kind.SCORE,
        delta=2,
        payload={"question": 3, "choice": "B"},
    )

    event = CommunityEvent.objects.create(
        host=host,
        client_id=uuid.uuid4(),
        title="Večer u stolu",
        description="",
        city="Praha",
        area_label="",
        exact_address="Hospoda 1",
        lat=50.0755,
        lng=14.4378,
        starts_at=now + timedelta(days=1),
        ends_at=now + timedelta(days=2),
        capacity=4,
        adults_only=True,
    )
    membership = CommunityEventMembership.objects.create(
        event=event, account=other, status=CommunityEventMembership.Status.APPROVED
    )
    team = CommunityEventTeam.objects.create(
        event=event, created_by=host, client_id=uuid.uuid4(), name="Parta A"
    )
    team_membership = CommunityEventTeamMembership.objects.create(
        event=event, team=team, account=other, slot=1
    )

    evening_id = evening.id
    game_id = game.id
    game_event_id = game_event.id
    event_id = event.id
    team_id = team.id
    other_id = other.id

    accounts.hard_delete(host)

    evening.refresh_from_db()
    game.refresh_from_db()
    game_event.refresh_from_db()

    assert evening.host_id == other_id
    assert game.started_by_id is None
    assert game_event.account_id is None
    assert game_event.subject_id is None
    assert game_event.kind == PartyGameEvent.Kind.SCORE
    assert game_event.payload == {"question": 3, "choice": "B"}

    assert PartyEvening.objects.filter(id=evening_id).exists()
    assert PartyGame.objects.filter(id=game_id).exists()
    assert PartyGameEvent.objects.filter(id=game_event_id).exists()
    assert Account.objects.filter(id=other_id).exists()
    assert PartyEveningMember.objects.filter(
        evening_id=evening_id, account_id=other_id
    ).exists()
    assert not CommunityEvent.objects.filter(id=event_id).exists()
    assert not CommunityEventTeam.objects.filter(id=team_id).exists()
    assert not CommunityEventMembership.objects.filter(id=membership.id).exists()
    assert not CommunityEventTeamMembership.objects.filter(
        id=team_membership.id
    ).exists()
