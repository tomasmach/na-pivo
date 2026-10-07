"""Small synthetic accounts and whitelisted observations for native identity flows."""

import hashlib
import json
import os
import uuid
from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.core import mail
from django.utils import timezone
from pubs.models import (
    Account,
    AccountUsageStats,
    AuthToken,
    BeerPhoto,
    DrinkLog,
    EmailCredential,
    Friendship,
    OneTimeToken,
    ReleaseNote,
    ReleaseNoteItem,
    account_avatar_path,
)

from e2e.seeds import base


def seed_observers(primary=None):
    for role, nickname in (("second", "E2EKamarad"), ("outsider", "E2ECizi")):
        account = Account.objects.create(
            device_id=f"e2e-identity-{role}",
            nickname=nickname,
            display_name=f"E2E {role}",
        )
        EmailCredential.objects.create(
            account=account,
            email=f"{role}-{os.environ['NA_PIVO_E2E_EMAIL']}",
            password=make_password(os.environ["NA_PIVO_E2E_PASSWORD"]),
            email_verified=True,
        )
        if role == "second" and primary:
            Friendship.objects.create(
                requester=primary, recipient=account, status=Friendship.Status.ACCEPTED
            )


def seed():
    base.seed()
    primary = Account.objects.get(nickname="E2EPivar")
    seed_observers(primary)
    AccountUsageStats.objects.create(account=primary, photo_contest_wins_count=1)
    for nickname, beer in (("E2EPivar", "E2E Archiv A"), ("E2EKamarad", "E2E Archiv B")):
        DrinkLog.objects.create(
            account=Account.objects.get(nickname=nickname),
            client_id=uuid.uuid4(),
            beer_name=beer,
            place_context="private",
            drink_type="beer",
            serving_type="bottle",
            price_czk=30,
            volume_ml=500,
            drank_at=timezone.now() - timedelta(days=2),
        )
    note = ReleaseNote.objects.create(
        version="0.0.1-e2e",
        title="E2E místní novinky",
        title_en="E2E local updates",
        is_published=True,
    )
    ReleaseNoteItem.objects.create(
        release_note=note, text="E2E kontrola deníčku", text_en="E2E diary verification"
    )


def avatar_digest(account):
    if not account.avatar or not account.avatar.storage.exists(account.avatar.name):
        return None
    digest = hashlib.sha256()
    with account.avatar.storage.open(account.avatar.name, "rb") as image:
        for chunk in iter(lambda: image.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()


def observe():
    rows = []
    for account in Account.objects.order_by("pk"):
        credential = EmailCredential.objects.filter(account=account).first()
        rows.append(
            {
                "publicId": str(account.public_id),
                "nickname": account.nickname,
                "displayName": account.display_name,
                "isPublic": account.is_public,
                "status": account.status,
                "deleted": account.deleted_at is not None,
                "originalPasswordWorks": bool(
                    credential
                    and check_password(os.environ["NA_PIVO_E2E_PASSWORD"], credential.password)
                ),
                "newPasswordWorks": bool(
                    credential
                    and check_password(os.environ["NA_PIVO_E2E_NEW_PASSWORD"], credential.password)
                ),
                "hasAvatar": bool(account.avatar),
                "avatarDigest": avatar_digest(account),
                "avatarFileExists": bool(
                    account.avatar and account.avatar.storage.exists(account.avatar.name)
                ),
                # Avatars use one stable path, so a cleared field cannot hide a kept file.
                "avatarStoredFile": Account._meta.get_field("avatar").storage.exists(
                    account_avatar_path(account, "")
                ),
                "settings": {
                    "hidePubNames": account.hide_pub_names,
                    "hapticEnabled": account.haptic_enabled,
                    "marketingEmailsEnabled": account.marketing_emails_enabled,
                },
                "drinks": [
                    {"clientId": str(drink.client_id), "beerName": drink.beer_name}
                    for drink in DrinkLog.objects.filter(account=account).order_by("pk")
                ],
                "sessionTokens": AuthToken.objects.filter(account=account, kind="session").count(),
                "photos": [
                    {
                        "publicId": str(photo.public_id),
                        "clientId": str(photo.client_id),
                        "caption": photo.caption,
                        "visibility": photo.visibility,
                        "fileExists": photo.image.storage.exists(photo.image.name),
                    }
                    for photo in BeerPhoto.objects.filter(account=account).order_by("pk")
                ],
                "oneTimeTokens": [
                    {"purpose": token.purpose, "used": token.used_at is not None}
                    for token in OneTimeToken.objects.filter(account=account)
                ],
            }
        )
    messages = getattr(mail, "outbox", [])
    exports = []
    for message in messages:
        for attachment in message.attachments:
            filename, content, _mime = attachment
            if not filename.endswith(".json"):
                continue
            payload = json.loads(content)
            # Do not return contact data, credentials, coordinates or the rendered mail.
            exports.append(
                {
                    "sections": sorted(payload.keys()),
                    "publicId": payload["account"]["id"],
                    "drinks": [
                        {"clientId": drink["client_id"], "beerName": drink["beer_name"]}
                        for drink in payload["drinks"]
                    ],
                }
            )
    return {
        "accounts": rows,
        "mail": {
            "verify": sum("/auth/verify-email" in message.body for message in messages),
            "reset": sum("/auth/reset" in message.body for message in messages),
            "exports": exports,
        },
    }
