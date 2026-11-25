"""Copy Google Search Console's numbers for the admin's web analytics, at most every 6 hours.

A no-op while ``SEARCH_CONSOLE_SERVICE_ACCOUNT`` is empty, so the worker loop can
call it unconditionally. ``--force`` skips the 6-hour wait.
"""

from __future__ import annotations

import logging

import requests
from django.core.management.base import BaseCommand
from google.auth.exceptions import GoogleAuthError

from pubs import search_console

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Copy Google Search Console search results into SearchConsoleDaily."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Sync even if the last sync is recent.")

    def handle(self, *args, **options):
        if not search_console.configured():
            self.stdout.write("Search Console is not configured; skipping.")
            return
        if not options["force"] and not search_console.due():
            return
        try:
            written = search_console.sync(search_console.session())
        except (requests.RequestException, GoogleAuthError, ValueError) as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            logger.warning("search_console_sync_failed", extra={"error": type(exc).__name__, "status": status})
            self.stderr.write(f"Search Console sync failed: {type(exc).__name__} {status or ''}".rstrip())
            return
        self.stdout.write(f"Search Console: {written} rows.")
