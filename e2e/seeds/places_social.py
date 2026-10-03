"""Synthetic places/social fixtures and a read-only, non-sensitive DB oracle."""

import io
import os
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.files.base import ContentFile
from django.utils import timezone
from PIL import Image
from pubs.community_events import CommunityEvent, CommunityEventMembership
from pubs.enrichment import geohash8
from pubs.models import (
    Account,
    AccountUsageStats,
    BeerPhoto,
    DrinkLog,
    EmailCredential,
    FeedbackReport,
    FriendBlock,
    FriendInviteCode,
    FriendPubActivity,
    Friendship,
    PhotoContestEntry,
    PhotoContestVote,
    PubCommunityData,
    PubCommunityXpLedger,
    PubContributionLog,
    PubFavorite,
    PubRating,
    PubReport,
    PubVisit,
    UserAddedPub,
)
from pubs.photo_contest import current_photo_contest
from pubs.pub_events import PubEvent

from e2e.seeds import base


def seed():
    base.seed()
    now = timezone.now()
    primary = Account.objects.get(nickname="E2EPivar")
    primary.is_public = True
    primary.ugc_terms_version = settings.UGC_POLICY_VERSION
    primary.ugc_terms_accepted_at = now
    primary.quorum_trusted_at = now - timedelta(days=3)
    primary.save()
    accounts = [primary]
    for role, nickname, public in (
        ("second", "E2EKamos", True),
        ("outsider", "E2ECizi", False),
    ):
        account = Account.objects.create(
            device_id=f"e2e-{role}",
            nickname=nickname,
            display_name=nickname,
            is_public=public,
            ugc_terms_version=settings.UGC_POLICY_VERSION,
            ugc_terms_accepted_at=now,
            quorum_trusted_at=now - timedelta(days=3),
        )
        EmailCredential.objects.create(
            account=account,
            email=f"{role}-{os.environ['NA_PIVO_E2E_EMAIL']}",
            password=make_password(os.environ["NA_PIVO_E2E_PASSWORD"]),
            email_verified=True,
        )
        accounts.append(account)
    primary, second, outsider = accounts
    Friendship.objects.create(
        requester=second,
        recipient=primary,
        status="accepted",
        responded_at=now,
    )
    FriendInviteCode.objects.create(
        account=outsider,
        code="E2EInviteCizi",
        expires_at=now + timedelta(days=7),
    )
    lat, lng = base.LOCATION
    key = geohash8(lat, lng)
    FriendPubActivity.objects.create(
        account=primary,
        client_id=uuid.uuid4(),
        cache_key=key,
        name="E2E U Testera",
        lat=lat,
        lng=lng,
        city="Praha",
        started_at=now - timedelta(minutes=5),
        expires_at=now + timedelta(hours=4),
    )
    # Automatic presence and an explicit cink coexist, so privacy tests can
    # enforce their separate documented contracts instead of conflating them.
    PubVisit.objects.create(
        account=primary,
        client_id=uuid.uuid4(),
        cache_key=key,
        name="E2E U Testera",
        lat=lat,
        lng=lng,
        city="Praha",
        started_at=now - timedelta(minutes=5),
        client_updated_at=now,
    )
    for account, count in ((primary, 1), (second, 2), (outsider, 3)):
        AccountUsageStats.objects.create(account=account, mapper_xp=count * 10)
        for _ in range(count):
            DrinkLog.objects.create(
                account=account,
                client_id=uuid.uuid4(),
                cache_key=key,
                name="E2E U Testera",
                lat=lat,
                lng=lng,
                city="Praha",
                beer_name="E2E Ležák",
                price_czk=41,
                volume_ml=500,
                drank_at=now,
            )
    event = CommunityEvent.objects.create(
        host=primary,
        client_id=uuid.uuid4(),
        title="E2E Večer u hosta",
        city="Praha",
        area_label="Testovací čtvrť",
        exact_address="E2E Adresa 12",
        lat=lat,
        lng=lng,
        starts_at=now + timedelta(hours=1),
        ends_at=now + timedelta(hours=5),
        capacity=3,
    )
    CommunityEventMembership.objects.create(
        event=event,
        account=second,
        message="E2E Prosím o místo",
        status="pending",
    )
    for title, status, start, end in (
        ("E2E Ověřený kvíz", "verified", now, now + timedelta(hours=3)),
        (
            "E2E Skončený kvíz",
            "verified",
            now - timedelta(days=2),
            now - timedelta(days=1),
        ),
    ):
        PubEvent.objects.create(
            account=primary,
            client_id=uuid.uuid4(),
            cache_key=key,
            name="E2E U Testera",
            lat=lat,
            lng=lng,
            title=title,
            status=status,
            verified_at=now,
            starts_at=start,
            ends_at=end,
        )
    contest = current_photo_contest(now)
    for account, color in (
        (primary, "#ba7722"),
        (second, "#384d37"),
        (outsider, "#403449"),
    ):
        data = io.BytesIO()
        Image.new("RGB", (600, 600), color).save(data, format="JPEG")
        photo = BeerPhoto.objects.create(
            account=account,
            client_id=uuid.uuid4(),
            caption=f"E2E Fotka {account.nickname}",
            visibility="private",
            image=ContentFile(data.getvalue(), name="fixture.jpg"),
        )
        if account != primary:
            PhotoContestEntry.objects.create(
                contest=contest, account=account, photo=photo
            )


def observe():
    """No credentials, coordinates, contact details, or private addresses."""

    def rows(model, fields):
        return list(model.objects.order_by("pk").values(*fields))

    return {
        "pubKeys": dict(PubCommunityData.objects.values_list("name", "cache_key")),
        "fixtureAccounts": dict(
            Account.objects.filter(nickname__startswith="E2E").values_list(
                "nickname", "public_id"
            )
        ),
        "eventId": CommunityEvent.objects.values_list("id", flat=True).first(),
        "events": rows(CommunityEvent, ["title", "status"]),
        "requestId": CommunityEventMembership.objects.values_list(
            "id", flat=True
        ).first(),
        "inviteCode": "E2EInviteCizi",
        "addedPubs": rows(
            UserAddedPub,
            ["account__nickname", "client_id", "name", "location_source", "active"],
        ),
        "presenceVisits": rows(PubVisit, ["account__nickname", "client_id", "name"]),
        "manualActivities": rows(FriendPubActivity, ["account__nickname", "active"]),
        "favorites": rows(PubFavorite, ["account__nickname", "cache_key"]),
        "ratings": rows(PubRating, ["account__nickname", "cache_key", "verdict"]),
        "reports": rows(PubReport, ["account__nickname", "cache_key", "reason"]),
        "community": rows(
            PubCommunityData, ["name", "hours_json", "beers", "beer_menu_rotates"]
        ),
        "contributions": rows(
            PubContributionLog, ["account__nickname", "client_id", "kind"]
        ),
        "communityXp": rows(PubCommunityXpLedger, ["account__nickname", "kind"]),
        "feedback": [
            {
                "message": row.message,
                "category": row.category,
                "clientId": str(row.client_id),
                "attachmentPresent": bool(row.attachment),
                "fileExists": bool(row.attachment)
                and row.attachment.storage.exists(row.attachment.name),
            }
            for row in FeedbackReport.objects.all()
        ],
        "pubEvents": rows(
            PubEvent, ["account__nickname", "client_id", "title", "status"]
        ),
        "memberships": rows(CommunityEventMembership, ["account__nickname", "status"]),
        "friendships": rows(
            Friendship, ["requester__nickname", "recipient__nickname", "status"]
        ),
        "blocks": rows(FriendBlock, ["blocker__nickname", "blocked__nickname"]),
        "photos": rows(BeerPhoto, ["account__nickname", "public_id", "visibility"]),
        "entries": rows(
            PhotoContestEntry, ["account__nickname", "public_id", "photo__public_id"]
        ),
        "votes": rows(
            PhotoContestVote, ["voter__nickname", "entry__account__nickname"]
        ),
    }
