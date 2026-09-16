"""
send_release_apology_push — one-off push to the people who lived through 2.0.

2.1.0 brought the simple app back after the 2.0 redesign. This sends every
push-enabled device that last registered with a 2.x app version one message:
"Omlouvám se za dvojku" plus a line saying the old app is back. People still
on 2.0.0 learn the fix exists; people already on 2.1.0 get the apology even if
they have not opened the app yet.

Reuses the friends push fanout, so quiet hours are honoured (a recipient inside
their quiet window is skipped, not retried). Run it in the afternoon, when
nobody has quiet hours, and run it once: there is no sent-marker.

Usage:
    python manage.py send_release_apology_push                 # dry run: counts only
    python manage.py send_release_apology_push --send          # deliver
    python manage.py send_release_apology_push --send --version-prefix 2.0
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext_lazy

from pubs.api.views import _account_in_quiet_hours, _send_friend_push
from pubs.i18n import LocalizedText
from pubs.models import Account, PushDevice

PUSH_KIND = "release_apology"
TITLE = gettext_lazy("Omlouvám se za dvojku")
BODY = gettext_lazy("Nová verze se nepovedla. Stará appka je zpátky, stačí aktualizovat.")


class Command(BaseCommand):
    help = "Send the one-off 2.1.0 apology push to devices on a 2.x app version."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--send", action="store_true", help="Deliver; without it only counts are printed.")
        parser.add_argument(
            "--version-prefix",
            default="2.",
            help="Only devices whose registered app_version starts with this (default '2.').",
        )

    def handle(self, *args, send: bool, version_prefix: str, **options) -> None:
        account_ids = sorted(
            set(
                PushDevice.objects.filter(
                    Q(app_version__startswith=version_prefix)
                    | Q(app_version__startswith=f"v{version_prefix}"),
                    enabled=True,
                    permission_status=PushDevice.PermissionStatus.GRANTED,
                ).values_list("account_id", flat=True)
            )
        )
        now = timezone.now()
        quiet = sum(
            1
            for account in Account.objects.filter(id__in=account_ids).only(
                "id", "quiet_hours_enabled", "quiet_hours_start", "quiet_hours_end"
            )
            if _account_in_quiet_hours(account, now)
        )
        self.stdout.write(
            f"recipients: {len(account_ids)} accounts on app_version {version_prefix}* "
            f"({quiet} currently in quiet hours would be skipped)"
        )
        if not send:
            self.stdout.write("dry run, nothing sent; add --send to deliver")
            return
        _send_friend_push(
            account_ids,
            LocalizedText(TITLE),
            LocalizedText(BODY),
            {"kind": PUSH_KIND},
            app_version_prefix=version_prefix,
        )
        self.stdout.write(f"sent to {len(account_ids) - quiet} accounts")
