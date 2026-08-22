import json
import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from pubs import accounts
from pubs.models import (
    Account,
    CommunityEvent,
    CommunityEventTeam,
    CommunityEventTeamMembership,
    ContentReport,
    FeedbackReport,
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


@pytest.mark.django_db(transaction=True)
def test_hard_delete_deidentifies_feedback_and_deletes_attachment(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    account = Account.objects.create(device_id="purge-feedback")
    feedback = FeedbackReport.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        category=FeedbackReport.Category.OTHER,
        message="Support audit may remain",
        contact_type=FeedbackReport.ContactType.EMAIL,
        contact="delete-me@example.com",
        attachment=SimpleUploadedFile("support.webp", b"private-feedback"),
        attachment_url="https://api.example/media/feedback/private.webp",
    )
    pk = feedback.pk
    attachment_path = Path(feedback.attachment.path)
    assert attachment_path.exists()

    accounts.hard_delete(account)

    feedback = FeedbackReport.objects.get(pk=pk)
    assert feedback.account_id is None
    assert feedback.message == "Support audit may remain"
    assert feedback.attachment.name == ""
    assert feedback.attachment_url == ""
    assert feedback.contact == ""
    assert feedback.contact_type == ""
    assert not attachment_path.exists()


@pytest.mark.django_db
def test_hard_delete_removes_hosted_events_and_scrubs_moderation_identity():
    deleted = Account.objects.create(
        device_id="purge-moderation-target",
        nickname="deleted-handle",
        display_name="Deleted Person",
        avatar="avatars/deleted.webp",
    )
    other = Account.objects.create(device_id="purge-moderation-other")
    deleted_public_id = str(deleted.public_id)
    deleted_avatar = deleted.avatar.name
    target_snapshot = {
        "account_id": deleted_public_id,
        "nickname": deleted.nickname,
        "display_name": deleted.display_name,
        "avatar_url": f"https://api.example/media/{deleted_avatar}",
        "marker": "deleted-target",
    }
    target_report = ContentReport.objects.create(
        reporter=other,
        target_account=deleted,
        reason=ContentReport.Reason.INAPPROPRIATE_NICKNAME,
        target_snapshot=target_snapshot,
    )
    other_snapshot = {
        "account_id": str(other.public_id),
        "nickname": "other-owner",
        "marker": "keep-other-target",
    }
    reporter_report = ContentReport.objects.create(
        reporter=deleted,
        target_account=other,
        reason=ContentReport.Reason.SPAM,
        target_snapshot=other_snapshot,
    )
    now = timezone.now()
    event = CommunityEvent.objects.create(
        host=deleted,
        client_id=uuid.uuid4(),
        title="Private hosted event",
        city="Praha",
        exact_address="Soukroma 12, zvonek Deleted",
        lat=50.0755,
        lng=14.4378,
        starts_at=now + timedelta(days=1),
        ends_at=now + timedelta(days=2),
        capacity=4,
    )

    accounts.hard_delete(deleted)

    target_report.refresh_from_db()
    reporter_report.refresh_from_db()
    assert target_report.target_account_id is None
    assert target_report.target_snapshot == {}
    assert reporter_report.reporter_id is None
    assert reporter_report.target_account_id == other.pk
    assert reporter_report.target_snapshot == other_snapshot
    assert not CommunityEvent.objects.filter(pk=event.pk).exists()

    surviving = json.dumps(
        [
            {
                "reporter_id": target_report.reporter_id,
                "target_account_id": target_report.target_account_id,
                "target_snapshot": target_report.target_snapshot,
            },
            {
                "reporter_id": reporter_report.reporter_id,
                "target_account_id": reporter_report.target_account_id,
                "target_snapshot": reporter_report.target_snapshot,
            },
        ],
        sort_keys=True,
    )
    for deleted_value in (
        deleted_public_id,
        "deleted-handle",
        "Deleted Person",
        deleted_avatar,
        f"https://api.example/media/{deleted_avatar}",
        "Soukroma 12, zvonek Deleted",
    ):
        assert deleted_value not in surviving


@pytest.mark.django_db
def test_hard_delete_preserves_foreign_event_team_but_scrubs_deleted_creator_identity():
    deleted = Account.objects.create(
        device_id="purge-team-creator",
        nickname="deleted-team-handle",
        display_name="Deleted Team Person",
        avatar="avatars/deleted-team.webp",
    )
    survivor = Account.objects.create(device_id="purge-team-survivor")
    now = timezone.now()
    event = CommunityEvent.objects.create(
        host=survivor,
        client_id=uuid.uuid4(),
        title="Foreign event",
        city="Brno",
        exact_address="Foreign event stays 77",
        lat=49.1951,
        lng=16.6068,
        starts_at=now + timedelta(days=1),
        ends_at=now + timedelta(days=2),
        capacity=10,
    )
    team = CommunityEventTeam.objects.create(
        event=event,
        created_by=deleted,
        client_id=uuid.uuid4(),
        name="Deleted Person Crew",
    )
    membership = CommunityEventTeamMembership.objects.create(
        event=event,
        team=team,
        account=survivor,
        slot=1,
    )

    accounts.hard_delete(deleted)

    assert not Account.objects.filter(pk=deleted.pk).exists()
    assert Account.objects.filter(pk=survivor.pk).exists()

    event.refresh_from_db()
    assert event.host_id == survivor.pk
    assert event.exact_address == "Foreign event stays 77"

    team.refresh_from_db()
    membership.refresh_from_db()
    assert CommunityEventTeam.objects.filter(pk=team.pk).exists()
    assert CommunityEventTeamMembership.objects.filter(pk=membership.pk).exists()
    assert team.created_by_id is None
    assert team.name == "Parta"

    surviving_identity = json.dumps(
        [
            {
                "event_host": str(event.host.public_id),
                "event_exact_address": event.exact_address,
                "event_title": event.title,
            },
            {
                "team_created_by": team.created_by_id,
                "team_client_id": str(team.client_id),
                "team_name": team.name,
            },
            {
                "membership_account": str(membership.account.public_id),
                "membership_slot": membership.slot,
            },
        ],
        sort_keys=True,
    )
    for deleted_value in (
        str(deleted.public_id),
        "deleted-team-handle",
        "Deleted Team Person",
        "avatars/deleted-team.webp",
        "Deleted Person Crew",
    ):
        assert deleted_value not in surviving_identity
