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
)


@pytest.mark.django_db
def test_hard_delete_expired_account_resolves_shared_lifecycles():
    now = timezone.now()
    deleting = Account.objects.create(
        device_id=uuid.uuid4().hex,
        status=Account.Status.PENDING_DELETION,
        deleted_at=now - timedelta(days=40),
    )
    oldest = Account.objects.create(device_id=uuid.uuid4().hex)
    newer = Account.objects.create(device_id=uuid.uuid4().hex)
    inactive_member = Account.objects.create(device_id=uuid.uuid4().hex)
    other = Account.objects.create(device_id=uuid.uuid4().hex)

    evening_with_host = PartyEvening.objects.create(
        client_id=uuid.uuid4(),
        join_code="AAAA1111",
        host=deleting,
        pub_name="U Macha",
    )
    PartyEveningMember.objects.create(
        evening=evening_with_host,
        account=inactive_member,
        active=False,
        joined_at=now - timedelta(days=3),
    )
    PartyEveningMember.objects.create(
        evening=evening_with_host,
        account=newer,
        joined_at=now - timedelta(days=1),
    )
    PartyEveningMember.objects.create(
        evening=evening_with_host,
        account=oldest,
        joined_at=now - timedelta(days=2),
    )

    orphan_evening = PartyEvening.objects.create(
        client_id=uuid.uuid4(),
        join_code="BBBB2222",
        host=deleting,
        pub_name="Samota",
    )

    ended_evening = PartyEvening.objects.create(
        client_id=uuid.uuid4(),
        join_code="CCCC3333",
        host=deleting,
        pub_name="Dokořán",
        active=False,
        ended_at=now - timedelta(days=5),
    )

    future_event = CommunityEvent.objects.create(
        host=deleting,
        client_id=uuid.uuid4(),
        title="Budoucí večer",
        city="Praha",
        exact_address="Hospoda 1",
        lat=50.0755,
        lng=14.4378,
        starts_at=now + timedelta(days=1),
        ends_at=now + timedelta(days=2),
        capacity=4,
    )
    started_event = CommunityEvent.objects.create(
        host=deleting,
        client_id=uuid.uuid4(),
        title="Rozjetý večer",
        city="Brno",
        exact_address="Hospoda 2",
        lat=49.1951,
        lng=16.6068,
        starts_at=now - timedelta(hours=2),
        ends_at=now + timedelta(hours=6),
        capacity=4,
    )
    cancelled_event = CommunityEvent.objects.create(
        host=deleting,
        client_id=uuid.uuid4(),
        title="Zrušený dřív",
        city="Plzeň",
        exact_address="Hospoda 3",
        lat=49.7384,
        lng=13.3736,
        starts_at=now + timedelta(days=3),
        ends_at=now + timedelta(days=4),
        capacity=4,
        status=CommunityEvent.Status.CANCELLED,
        cancelled_at=now - timedelta(days=10),
    )
    membership = CommunityEventMembership.objects.create(
        event=future_event,
        account=other,
        status=CommunityEventMembership.Status.APPROVED,
    )
    team = CommunityEventTeam.objects.create(
        event=future_event,
        created_by=deleting,
        client_id=uuid.uuid4(),
        name="Parta A",
    )
    team_membership = CommunityEventTeamMembership.objects.create(
        event=future_event, team=team, account=other, slot=1
    )

    deleted_at = deleting.deleted_at
    epoch = deleting.deletion_epoch

    result = accounts.hard_delete_expired_account(
        deleting.pk,
        cutoff=now,
        expected_deletion_epoch=epoch,
    )

    assert result is True
    assert not Account.objects.filter(pk=deleting.pk).exists()

    evening_with_host.refresh_from_db()
    assert evening_with_host.host_id == oldest.id
    assert evening_with_host.active is True
    assert evening_with_host.ended_at is None

    orphan_evening.refresh_from_db()
    assert orphan_evening.host_id is None
    assert orphan_evening.active is False
    assert orphan_evening.ended_at is not None
    assert orphan_evening.ended_at > deleted_at

    ended_evening.refresh_from_db()
    assert ended_evening.active is False
    assert ended_evening.ended_at == now - timedelta(days=5)

    for event in (future_event, started_event, cancelled_event):
        assert not CommunityEvent.objects.filter(pk=event.pk).exists()

    assert not CommunityEventMembership.objects.filter(id=membership.id).exists()
    assert not CommunityEventTeam.objects.filter(id=team.id).exists()
    assert not CommunityEventTeamMembership.objects.filter(
        id=team_membership.id
    ).exists()


@pytest.mark.django_db
def test_soft_delete_ends_shared_lifecycles_and_cancel_does_not_restore_them():
    now = timezone.now()
    deleting = Account.objects.create(device_id=uuid.uuid4().hex)
    survivor = Account.objects.create(device_id=uuid.uuid4().hex)
    other_host = Account.objects.create(device_id=uuid.uuid4().hex)

    hosted_evening = PartyEvening.objects.create(
        client_id=uuid.uuid4(),
        join_code="SOFT1111",
        host=deleting,
        pub_name="U Konce",
    )
    hosted_membership = PartyEveningMember.objects.create(
        evening=hosted_evening,
        account=deleting,
    )
    survivor_membership = PartyEveningMember.objects.create(
        evening=hosted_evening,
        account=survivor,
    )
    joined_evening = PartyEvening.objects.create(
        client_id=uuid.uuid4(),
        join_code="SOFT2222",
        host=other_host,
        pub_name="U Sousedů",
    )
    joined_membership = PartyEveningMember.objects.create(
        evening=joined_evening,
        account=deleting,
    )
    hosted_event = CommunityEvent.objects.create(
        host=deleting,
        client_id=uuid.uuid4(),
        title="Budoucí setkání",
        city="Praha",
        exact_address="Testovací 12",
        lat=50.0755,
        lng=14.4378,
        starts_at=now + timedelta(days=1),
        ends_at=now + timedelta(days=1, hours=4),
        capacity=4,
    )

    accounts.schedule_deletion(deleting)

    deleting.refresh_from_db()
    hosted_evening.refresh_from_db()
    hosted_membership.refresh_from_db()
    joined_evening.refresh_from_db()
    joined_membership.refresh_from_db()
    survivor_membership.refresh_from_db()
    assert deleting.status == Account.Status.PENDING_DELETION
    assert hosted_evening.active is False
    assert hosted_evening.ended_at is not None
    assert hosted_membership.active is False
    assert hosted_membership.left_at is not None
    assert joined_membership.active is False
    assert joined_membership.left_at is not None
    assert joined_evening.active is True
    assert survivor_membership.active is True
    assert not CommunityEvent.objects.filter(pk=hosted_event.pk).exists()

    assert accounts.cancel_deletion(deleting) is True

    deleting.refresh_from_db()
    hosted_evening.refresh_from_db()
    hosted_membership.refresh_from_db()
    joined_membership.refresh_from_db()
    assert deleting.status == Account.Status.ACTIVE
    assert hosted_evening.active is False
    assert hosted_membership.active is False
    assert joined_membership.active is False
    assert not CommunityEvent.objects.filter(pk=hosted_event.pk).exists()


@pytest.mark.django_db
def test_soft_delete_removes_team_created_in_someone_elses_event():
    now = timezone.now()
    host = Account.objects.create(device_id=uuid.uuid4().hex)
    creator = Account.objects.create(device_id=uuid.uuid4().hex)
    guest = Account.objects.create(device_id=uuid.uuid4().hex)
    event = CommunityEvent.objects.create(
        host=host,
        client_id=uuid.uuid4(),
        title="Cizí setkání",
        city="Brno",
        exact_address="Testovací 24",
        lat=49.1951,
        lng=16.6068,
        starts_at=now + timedelta(days=1),
        ends_at=now + timedelta(days=1, hours=4),
        capacity=6,
    )
    CommunityEventMembership.objects.create(
        event=event,
        account=creator,
        status=CommunityEventMembership.Status.APPROVED,
    )
    CommunityEventMembership.objects.create(
        event=event,
        account=guest,
        status=CommunityEventMembership.Status.APPROVED,
    )
    team = CommunityEventTeam.objects.create(
        event=event,
        created_by=creator,
        client_id=uuid.uuid4(),
        name="Creatorův tým",
    )
    creator_seat = CommunityEventTeamMembership.objects.create(
        event=event,
        team=team,
        account=creator,
        slot=1,
    )
    guest_seat = CommunityEventTeamMembership.objects.create(
        event=event,
        team=team,
        account=guest,
        slot=2,
    )

    accounts.schedule_deletion(creator)

    assert CommunityEvent.objects.filter(pk=event.pk).exists()
    assert not CommunityEventTeam.objects.filter(pk=team.pk).exists()
    assert not CommunityEventTeamMembership.objects.filter(
        pk__in=(creator_seat.pk, guest_seat.pk)
    ).exists()
    assert CommunityEventMembership.objects.filter(
        event=event,
        account=guest,
        status=CommunityEventMembership.Status.APPROVED,
    ).exists()
    assert CommunityEventMembership.objects.filter(
        event=event,
        account=creator,
        status=CommunityEventMembership.Status.LEFT,
    ).exists()

    assert accounts.cancel_deletion(creator) is True
    assert not CommunityEventTeam.objects.filter(pk=team.pk).exists()
    assert not CommunityEventTeamMembership.objects.filter(account=guest).exists()


@pytest.mark.django_db
def test_soft_delete_removes_guest_from_someone_elses_event_and_team():
    now = timezone.now()
    host = Account.objects.create(device_id=uuid.uuid4().hex)
    creator = Account.objects.create(device_id=uuid.uuid4().hex)
    deleting_guest = Account.objects.create(device_id=uuid.uuid4().hex)
    event = CommunityEvent.objects.create(
        host=host,
        client_id=uuid.uuid4(),
        title="Cizí setkání",
        city="Praha",
        exact_address="Testovací 48",
        lat=50.0755,
        lng=14.4378,
        starts_at=now + timedelta(days=1),
        ends_at=now + timedelta(days=1, hours=4),
        capacity=6,
    )
    CommunityEventMembership.objects.create(
        event=event,
        account=creator,
        status=CommunityEventMembership.Status.APPROVED,
    )
    guest_membership = CommunityEventMembership.objects.create(
        event=event,
        account=deleting_guest,
        status=CommunityEventMembership.Status.APPROVED,
    )
    team = CommunityEventTeam.objects.create(
        event=event,
        created_by=creator,
        client_id=uuid.uuid4(),
        name="Cizí tým",
    )
    CommunityEventTeamMembership.objects.create(
        event=event,
        team=team,
        account=creator,
        slot=1,
    )
    guest_seat = CommunityEventTeamMembership.objects.create(
        event=event,
        team=team,
        account=deleting_guest,
        slot=2,
    )

    accounts.schedule_deletion(deleting_guest)

    guest_membership.refresh_from_db()
    assert CommunityEvent.objects.filter(pk=event.pk).exists()
    assert CommunityEventTeam.objects.filter(pk=team.pk).exists()
    assert not CommunityEventTeamMembership.objects.filter(pk=guest_seat.pk).exists()
    assert guest_membership.status == CommunityEventMembership.Status.LEFT
    assert guest_membership.decided_at is not None

    assert accounts.cancel_deletion(deleting_guest) is True
    guest_membership.refresh_from_db()
    assert guest_membership.status == CommunityEventMembership.Status.LEFT
    assert not CommunityEventTeamMembership.objects.filter(
        event=event,
        account=deleting_guest,
    ).exists()
