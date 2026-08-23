"""Account.quorum_trusted_at (community quorum trust, Phase A) + backfill.

Schema first, then a conservative one-shot backfill: only accounts that
ALREADY hold an accepted Phase A proof (a verified email credential or a
Google/Apple auth identity) get stamped, and every stamp uses the single
frozen migration-time "now" so all backfilled accounts start a fresh,
full 24-hour trust-ripening window. Rows that already carry a stamp are
left untouched.

Eligibility is resolved entirely in the database (Exists subqueries inside
one UPDATE); no account ids are materialized in Python. The reverse run is
a no-op: leaving a harmless stamp is safer than erasing trust earned
legitimately after the deploy.
"""

import django.utils.timezone
from django.db import migrations, models
from django.db.models import Exists, OuterRef, Q


def backfill_forwards(apps, schema_editor):
    Account = apps.get_model("pubs", "Account")
    EmailCredential = apps.get_model("pubs", "EmailCredential")
    AuthIdentity = apps.get_model("pubs", "AuthIdentity")

    # Single frozen timestamp: every backfilled stamp starts a fresh full
    # 24-hour trust-ripening window from the migration moment.
    frozen_now = django.utils.timezone.now()

    verified_email = EmailCredential.objects.filter(
        account_id=OuterRef("pk"), email_verified=True
    )
    oauth_identity = AuthIdentity.objects.filter(
        Q(account_id=OuterRef("pk")) & Q(provider__in=("google", "apple"))
    )

    Account.objects.filter(quorum_trusted_at__isnull=True).filter(
        Exists(verified_email) | Exists(oauth_identity)
    ).update(quorum_trusted_at=frozen_now)


class Migration(migrations.Migration):

    dependencies = [
        ('pubs', '0123_feedback_attachment_outbox'),
    ]

    operations = [
        migrations.AddField(
            model_name='account',
            name='quorum_trusted_at',
            field=models.DateTimeField(blank=True, help_text='When this account proved its identity through a channel the community quorum trusts (verified email consumption, password-reset proof, or a cryptographically verified Google/Apple sign-in/link). Stamped once in the same transaction as the proof and never advanced; null means no proof yet. Server-only: omitted from normal session and profile payloads, included only in the user\'s own data export.', null=True),
        ),
        migrations.RunPython(backfill_forwards, migrations.RunPython.noop),
    ]
