from __future__ import annotations

import base64
import json
import uuid

import pytest
from django.core.cache import cache
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs import emailer
from pubs.models import (
    Account,
    AccountMappedPub,
    AccountPubCompletion,
    AccountUsageStats,
    AmenityXpLedger,
    AuthIdentity,
    BeerBrand,
    BeerCheckIn,
    BeerPhoto,
    BeerProduct,
    CommunityEvent,
    CommunityEventMembership,
    CommunityEventTeam,
    CommunityEventTeamMembership,
    ContentReport,
    DrinkLog,
    EmailCredential,
    FeedbackReport,
    Follow,
    Friendship,
    PartyEvening,
    PartyEveningDrink,
    PartyEveningMember,
    PartyGame,
    PartyGameEvent,
    PhotoContest,
    PhotoContestEntry,
    PhotoContestVote,
    PubAmenityVoteTombstone,
    PubBeerBrand,
    PubBeerProduct,
    PubCommunityData,
    PubCommunityXpLedger,
    PubContributionLog,
    PubEvent,
    PublishedNight,
    PublishedNightComment,
    PubNameCorrection,
    PubReport,
    PushDevice,
    UserAddedPub,
)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache(settings):
    settings.ACCOUNT_EXPORT_ASYNC = False
    cache.clear()
    yield
    cache.clear()


def _bootstrap(client) -> tuple[str, str]:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()
    return body["token"], body["id"]


def _auth(token: str) -> dict:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def test_account_export_email_uses_json_attachment(monkeypatch):
    captured: dict = {}

    def fake_send_email(to, subject, html, *, text=None, attachments=None):
        captured["to"] = to
        captured["subject"] = subject
        captured["html"] = html
        captured["text"] = text
        captured["attachments"] = attachments
        return True

    monkeypatch.setattr(emailer, "send_email", fake_send_email)

    result = emailer.send_account_export_email(
        "export@example.com",
        filename="na-pivo-export.json",
        json_bytes=b'{"ok": true}',
    )

    assert result is True
    assert captured["to"] == "export@example.com"
    attachment = captured["attachments"][0]
    assert attachment["filename"] == "na-pivo-export.json"
    assert attachment["content_type"] == "application/json"
    assert base64.b64decode(attachment["content"]) == b'{"ok": true}'


def test_send_email_logs_no_recipient_or_message_pii(settings, caplog):
    settings.EMAIL_ENABLED = False
    settings.RESEND_API_KEY = ""

    with caplog.at_level("INFO", logger="pubs.emailer"):
        sent = emailer.send_email(
            "person@example.com",
            "Private subject",
            "<p>Private body</p>",
            text="Private text",
        )

    assert sent is True
    assert "person@example.com" not in caplog.text
    assert "Private subject" not in caplog.text
    assert "Private body" not in caplog.text
    assert "Private text" not in caplog.text


def test_verification_email_renders_app_link(monkeypatch):
    captured: dict[str, str | None] = {}

    def fake_send_email(to, subject, html, *, text=None, attachments=None):
        captured["to"] = to
        captured["subject"] = subject
        captured["html"] = html
        captured["text"] = text
        return True

    monkeypatch.setattr(emailer, "send_email", fake_send_email)

    sent = emailer.send_verification_email(
        "person@example.com",
        link="https://api.na-pivo.cz/v1/auth/verify-email?token=verify-token",
        code="verify-token",
    )

    assert sent is True
    assert captured["to"] == "person@example.com"
    assert captured["subject"] == "Ověř si e-mail – Na Pivo"
    assert (
        'href="https://api.na-pivo.cz/v1/auth/verify-email?token=verify-token"' in captured["html"]
    )
    assert "Ověřit e-mail" in captured["html"]
    assert "Kód pro ruční zadání" not in captured["html"]
    assert "https://api.na-pivo.cz/v1/auth/verify-email?token=verify-token" in (
        captured["text"] or ""
    )


def test_password_reset_email_renders_app_link_and_manual_code(monkeypatch):
    captured: dict[str, str | None] = {}

    def fake_send_email(to, subject, html, *, text=None, attachments=None):
        captured["to"] = to
        captured["subject"] = subject
        captured["html"] = html
        captured["text"] = text
        return True

    monkeypatch.setattr(emailer, "send_email", fake_send_email)

    sent = emailer.send_password_reset_email(
        "person@example.com",
        link="napivo://auth/reset?token=reset-token",
        code="reset-token",
    )

    assert sent is True
    assert captured["to"] == "person@example.com"
    assert captured["subject"] == "Nové heslo – Na Pivo"
    assert 'href="napivo://auth/reset?token=reset-token"' in captured["html"]
    assert "Nastavit nové heslo" in captured["html"]
    assert "reset-token" in captured["html"]
    assert "napivo://auth/reset?token=reset-token" in (captured["text"] or "")
    assert "reset-token" in (captured["text"] or "")


@pytest.mark.django_db
def test_marketing_email_preference_is_returned_and_patchable(client):
    token, _ = _bootstrap(client)

    initial = client.get("/v1/account/me", **_auth(token))
    assert initial.status_code == status.HTTP_200_OK, initial.content
    assert initial.json()["settings"]["marketing_emails_enabled"] is False

    updated = client.patch(
        "/v1/account/me",
        data={"marketing_emails_enabled": True},
        format="json",
        **_auth(token),
    )

    assert updated.status_code == status.HTTP_200_OK, updated.content
    assert updated.json()["settings"]["marketing_emails_enabled"] is True
    assert Account.objects.get(public_id=updated.json()["id"]).marketing_emails_enabled is True


@pytest.mark.django_db
def test_restore_purchases_stores_pending_subscription_identifiers(client):
    token, account_id = _bootstrap(client)
    expires_at = timezone.now() + timezone.timedelta(days=30)

    resp = client.post(
        "/v1/account/me/purchases/restore",
        data={
            "platform": "apple",
            "product_id": "na_pivo_plus_monthly",
            "original_transaction_id": "1000000123456789",
            "expires_at": expires_at.isoformat(),
        },
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_202_ACCEPTED, resp.content
    body = resp.json()["subscription"]
    assert body["tier"] == Account.SubscriptionTier.FREE
    assert body["status"] == Account.SubscriptionStatus.PENDING_VERIFICATION
    assert body["platform"] == "apple"
    assert body["product_id"] == "na_pivo_plus_monthly"
    assert body["original_transaction_id"] == "1000000123456789"

    account = Account.objects.get(public_id=account_id)
    assert account.subscription_status == Account.SubscriptionStatus.PENDING_VERIFICATION
    assert account.subscription_original_transaction_id == "1000000123456789"


@pytest.mark.django_db
@override_settings(PUBLIC_API_ORIGIN="https://api.example.test")
def test_account_export_includes_diary_data_and_excludes_secrets(client):
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn12",
        name="U Exportu",
        lat=50.08,
        lng=14.45,
        beer_name="Ležák",
        price_czk=59,
        volume_ml=500,
        drank_at=timezone.now(),
    )
    checked_in_at = timezone.now().replace(microsecond=0)
    ended_at = checked_in_at + timezone.timedelta(hours=2)
    BeerCheckIn.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        beer_name="Exportní pivo",
        beer_key="exportni-pivo",
        quantity=3,
        price_czk=62,
        pub_name="U Exportu",
        visibility=BeerCheckIn.Visibility.FRIENDS,
        checked_in_at=checked_in_at,
        ended_at=ended_at,
    )
    PushDevice.objects.create(
        account=account,
        push_token="ExponentPushToken[exportDevice]",
        platform=PushDevice.Platform.IOS,
        permission_status=PushDevice.PermissionStatus.GRANTED,
        enabled=True,
        app_version="1.2.0",
    )
    account.avatar = "avatars/export.webp"
    account.ghost_mode = True
    account.share_drinks_with_parta = False
    account.quiet_hours_enabled = False
    account.quiet_hours_start = 22
    account.quiet_hours_end = 7
    account.excluded_from_leaderboards = True
    account.save()

    resp = client.get("/v1/account/export", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp["Content-Disposition"] == 'attachment; filename="na-pivo-export.json"'
    assert resp["Cache-Control"] == "no-store"
    assert resp["Pragma"] == "no-cache"
    body = resp.json()
    assert body["account"]["id"] == account_id
    assert body["account"]["avatar_url"] == "https://api.example.test/media/avatars/export.webp"
    assert body["settings"]["ghost_mode"] is True
    assert body["settings"]["share_drinks_with_parta"] is False
    assert body["settings"]["quiet_hours_enabled"] is False
    assert body["settings"]["quiet_hours_start"] == 22
    assert body["settings"]["quiet_hours_end"] == 7
    assert body["settings"]["excluded_from_leaderboards"] is True
    assert body["drinks"][0]["beer_name"] == "Ležák"
    assert body["drinks"][0]["drink_type"] == "beer"
    assert body["drinks"][0]["place_context"] == "pub"
    assert body["drinks"][0]["serving_type"] == "unknown"
    assert body["beer_checkins"][0]["beer_name"] == "Exportní pivo"
    assert body["beer_checkins"][0]["quantity"] == 3
    assert body["beer_checkins"][0]["price_czk"] == 62
    assert body["beer_checkins"][0]["ended_at"] == ended_at.isoformat()
    assert body["push_devices"] == [
        {
            "platform": "ios",
            "permission_status": "granted",
            "enabled": True,
            "app_version": "1.2.0",
            "created_at": body["push_devices"][0]["created_at"],
            "updated_at": body["push_devices"][0]["updated_at"],
            "last_registered_at": body["push_devices"][0]["last_registered_at"],
        }
    ]
    assert body["settings"]["marketing_emails_enabled"] is False
    serialized = str(body)
    assert "token_hash" not in serialized
    assert "password" not in serialized
    assert token not in serialized
    assert "ExponentPushToken[exportDevice]" not in serialized


@pytest.mark.django_db
def test_account_export_includes_all_account_owned_history_without_auth_secrets(client):
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    other = Account.objects.create(device_id=str(uuid.uuid4()), nickname="other-export")
    now = timezone.now().replace(microsecond=0)

    AccountUsageStats.objects.create(
        account=account,
        mapper_xp=135,
        pivar_xp=72,
        mapped_pubs_count=3,
        first_mapper_count=2,
        amenity_votes_count=5,
        completed_pubs_count=1,
        photo_contest_wins_count=1,
    )
    Follow.objects.create(follower=account, target=other)
    Follow.objects.create(follower=other, target=account)
    added_pub = UserAddedPub.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn12",
        name="U Přidaného exportu",
        lat=50.08,
        lng=14.45,
        city="Praha",
        address="Exportní 1",
    )
    correction = PubNameCorrection.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn12",
        original_name="U Starého",
        suggested_name="U Správného",
        lat=50.08,
        lng=14.45,
        city="Praha",
        address="Exportní 1",
    )
    tombstone = PubAmenityVoteTombstone.objects.create(
        account=account,
        cache_key="u2fkbn12",
        pub_identity_key="u2fkbn12:u-pridaneho-exportu",
        amenity_key="wifi",
        name="U Přidaného exportu",
        client_updated_at=now,
    )
    AmenityXpLedger.objects.create(
        account=account,
        cache_key="u2fkbn12",
        pub_identity_key="u2fkbn12:u-pridaneho-exportu",
        amenity_key="wifi",
    )
    AccountMappedPub.objects.create(
        account=account,
        cache_key="u2fkbn12",
        pub_identity_key="u2fkbn12:u-pridaneho-exportu",
    )
    AccountPubCompletion.objects.create(
        account=account,
        cache_key="u2fkbn12",
        pub_identity_key="u2fkbn12:u-pridaneho-exportu",
    )
    PubCommunityXpLedger.objects.create(
        account=account,
        cache_key="u2fkbn12",
        kind=PubCommunityXpLedger.Kind.HOURS,
    )
    photo = BeerPhoto.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        image=f"beer-photos/{account.public_id}/contest.webp",
        taken_at=now,
    )
    contest = PhotoContest.objects.create(
        period_start=now,
        period_end=now + timezone.timedelta(days=14),
        status=PhotoContest.Status.CLOSED,
        closed_at=now + timezone.timedelta(days=14),
    )
    entry = PhotoContestEntry.objects.create(
        contest=contest,
        photo=photo,
        account=account,
        final_rank=1,
        final_votes=7,
    )
    other_photo = BeerPhoto.objects.create(
        account=other,
        client_id=uuid.uuid4(),
        image=f"beer-photos/{other.public_id}/contest.webp",
        taken_at=now,
    )
    other_entry = PhotoContestEntry.objects.create(
        contest=contest,
        photo=other_photo,
        account=other,
        final_rank=2,
        final_votes=4,
    )
    PhotoContestVote.objects.create(contest=contest, entry=other_entry, voter=account)

    response = client.get("/v1/account/export", **_auth(token))

    assert response.status_code == status.HTTP_200_OK, response.content
    body = response.json()
    assert body["usage"]["mapper_xp"] == 135
    assert body["usage"]["pivar_xp"] == 72
    assert body["social"]["following"] == [str(other.public_id)]
    assert body["social"]["followers"] == [str(other.public_id)]
    assert body["mapping_history"]["added_pubs"][0]["client_id"] == str(
        added_pub.client_id
    )
    assert body["mapping_history"]["name_corrections"][0]["client_id"] == str(
        correction.client_id
    )
    assert body["mapping_history"]["amenity_vote_tombstones"][0]["amenity_key"] == (
        tombstone.amenity_key
    )
    assert body["mapping_history"]["mapped_pubs"][0]["cache_key"] == "u2fkbn12"
    assert body["mapping_history"]["completed_pubs"][0]["cache_key"] == "u2fkbn12"
    assert body["mapping_history"]["community_xp_ledger"][0]["kind"] == "hours"
    assert body["photo_contests"]["entries"][0]["entry_id"] == str(entry.public_id)
    assert body["photo_contests"]["votes"][0]["entry_id"] == str(other_entry.public_id)
    serialized = str(body)
    assert token not in serialized
    assert "token_hash" not in serialized
    assert "password" not in serialized


@pytest.mark.django_db
def test_account_export_includes_only_owned_current_pub_catalog_contributions(client):
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    other = Account.objects.create(device_id=str(uuid.uuid4()), nickname="other-catalog")
    now = timezone.now().replace(microsecond=0)

    brand = BeerBrand.objects.create(
        key="export-brand",
        name="Exportní značka",
        aliases=["export"],
        rank=10,
    )
    product = BeerProduct.objects.create(
        key="export-brand-lezak",
        brand=brand,
        brand_key="export-brand",
        brand_name="Exportní značka",
        name="Exportní ležák 10°",
        rank=11,
    )

    own_community = PubCommunityData.objects.create(
        cache_key="ownck001",
        name="OWNER-COMMUNITY-PUB",
        lat=50.08,
        lng=14.45,
        city="Praha",
        external_id="owner-external-1",
        hours_json={
            "mo": [["11:00", "23:00"]],
            "tu": [],
            "we": [["11:00", "23:00"]],
            "th": [],
            "fr": [["11:00", "01:00"]],
            "sa": [["12:00", "01:00"]],
            "su": [],
        },
        opening_hours_raw="Mo,We 11:00-23:00; Fr 11:00-01:00; Sa 12:00-01:00",
        beers=[
            {"name": "OWNER-TAP-BEER", "price_czk": 65, "volume_ml": 500},
        ],
        historical_beers=[
            {"name": "OWNER-RETIRED-BEER", "price_czk": 55, "volume_ml": 500},
        ],
        beer_menu_rotates=True,
        account=account,
        hours_updated_at=now - timezone.timedelta(hours=2),
        beers_updated_at=now - timezone.timedelta(hours=1),
        created_at=now - timezone.timedelta(days=1),
        updated_at=now - timezone.timedelta(hours=1),
    )
    PubCommunityData.objects.create(
        cache_key="othck001",
        name="OTHER-COMMUNITY-PUB",
        lat=49.20,
        lng=16.60,
        city="Brno",
        external_id="other-external-1",
        account=other,
    )

    own_brand_row = PubBeerBrand.objects.create(
        cache_key="ownck002",
        name="OWNER-BRAND-PUB",
        lat=50.09,
        lng=14.42,
        city="Praha",
        external_id="owner-external-2",
        brand=brand,
        brand_key="export-brand",
        brand_name="Exportní značka",
        last_price_czk=62,
        last_volume_ml=500,
        source=PubBeerBrand.Source.COMMUNITY,
        active=True,
        account=account,
        last_seen_at=now - timezone.timedelta(hours=3),
        created_at=now - timezone.timedelta(days=2),
        updated_at=now - timezone.timedelta(hours=3),
    )
    PubBeerBrand.objects.create(
        cache_key="othck002",
        name="OTHER-BRAND-PUB",
        lat=49.21,
        lng=16.61,
        city="Brno",
        external_id="other-external-2",
        brand=brand,
        brand_key="export-brand",
        brand_name="Exportní značka",
        source=PubBeerBrand.Source.DRINK,
        account=other,
    )

    own_product_row = PubBeerProduct.objects.create(
        cache_key="ownck003",
        name="OWNER-PRODUCT-PUB",
        lat=50.10,
        lng=14.40,
        city="Praha",
        external_id="owner-external-3",
        brand=brand,
        product=product,
        brand_key="export-brand",
        brand_name="Exportní značka",
        product_key="export-brand-lezak",
        product_name="Exportní ležák 10°",
        last_price_czk=68,
        last_volume_ml=500,
        source=PubBeerProduct.Source.COMMUNITY,
        active=True,
        account=account,
        last_seen_at=now - timezone.timedelta(hours=4),
        created_at=now - timezone.timedelta(days=3),
        updated_at=now - timezone.timedelta(hours=4),
    )
    PubBeerProduct.objects.create(
        cache_key="othck003",
        name="OTHER-PRODUCT-PUB",
        lat=49.22,
        lng=16.62,
        city="Brno",
        external_id="other-external-3",
        brand=brand,
        product=product,
        brand_key="export-brand",
        brand_name="Exportní značka",
        product_key="export-brand-lezak",
        product_name="Exportní ležák 10°",
        source=PubBeerProduct.Source.DRINK,
        account=other,
    )

    response = client.get("/v1/account/export", **_auth(token))

    assert response.status_code == status.HTTP_200_OK, response.content
    body = response.json()

    community_rows = body["mapping_history"]["community_data"]
    assert len(community_rows) == 1
    exported_community = community_rows[0]
    assert set(exported_community.keys()) == {
        "cache_key",
        "name",
        "lat",
        "lng",
        "city",
        "external_id",
        "hours_json",
        "opening_hours_raw",
        "beers",
        "historical_beers",
        "beer_menu_rotates",
        "hours_updated_at",
        "beers_updated_at",
        "created_at",
        "updated_at",
    }
    assert exported_community["cache_key"] == "ownck001"
    assert exported_community["name"] == "OWNER-COMMUNITY-PUB"
    assert exported_community["lat"] == 50.08
    assert exported_community["lng"] == 14.45
    assert exported_community["city"] == "Praha"
    assert exported_community["external_id"] == "owner-external-1"
    assert exported_community["hours_json"] == own_community.hours_json
    assert (
        exported_community["opening_hours_raw"]
        == "Mo,We 11:00-23:00; Fr 11:00-01:00; Sa 12:00-01:00"
    )
    assert exported_community["beers"] == [
        {"name": "OWNER-TAP-BEER", "price_czk": 65, "volume_ml": 500},
    ]
    assert exported_community["historical_beers"] == [
        {"name": "OWNER-RETIRED-BEER", "price_czk": 55, "volume_ml": 500},
    ]
    assert exported_community["beer_menu_rotates"] is True
    assert exported_community["hours_updated_at"] == (
        now - timezone.timedelta(hours=2)
    ).isoformat()
    assert exported_community["beers_updated_at"] == (
        now - timezone.timedelta(hours=1)
    ).isoformat()
    assert exported_community["created_at"] == own_community.created_at.isoformat()
    assert exported_community["updated_at"] == own_community.updated_at.isoformat()

    brand_rows = body["mapping_history"]["pub_beer_brands"]
    assert len(brand_rows) == 1
    exported_brand = brand_rows[0]
    assert set(exported_brand.keys()) == {
        "cache_key",
        "name",
        "lat",
        "lng",
        "city",
        "external_id",
        "brand_key",
        "brand_name",
        "last_price_czk",
        "last_volume_ml",
        "source",
        "active",
        "last_seen_at",
        "created_at",
        "updated_at",
    }
    assert exported_brand["cache_key"] == "ownck002"
    assert exported_brand["name"] == "OWNER-BRAND-PUB"
    assert exported_brand["lat"] == 50.09
    assert exported_brand["lng"] == 14.42
    assert exported_brand["city"] == "Praha"
    assert exported_brand["external_id"] == "owner-external-2"
    assert exported_brand["brand_key"] == "export-brand"
    assert exported_brand["brand_name"] == "Exportní značka"
    assert exported_brand["last_price_czk"] == 62
    assert exported_brand["last_volume_ml"] == 500
    assert exported_brand["source"] == "community"
    assert exported_brand["active"] is True
    assert exported_brand["last_seen_at"] == (
        now - timezone.timedelta(hours=3)
    ).isoformat()
    assert exported_brand["created_at"] == own_brand_row.created_at.isoformat()
    assert exported_brand["updated_at"] == own_brand_row.updated_at.isoformat()

    product_rows = body["mapping_history"]["pub_beer_products"]
    assert len(product_rows) == 1
    exported_product = product_rows[0]
    assert set(exported_product.keys()) == {
        "cache_key",
        "name",
        "lat",
        "lng",
        "city",
        "external_id",
        "brand_key",
        "brand_name",
        "product_key",
        "product_name",
        "last_price_czk",
        "last_volume_ml",
        "source",
        "active",
        "last_seen_at",
        "created_at",
        "updated_at",
    }
    assert exported_product["cache_key"] == "ownck003"
    assert exported_product["name"] == "OWNER-PRODUCT-PUB"
    assert exported_product["lat"] == 50.10
    assert exported_product["lng"] == 14.40
    assert exported_product["city"] == "Praha"
    assert exported_product["external_id"] == "owner-external-3"
    assert exported_product["brand_key"] == "export-brand"
    assert exported_product["brand_name"] == "Exportní značka"
    assert exported_product["product_key"] == "export-brand-lezak"
    assert exported_product["product_name"] == "Exportní ležák 10°"
    assert exported_product["last_price_czk"] == 68
    assert exported_product["last_volume_ml"] == 500
    assert exported_product["source"] == "community"
    assert exported_product["active"] is True
    assert exported_product["last_seen_at"] == (
        now - timezone.timedelta(hours=4)
    ).isoformat()
    assert exported_product["created_at"] == own_product_row.created_at.isoformat()
    assert exported_product["updated_at"] == own_product_row.updated_at.isoformat()

    for section in (community_rows, brand_rows, product_rows):
        for row in section:
            row_keys = set(row.keys())
            assert not row_keys & {"account_id", "account", "id", "pk"}
            if row is exported_community:
                continue
            assert not row_keys & {"brand_id", "product_id"}

    assert "OTHER-COMMUNITY-PUB" not in str(body)
    assert "OTHER-BRAND-PUB" not in str(body)
    assert "OTHER-PRODUCT-PUB" not in str(body)
    assert "othck001" not in str(body)
    assert "othck002" not in str(body)
    assert "othck003" not in str(body)


@pytest.mark.django_db
def test_account_export_includes_owned_reports_and_contributions(client):
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    other = Account.objects.create(device_id=str(uuid.uuid4()), nickname="other-reports")

    pub_report = PubReport.objects.create(
        account=account,
        cache_key="u2fkbn12",
        external_id="mapy-export-1",
        name="U Nahlášeného exportu",
        lat=50.08,
        lng=14.45,
        city="Praha",
        address="Exportní 5",
        reason=PubReport.Reason.CLOSED,
    )
    FeedbackReport.objects.create(
        account=other,
        client_id=uuid.uuid4(),
        category=FeedbackReport.Category.IDEA,
        message="CIZÍ soukromá zpětná vazba",
    )
    feedback = FeedbackReport.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        category=FeedbackReport.Category.BUG,
        message="Exportní zpětná vazba",
        contact_type=FeedbackReport.ContactType.EMAIL,
        contact="export@example.com",
        app_version="3.0.0",
        platform="ios",
        os_version="18.0",
    )
    PubContributionLog.objects.create(
        account=other,
        cache_key="othck004",
        name="CIZÍ příspěvek",
        lat=49.20,
        lng=16.60,
        kind=PubContributionLog.Kind.BEERS,
        payload=[{"name": "CIZÍ pivo"}],
        client_id=uuid.uuid4(),
    )
    contribution = PubContributionLog.objects.create(
        account=account,
        cache_key="u2fkbn12",
        name="U Exportu",
        lat=50.08,
        lng=14.45,
        kind=PubContributionLog.Kind.HOURS,
        payload={"mo": [["11:00", "23:00"]]},
        client_id=uuid.uuid4(),
    )
    ContentReport.objects.create(
        reporter=other,
        target_account=account,
        reason=ContentReport.Reason.SPAM,
        comment="CIZÍ report komentář",
    )
    content_report = ContentReport.objects.create(
        reporter=account,
        target_account=other,
        reason=ContentReport.Reason.INAPPROPRIATE_NICKNAME,
        comment="Sprostá přezdívka.",
    )
    PubReport.objects.create(
        account=other,
        cache_key="othck004",
        name="Cizí nahlášená hospoda",
        lat=49.20,
        lng=16.60,
        reason=PubReport.Reason.NOT_PUB,
    )

    response = client.get("/v1/account/export", **_auth(token))

    assert response.status_code == status.HTTP_200_OK, response.content
    body = response.json()

    assert body["pub_reports"] == [
        {
            "cache_key": pub_report.cache_key,
            "external_id": pub_report.external_id,
            "name": pub_report.name,
            "lat": pub_report.lat,
            "lng": pub_report.lng,
            "city": pub_report.city,
            "address": pub_report.address,
            "reason": PubReport.Reason.CLOSED,
            "active": True,
            "created_at": pub_report.created_at.isoformat(),
        }
    ]
    assert len(body["feedback_reports"]) == 1
    assert body["feedback_reports"][0] == {
        "client_id": str(feedback.client_id),
        "category": feedback.category,
        "message": feedback.message,
        "contact_type": feedback.contact_type,
        "contact": feedback.contact,
        "app_version": feedback.app_version,
        "platform": feedback.platform,
        "os_version": feedback.os_version,
        "attachment_url": "",
        "status": FeedbackReport.Status.NEW,
        "created_at": feedback.created_at.isoformat(),
    }
    assert len(body["community_contributions"]) == 1
    assert body["community_contributions"][0] == {
        "client_id": str(contribution.client_id),
        "kind": PubContributionLog.Kind.HOURS,
        "cache_key": contribution.cache_key,
        "name": contribution.name,
        "lat": contribution.lat,
        "lng": contribution.lng,
        "payload": {"mo": [["11:00", "23:00"]]},
        "created_at": contribution.created_at.isoformat(),
    }
    assert body["content_reports_made"] == [
        {
            "target_account_id": str(other.public_id),
            "reason": ContentReport.Reason.INAPPROPRIATE_NICKNAME,
            "comment": content_report.comment,
            "status": ContentReport.Status.NEW,
            "created_at": content_report.created_at.isoformat(),
        }
    ]

    serialized = str(body)
    assert "Cizí nahlášená hospoda" not in serialized
    assert "othck004" not in serialized
    assert "CIZÍ soukromá zpětná vazba" not in serialized
    assert "CIZÍ příspěvek" not in serialized
    assert "CIZÍ report komentář" not in serialized


@pytest.mark.django_db
def test_account_export_includes_owned_night_story_and_only_owned_comments(client):
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    other = Account.objects.create(device_id=str(uuid.uuid4()), nickname="other")
    now = timezone.now().replace(microsecond=0)
    participant_id = str(uuid.uuid4())
    photo_id = str(uuid.uuid4())
    game_id = str(uuid.uuid4())
    own_night = PublishedNight.objects.create(
        account=account,
        client_id="recap-client",
        client_aliases=["recap-client", "vycep-client"],
        drinking_day=now.date(),
        started_at=now - timezone.timedelta(hours=4),
        ended_at=now,
        beer_count=4,
        wine_count=0,
        soft_drink_count=1,
        shot_count=0,
        pub_names=["U Exportu"],
        city="Praha",
        duration_minutes=240,
        title="Můj exportní večer",
        roast_line="Výčep zavíral první",
        roast_basis="Čtyři piva a jedna limonáda",
        participant_ids=[participant_id],
        photo_ids=[photo_id],
        game_ids=[game_id],
        visibility=PublishedNight.Visibility.FRIENDS,
        updated_at=now,
    )
    other_night = PublishedNight.objects.create(
        account=other,
        client_id="other-night",
        drinking_day=now.date(),
        started_at=now - timezone.timedelta(hours=2),
        ended_at=now,
        beer_count=1,
        wine_count=0,
        soft_drink_count=0,
        shot_count=0,
        pub_names=[],
        city="",
        visibility=PublishedNight.Visibility.PUBLIC,
        updated_at=now,
    )
    own_comment = PublishedNightComment.objects.create(
        account=account,
        night=other_night,
        client_id=uuid.uuid4(),
        body="Můj komentář k cizímu večeru",
        is_removed=True,
    )
    PublishedNightComment.objects.create(
        account=other,
        night=own_night,
        client_id=uuid.uuid4(),
        body="Cizí komentář se nesmí exportovat",
    )

    response = client.get("/v1/account/export", **_auth(token))

    assert response.status_code == status.HTTP_200_OK, response.content
    body = response.json()
    exported_night = body["published_nights"][0]
    assert exported_night["client_aliases"] == ["recap-client", "vycep-client"]
    assert exported_night["title"] == "Můj exportní večer"
    assert exported_night["roast_line"] == "Výčep zavíral první"
    assert exported_night["roast_basis"] == "Čtyři piva a jedna limonáda"
    assert exported_night["participant_ids"] == [participant_id]
    assert exported_night["photo_ids"] == [photo_id]
    assert exported_night["game_ids"] == [game_id]
    assert body["published_night_comments"] == [
        {
            "id": str(own_comment.public_id),
            "client_id": str(own_comment.client_id),
            "night_id": str(other_night.public_id),
            "body": "Můj komentář k cizímu večeru",
            "is_removed": True,
            "created_at": own_comment.created_at.isoformat(),
            "updated_at": own_comment.updated_at.isoformat(),
        }
    ]
    assert "Cizí komentář se nesmí exportovat" not in str(body)


@pytest.mark.django_db
def test_account_export_includes_party_and_community_data(client):
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    now = timezone.now().replace(microsecond=0)
    party = PartyEvening.objects.create(
        host=account,
        client_id=uuid.uuid4(),
        join_code="EXPORT1",
        pub_name="U Exportu",
        pub_city="Praha",
        started_at=now,
    )
    PartyEveningMember.objects.create(evening=party, account=account, joined_at=now)
    party_drink = PartyEveningDrink.objects.create(
        evening=party,
        account=account,
        client_id=uuid.uuid4(),
        beer_name="Exportní ležák",
        quantity=2,
        shared_at=now,
    )
    suggestion = PubEvent.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn12",
        name="U Exportu",
        lat=50.08,
        lng=14.45,
        city="Praha",
        title="Exportní akce",
        details="Detaily od uživatele",
        starts_at=now + timezone.timedelta(days=1),
        ends_at=now + timezone.timedelta(days=2),
    )
    hosted_event = CommunityEvent.objects.create(
        host=account,
        client_id=uuid.uuid4(),
        title="Doma na jedno",
        description="Soukromý popis",
        city="Praha",
        area_label="Vinohrady",
        exact_address="Soukromá 12, zvonek Export",
        lat=50.0755,
        lng=14.4378,
        starts_at=now + timezone.timedelta(days=3),
        ends_at=now + timezone.timedelta(days=3, hours=4),
        capacity=4,
    )
    other = Account.objects.create(device_id=str(uuid.uuid4()), nickname="other")
    joined_event = CommunityEvent.objects.create(
        host=other,
        client_id=uuid.uuid4(),
        title="Cizí setkání",
        city="Brno",
        exact_address="Cizí soukromá adresa",
        lat=49.1951,
        lng=16.6068,
        starts_at=now + timezone.timedelta(days=4),
        ends_at=now + timezone.timedelta(days=4, hours=3),
        capacity=4,
    )
    membership = CommunityEventMembership.objects.create(
        event=joined_event,
        account=account,
        message="Moje soukromá zpráva",
        status=CommunityEventMembership.Status.APPROVED,
    )
    team = CommunityEventTeam.objects.create(
        event=joined_event,
        created_by=account,
        client_id=uuid.uuid4(),
        name="Exportní pěna",
    )
    team_membership = CommunityEventTeamMembership.objects.create(
        event=joined_event,
        team=team,
        account=account,
        slot=1,
    )

    response = client.get("/v1/account/export", **_auth(token))

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["party_evenings"]["hosted"][0]["id"] == str(party.public_id)
    assert body["party_evenings"]["memberships"][0]["evening_id"] == str(party.public_id)
    assert body["party_evenings"]["drinks"][0] == {
        "evening_id": str(party.public_id),
        "client_id": str(party_drink.client_id),
        "beer_name": "Exportní ležák",
        "quantity": 2,
        "shared_at": now.isoformat(),
    }
    assert body["pub_event_suggestions"][0]["id"] == str(suggestion.id)
    assert body["pub_event_suggestions"][0]["lat"] == 50.08
    assert body["community_events"]["hosted"][0]["id"] == str(hosted_event.id)
    assert body["community_events"]["hosted"][0]["exact_address"] == "Soukromá 12, zvonek Export"
    assert body["community_events"]["memberships"][0]["event_id"] == str(joined_event.id)
    assert body["community_events"]["memberships"][0]["message"] == membership.message
    assert body["community_events"]["created_teams"][0]["id"] == str(team.id)
    assert body["community_events"]["created_teams"][0]["name"] == "Exportní pěna"
    assert body["community_events"]["team_memberships"][0] == {
        "id": str(team_membership.id),
        "event_id": str(joined_event.id),
        "team_id": str(team.id),
        "team_name": "Exportní pěna",
        "slot": 1,
        "joined_at": team_membership.joined_at.isoformat(),
    }
    assert "Cizí soukromá adresa" not in str(body)


@pytest.mark.django_db
@override_settings(PUBLIC_API_ORIGIN="https://api.example.test")
def test_account_export_includes_owned_photo_and_only_relevant_game_payloads(client):
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    other = Account.objects.create(device_id=str(uuid.uuid4()), nickname="other")
    now = timezone.now().replace(microsecond=0)
    evening = PartyEvening.objects.create(
        host=account,
        client_id=uuid.uuid4(),
        join_code="GAME42",
        pub_name="U Exportu",
        started_at=now,
    )
    PartyEveningMember.objects.create(evening=evening, account=account, joined_at=now)
    PartyEveningMember.objects.create(evening=evening, account=other, joined_at=now)
    photo = BeerPhoto.objects.create(
        account=account,
        party_evening=evening,
        client_id=uuid.uuid4(),
        image=f"beer-photos/{account.public_id}/owned.webp",
        caption="Moje exportní fotka",
        visibility=BeerPhoto.Visibility.PRIVATE,
        taken_at=now,
    )
    own_game = PartyGame.objects.create(
        evening=evening,
        started_by=account,
        client_id=uuid.uuid4(),
        catalog_key="quiz",
        name="Pub kvíz",
        started_at=now,
        ended_at=now,
    )
    answer = PartyGameEvent.objects.create(
        game=own_game,
        account=account,
        client_id=uuid.uuid4(),
        kind=PartyGameEvent.Kind.ANSWER,
        payload={"questionId": "q-plzen", "option": 0},
        created_at=now,
    )
    result = PartyGameEvent.objects.create(
        game=own_game,
        account=account,
        client_id=uuid.uuid4(),
        kind=PartyGameEvent.Kind.FINISH,
        payload={"winner": "Já", "scores": [{"name": "Já", "score": 7}]},
        created_at=now,
    )
    other_game = PartyGame.objects.create(
        evening=evening,
        started_by=other,
        client_id=uuid.uuid4(),
        catalog_key="dice",
        name="Kostky",
        started_at=now,
    )
    score_about_owner = PartyGameEvent.objects.create(
        game=other_game,
        account=other,
        client_id=uuid.uuid4(),
        kind=PartyGameEvent.Kind.SCORE,
        subject=account,
        delta=2,
        payload={"foreign_private_payload": "nesmí ven"},
        created_at=now,
    )
    unrelated = PartyGameEvent.objects.create(
        game=other_game,
        account=other,
        client_id=uuid.uuid4(),
        kind=PartyGameEvent.Kind.ANSWER,
        payload={"unrelated_secret": "také nesmí ven"},
        created_at=now,
    )

    response = client.get("/v1/account/export", **_auth(token))

    assert response.status_code == status.HTTP_200_OK, response.content
    body = response.json()
    exported_photo = body["beer_photos"][0]
    assert exported_photo["id"] == str(photo.public_id)
    assert exported_photo["image_url"] == (
        f"https://api.example.test/media/beer-photos/{account.public_id}/owned.webp"
    )
    assert "image_path" not in exported_photo

    party_games = body["party_games"]
    assert {game["id"] for game in party_games["games"]} == {
        str(own_game.public_id),
        str(other_game.public_id),
    }
    own_game_export = next(
        game for game in party_games["games"] if game["id"] == str(own_game.public_id)
    )
    other_game_export = next(
        game for game in party_games["games"] if game["id"] == str(other_game.public_id)
    )
    assert own_game_export["client_id"] == str(own_game.client_id)
    assert other_game_export["client_id"] is None
    authored = {event["id"]: event for event in party_games["events_authored"]}
    assert authored[answer.id]["payload"] == {"questionId": "q-plzen", "option": 0}
    assert authored[result.id]["payload"]["winner"] == "Já"
    assert party_games["score_events_as_subject"] == [
        {
            "id": score_about_owner.id,
            "game_id": str(other_game.public_id),
            "kind": PartyGameEvent.Kind.SCORE,
            "delta": 2,
            "created_at": now.isoformat(),
        }
    ]
    serialized = str(body)
    assert "foreign_private_payload" not in serialized
    assert "unrelated_secret" not in serialized
    assert str(unrelated.id) not in {
        str(event["id"])
        for event in [
            *party_games["events_authored"],
            *party_games["score_events_as_subject"],
        ]
    }


@pytest.mark.django_db
def test_account_export_reuses_loaded_auth_relations(client):
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    EmailCredential.objects.create(
        account=account,
        email="export@example.com",
        password="!",
        email_verified=True,
    )
    AuthIdentity.objects.create(
        account=account,
        provider=AuthIdentity.Provider.GOOGLE,
        subject="google-export",
        email="social@example.com",
    )
    AuthIdentity.objects.create(
        account=account,
        provider=AuthIdentity.Provider.APPLE,
        subject="apple-export",
        email="apple@example.com",
        apple_refresh_token="TOP-SECRET-REFRESH",
    )

    with CaptureQueriesContext(connection) as queries:
        resp = client.get("/v1/account/export", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["account"]["email"] == "export@example.com"
    assert body["account"]["email_verified"] is True
    assert set(body["account"]["providers"]) == {"email", "google", "apple"}
    assert body["mapping_history"]["community_data"] == []
    assert body["mapping_history"]["pub_beer_brands"] == []
    assert body["mapping_history"]["pub_beer_products"] == []
    assert sorted(body["account"]["identities"], key=lambda i: i["provider"]) == [
        {
            "provider": "apple",
            "subject": "apple-export",
            "email": "apple@example.com",
            "created_at": next(
                i for i in body["account"]["identities"] if i["provider"] == "apple"
            )["created_at"],
        },
        {
            "provider": "google",
            "subject": "google-export",
            "email": "social@example.com",
            "created_at": next(
                i for i in body["account"]["identities"] if i["provider"] == "google"
            )["created_at"],
        },
    ]
    serialized = str(body)
    assert "apple_refresh_token" not in serialized
    assert "TOP-SECRET-REFRESH" not in serialized

    select_queries = [
        query["sql"].lower()
        for query in queries.captured_queries
        if query["sql"].lstrip().lower().startswith("select")
    ]
    assert sum('"pubs_emailcredential"' in sql for sql in select_queries) == 1
    assert sum('"pubs_authidentity"' in sql for sql in select_queries) == 1
    assert len(queries.captured_queries) <= 41


@pytest.mark.django_db
@override_settings(PUBLIC_API_ORIGIN="https://api.example.test")
def test_account_export_post_sends_json_export_by_email(client, monkeypatch):
    sent: dict = {}

    def fake_send_account_export_email(to, *, filename, json_bytes, idempotency_key=None):
        sent["to"] = to
        sent["filename"] = filename
        sent["json_bytes"] = json_bytes
        sent["idempotency_key"] = idempotency_key
        return True

    monkeypatch.setattr(emailer, "send_account_export_email", fake_send_account_export_email)

    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    EmailCredential.objects.create(
        account=account,
        email="export@example.com",
        password="!",
        email_verified=True,
    )
    account.avatar = "avatars/email-export.webp"
    account.save(update_fields=["avatar"])
    BeerPhoto.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        image=f"beer-photos/{account.public_id}/email-owned.webp",
        caption="Fotka v e-mailovém exportu",
        visibility=BeerPhoto.Visibility.PRIVATE,
        taken_at=timezone.now(),
    )
    DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn12",
        name="U Exportu",
        lat=50.08,
        lng=14.45,
        beer_name="Ležák",
        price_czk=59,
        volume_ml=500,
        drank_at=timezone.now(),
    )

    resp = client.post("/v1/account/export", data={}, format="json", **_auth(token))

    assert resp.status_code == status.HTTP_202_ACCEPTED, resp.content
    assert resp.json() == {"email": "export@example.com"}
    assert sent["to"] == "export@example.com"
    assert sent["filename"].startswith("na-pivo-export-")
    assert sent["filename"].endswith(".json")
    assert sent["idempotency_key"].startswith("account-export/")
    payload = json.loads(sent["json_bytes"])
    assert payload["account"]["avatar_url"] == (
        "https://api.example.test/media/avatars/email-export.webp"
    )
    assert payload["beer_photos"][0]["image_url"] == (
        f"https://api.example.test/media/beer-photos/{account.public_id}/email-owned.webp"
    )
    body = sent["json_bytes"].decode("utf-8")
    assert '"beer_name": "Ležák"' in body
    assert token not in body


@pytest.mark.django_db
def test_account_export_post_requires_verified_email_credential(client, monkeypatch):
    sent = False

    def fake_send_account_export_email(*args, **kwargs):
        nonlocal sent
        sent = True
        return True

    monkeypatch.setattr(emailer, "send_account_export_email", fake_send_account_export_email)

    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    EmailCredential.objects.create(
        account=account,
        email="unverified@example.com",
        password="!",
        email_verified=False,
    )

    # Direct authenticated download is still allowed.
    direct = client.get("/v1/account/export", **_auth(token))
    assert direct.status_code == status.HTTP_200_OK, direct.content
    assert direct.json()["account"]["email_verified"] is False

    emailed = client.post("/v1/account/export", data={}, format="json", **_auth(token))
    assert emailed.status_code == status.HTTP_403_FORBIDDEN, emailed.content
    assert emailed.json()["code"] == "email_unverified"
    assert sent is False


@pytest.mark.django_db
def test_account_export_post_requires_account_email(client):
    token, _ = _bootstrap(client)

    resp = client.post("/v1/account/export", data={}, format="json", **_auth(token))

    assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.content
    assert resp.json()["code"] == "missing_email"


@pytest.mark.django_db
def test_account_export_post_surfaces_email_failure(client, monkeypatch):
    monkeypatch.setattr(emailer, "send_account_export_email", lambda *args, **kwargs: False)

    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    EmailCredential.objects.create(
        account=account,
        email="export@example.com",
        password="!",
        email_verified=True,
    )

    resp = client.post("/v1/account/export", data={}, format="json", **_auth(token))

    assert resp.status_code == status.HTTP_502_BAD_GATEWAY, resp.content
    assert resp.json()["code"] == "email_failed"


@pytest.mark.django_db
def test_content_report_creates_moderation_record(client):
    reporter_token, _ = _bootstrap(client)
    target_token, target_id = _bootstrap(client)
    target = Account.objects.get(public_id=target_id)
    target.is_public = True
    target.nickname = "BadName"
    target.display_name = "Bad Display"
    target.save(update_fields=["is_public", "nickname", "display_name"])

    resp = client.post(
        "/v1/content-reports",
        data={
            "target_account_id": target_id,
            "reason": ContentReport.Reason.INAPPROPRIATE_NICKNAME,
            "comment": "Sprostá přezdívka.",
        },
        format="json",
        **_auth(reporter_token),
    )

    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()
    assert body["target_account_id"] == target_id
    assert body["status"] == ContentReport.Status.NEW
    report = ContentReport.objects.get()
    assert report.target_snapshot["nickname"] == "BadName"
    assert report.target_snapshot["display_name"] == "Bad Display"

    self_report = client.post(
        "/v1/content-reports",
        data={
            "target_account_id": target_id,
            "reason": ContentReport.Reason.OTHER,
        },
        format="json",
        **_auth(target_token),
    )
    assert self_report.status_code == status.HTTP_400_BAD_REQUEST
    assert self_report.json()["code"] == "self_report"


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("is_public", "status_value"),
    [
        (False, Account.Status.ACTIVE),
        (True, Account.Status.PENDING_DELETION),
    ],
)
def test_content_report_requires_public_active_target(client, is_public, status_value):
    reporter_token, _ = _bootstrap(client)
    _, target_id = _bootstrap(client)
    target = Account.objects.get(public_id=target_id)
    target.is_public = is_public
    target.status = status_value
    target.save(update_fields=["is_public", "status"])

    resp = client.post(
        "/v1/content-reports",
        data={
            "target_account_id": target_id,
            "reason": ContentReport.Reason.OTHER,
            "comment": "Nemá být reportovatelný.",
        },
        format="json",
        **_auth(reporter_token),
    )

    assert resp.status_code == status.HTTP_404_NOT_FOUND
    assert resp.json()["code"] == "profile_not_found"
    assert ContentReport.objects.count() == 0


@pytest.mark.django_db
def test_content_report_allows_reporting_non_public_accepted_friend(client):
    # A non-public profile that is an accepted friend (visible via friends
    # dashboard / RSVP roster) must stay reportable for moderation.
    reporter_token, reporter_id = _bootstrap(client)
    _, target_id = _bootstrap(client)
    reporter = Account.objects.get(public_id=reporter_id)
    target = Account.objects.get(public_id=target_id)
    target.is_public = False
    target.nickname = "PrivatePal"
    target.save(update_fields=["is_public", "nickname"])
    Friendship.objects.create(
        requester=reporter,
        recipient=target,
        status=Friendship.Status.ACCEPTED,
    )

    resp = client.post(
        "/v1/content-reports",
        data={
            "target_account_id": target_id,
            "reason": ContentReport.Reason.OTHER,
            "comment": "Nevhodný obsah u kamaráda.",
        },
        format="json",
        **_auth(reporter_token),
    )

    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    report = ContentReport.objects.get()
    assert report.target_account_id == target.pk
    assert report.target_snapshot["nickname"] == "PrivatePal"


@pytest.mark.django_db
def test_content_report_allows_reporting_non_public_pending_requester(client):
    # A non-public account that sent the reporter a friend request is shown to
    # them in the friends dashboard's incoming-requests list, so an abusive
    # requester must stay reportable even though the request is only pending.
    reporter_token, reporter_id = _bootstrap(client)
    _, target_id = _bootstrap(client)
    reporter = Account.objects.get(public_id=reporter_id)
    target = Account.objects.get(public_id=target_id)
    target.is_public = False
    target.nickname = "PushyStranger"
    target.save(update_fields=["is_public", "nickname"])
    Friendship.objects.create(
        requester=target,
        recipient=reporter,
        status=Friendship.Status.PENDING,
    )

    resp = client.post(
        "/v1/content-reports",
        data={
            "target_account_id": target_id,
            "reason": ContentReport.Reason.OTHER,
            "comment": "Otravná žádost s nevhodným jménem.",
        },
        format="json",
        **_auth(reporter_token),
    )

    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    report = ContentReport.objects.get()
    assert report.target_account_id == target.pk
    assert report.target_snapshot["nickname"] == "PushyStranger"


@pytest.mark.django_db
def test_content_report_rejects_non_public_stranger(client):
    # Without an accepted friendship, a non-public profile stays invisible and
    # therefore unreportable (404), so reports cannot probe private accounts.
    reporter_token, _ = _bootstrap(client)
    _, target_id = _bootstrap(client)
    target = Account.objects.get(public_id=target_id)
    target.is_public = False
    target.save(update_fields=["is_public"])

    resp = client.post(
        "/v1/content-reports",
        data={
            "target_account_id": target_id,
            "reason": ContentReport.Reason.OTHER,
        },
        format="json",
        **_auth(reporter_token),
    )

    assert resp.status_code == status.HTTP_404_NOT_FOUND
    assert resp.json()["code"] == "profile_not_found"
    assert ContentReport.objects.count() == 0
