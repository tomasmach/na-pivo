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

    for event in (future_event, started_event):
        event.refresh_from_db()
        assert event.status == CommunityEvent.Status.CANCELLED
        assert event.cancelled_at is not None
        assert event.cancelled_at > deleted_at

    cancelled_event.refresh_from_db()
    assert cancelled_event.status == CommunityEvent.Status.CANCELLED
    assert cancelled_event.cancelled_at == now - timedelta(days=10)

    for event in (future_event, started_event, cancelled_event):
        assert CommunityEvent.objects.filter(pk=event.pk).exists()
    membership.refresh_from_db()
    assert membership.account_id == other.id
    assert membership.status == CommunityEventMembership.Status.APPROVED
    team.refresh_from_db()
    assert team.created_by_id is None
    team_membership.refresh_from_db()
    assert team_membership.account_id == other.id
