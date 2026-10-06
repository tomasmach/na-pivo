"""An existing unverified account can verify its real local mail and export."""

import json

from django.core import mail
from pubs.models import Account, AccountExportJob, DrinkLog, EmailCredential

from e2e.seeds import identity


def seed():
    identity.seed()
    EmailCredential.objects.filter(account__nickname="E2EPivar").update(email_verified=False)


def observe():
    observation = identity.observe()
    primary = Account.objects.get(nickname="E2EPivar")
    credential = EmailCredential.objects.get(account=primary)
    other_contacts = list(
        EmailCredential.objects.exclude(account=primary).values_list("email", flat=True)
    )
    other_drinks = list(
        DrinkLog.objects.exclude(account=primary).values_list("client_id", flat=True)
    )
    exports = []
    for message in getattr(mail, "outbox", []):
        for filename, content, _mime in message.attachments:
            if not filename.endswith(".json"):
                continue
            payload = json.loads(content)
            serialized = json.dumps(payload)
            exports.append(
                {
                    "publicId": payload["account"]["id"],
                    "nickname": payload["account"]["nickname"],
                    "verified": payload["account"]["email_verified"],
                    "correctRecipient": message.to == [credential.email],
                    "correctContact": payload["account"]["email"] == credential.email,
                    "otherPrivateDataAbsent": not any(
                        value in serialized for value in other_contacts
                    )
                    and not any(str(value) in serialized for value in other_drinks),
                    "drinks": [
                        {
                            key: drink[key]
                            for key in (
                                "client_id", "beer_name", "price_czk", "volume_ml",
                                "place_context", "drink_type", "serving_type",
                            )
                        }
                        for drink in payload["drinks"]
                    ],
                }
            )
    # Never expose rendered mail, contacts, credentials, tokens or coordinates.
    observation["exportAttachments"] = exports
    observation["exportJobs"] = [
        {"publicId": str(job.account.public_id), "status": job.status}
        for job in AccountExportJob.objects.select_related("account").order_by("pk")
    ]
    return observation
