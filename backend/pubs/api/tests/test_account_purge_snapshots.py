import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from pubs import accounts
from pubs.models import (
    Account,
    FriendNotification,
    PartyEvening,
    PartyGame,
    PublishedNight,
)


@pytest.mark.django_db
def test_hard_delete_scrubs_snapshot_arrays_and_actor_notifications():
    deleted = Account.objects.create(device_id="purge-deleted")
    other = Account.objects.create(device_id="purge-other")

    target = str(deleted.public_id)

    now = timezone.now()
    night = PublishedNight.objects.create(
        account=other,
        client_id="night-1",
        drinking_day=now.date(),
        started_at=now - timedelta(hours=4),
        ended_at=now,
        beer_count=1,
        wine_count=0,
        soft_drink_count=0,
        shot_count=0,
        visibility=PublishedNight.Visibility.FRIENDS,
        updated_at=now,
        participant_ids=[
            str(other.public_id),
            target,
            123,
            target,
            None,
        ],
    )
    evening = PartyEvening.objects.create(
        client_id=uuid.uuid4(),
        join_code="PURGE01",
        host=other,
        pub_name="Hospoda",
    )
    game = PartyGame.objects.create(
        client_id=uuid.uuid4(),
        evening=evening,
        started_by=other,
        catalog_key="quiz",
        name="Quiz",
        roster_account_ids=[target, str(other.public_id), 456],
    )
    actor_notification = FriendNotification.objects.create(
        recipient=other,
        actor=deleted,
        kind=FriendNotification.Kind.FRIEND_CHEERS,
        title="Na zdraví",
        body="Kamarád tě připil.",
        pub_name="Hospoda",
    )
    unrelated_notification = FriendNotification.objects.create(
        recipient=other,
        actor=other,
        kind=FriendNotification.Kind.FRIEND_REQUEST,
        title="Žádost",
        body="Někdo tě chce mít mezi kamarády.",
        pub_name="Jiná hospoda",
    )

    accounts.hard_delete(deleted)

    assert not Account.objects.filter(pk=deleted.pk).exists()
    assert Account.objects.filter(pk=other.pk).exists()

    night.refresh_from_db()
    assert night.participant_ids == [str(other.public_id), 123, None]

    game.refresh_from_db()
    assert game.roster_account_ids == [str(other.public_id), 456]

    assert not FriendNotification.objects.filter(pk=actor_notification.pk).exists()
    assert FriendNotification.objects.filter(pk=unrelated_notification.pk).exists()
    assert PublishedNight.objects.filter(pk=night.pk).exists()
    assert PartyGame.objects.filter(pk=game.pk).exists()
