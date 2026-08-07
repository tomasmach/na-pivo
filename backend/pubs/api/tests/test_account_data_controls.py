from __future__ import annotations

import base64
import uuid

import pytest
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs import emailer
from pubs.models import (
    Account,
    AuthIdentity,
    BeerCheckIn,
    BeerPhoto,
    CommunityEvent,
    CommunityEventMembership,
    CommunityEventTeam,
    CommunityEventTeamMembership,
    ContentReport,
    DrinkLog,
    EmailCredential,
    Friendship,
    PartyEvening,
    PartyEveningDrink,
    PartyEveningMember,
    PartyGame,
    PartyGameEvent,
    PubEvent,
    PublishedNight,
    PublishedNightComment,
    PushDevice,
)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
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

    resp = client.get("/v1/account/export", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp["Content-Disposition"] == 'attachment; filename="na-pivo-export.json"'
    body = resp.json()
    assert body["account"]["id"] == account_id
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
    assert exported_photo["image_path"] == photo.image.name
    assert not exported_photo["image_path"].startswith("/")

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

    with CaptureQueriesContext(connection) as queries:
        resp = client.get("/v1/account/export", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["account"]["email"] == "export@example.com"
    assert body["account"]["email_verified"] is True
    assert set(body["account"]["providers"]) == {"email", "google"}

    select_queries = [
        query["sql"].lower()
        for query in queries.captured_queries
        if query["sql"].lstrip().lower().startswith("select")
    ]
    assert sum('"pubs_emailcredential"' in sql for sql in select_queries) == 1
    assert sum('"pubs_authidentity"' in sql for sql in select_queries) == 1


@pytest.mark.django_db
def test_account_export_post_sends_json_export_by_email(client, monkeypatch):
    sent: dict = {}

    def fake_send_account_export_email(to, *, filename, json_bytes):
        sent["to"] = to
        sent["filename"] = filename
        sent["json_bytes"] = json_bytes
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
