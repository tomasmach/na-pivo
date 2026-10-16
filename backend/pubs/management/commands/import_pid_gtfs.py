"""Import the Prague PID GTFS timetable once a day.

Runs from the worker loop every five minutes and does nothing until the active
feed was last checked ``--min-interval-hours`` ago. The download is conditional
(ETag / Last-Modified), capped in size and counted against a small daily budget
so a broken feed is not fetched again every five minutes. The new feed is built
and swapped in one transaction; a failed import leaves the old one active.
"""

from __future__ import annotations

import hashlib
import tempfile
import time
from datetime import timedelta
from pathlib import Path

import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from pubs.external_api_budget import reserve_external_api_request
from pubs.models import TransitFeed
from pubs.transit import PRAGUE_TZ, GtfsError, import_feed

# An unchanged file is reused only while its expanded service days still cover
# the next nights; after this many days it is rebuilt to move the window.
REUSE_FEED_DAYS = 3
_CONNECT_TIMEOUT_S = 15
_READ_TIMEOUT_S = 60
_DOWNLOAD_DEADLINE_S = 600
_CHUNK = 1024 * 1024


def _download(url: str, dest, *, etag: str, last_modified: str) -> tuple[str, str, str] | None:
    """Stream the zip into ``dest``; None on 304. Returns (sha256, etag, last_modified)."""

    headers = {"User-Agent": "na-pivo-backend (+https://na-pivo.cz)"}
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified
    deadline = time.monotonic() + _DOWNLOAD_DEADLINE_S
    with requests.get(
        url, headers=headers, stream=True, timeout=(_CONNECT_TIMEOUT_S, _READ_TIMEOUT_S)
    ) as response:
        if response.status_code == 304:
            return None
        if response.status_code != 200:
            raise CommandError(f"PID GTFS download failed: HTTP {response.status_code}")
        digest = hashlib.sha256()
        size = 0
        for chunk in response.iter_content(_CHUNK):
            size += len(chunk)
            if size > settings.PID_GTFS_MAX_BYTES:
                raise CommandError(
                    f"PID GTFS download is larger than {settings.PID_GTFS_MAX_BYTES} bytes"
                )
            if time.monotonic() > deadline:
                raise CommandError("PID GTFS download took too long")
            digest.update(chunk)
            dest.write(chunk)
        dest.flush()
        return (
            digest.hexdigest(),
            response.headers.get("ETag", ""),
            response.headers.get("Last-Modified", ""),
        )


def _file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


class Command(BaseCommand):
    help = "Import the PID (Prague) GTFS timetable for the last-ride-home card."

    def add_arguments(self, parser):
        parser.add_argument(
            "--source",
            default=None,
            help="GTFS zip URL or local path (default: settings.PID_GTFS_URL).",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Ignore the interval, the daily download budget and conditional GET.",
        )
        parser.add_argument(
            "--min-interval-hours",
            type=float,
            default=20.0,
            help="Skip while the active feed was checked more recently than this.",
        )

    def handle(self, *args, **options):
        source = options["source"] or settings.PID_GTFS_URL
        force = options["force"]
        now = timezone.now()
        active = TransitFeed.objects.filter(active=True).order_by("-imported_at").first()
        if (
            not force
            and active is not None
            and now - active.checked_at < timedelta(hours=options["min_interval_hours"])
        ):
            if options["verbosity"] >= 2:
                self.stdout.write("PID GTFS was checked recently; skipping.")
            return

        reusable = (
            not force
            and active is not None
            and timezone.localtime(now, PRAGUE_TZ).date()
            - timezone.localtime(active.imported_at, PRAGUE_TZ).date()
            < timedelta(days=REUSE_FEED_DAYS)
        )
        started = time.monotonic()

        if not source.startswith(("http://", "https://")):
            if not Path(source).is_file():
                raise CommandError(f"PID GTFS source not found: {source}")
            self._import(source, source, _file_sha256(source), "", "", active, reusable, started)
            return

        if not force and not reserve_external_api_request(
            provider="pid",
            operation="gtfs_download",
            cap=settings.PID_GTFS_DAILY_DOWNLOADS,
            reset_timezone="Europe/Prague",
        ):
            if options["verbosity"] >= 2:
                self.stdout.write("PID GTFS daily download budget is used up; skipping.")
            return

        with tempfile.NamedTemporaryFile(suffix=".zip") as tmp:
            try:
                downloaded = _download(
                    source,
                    tmp,
                    etag=active.etag if reusable else "",
                    last_modified=active.last_modified if reusable else "",
                )
            except requests.RequestException as exc:
                raise CommandError(f"PID GTFS download failed: {type(exc).__name__}") from None
            if downloaded is None:
                if active is None:
                    raise CommandError("PID GTFS answered 304 to an unconditional request")
                active.checked_at = now
                active.save(update_fields=["checked_at"])
                self.stdout.write(f"PID GTFS {active.version} unchanged (HTTP 304).")
                return
            sha256, etag, last_modified = downloaded
            self._import(tmp.name, source, sha256, etag, last_modified, active, reusable, started)

    def _import(self, path, source, sha256, etag, last_modified, active, reusable, started):
        now = timezone.now()
        if reusable and active.sha256 == sha256:
            active.checked_at = now
            active.etag = etag[:255] or active.etag
            active.last_modified = last_modified[:64] or active.last_modified
            active.save(update_fields=["checked_at", "etag", "last_modified"])
            self.stdout.write(f"PID GTFS {active.version} unchanged.")
            return
        try:
            result = import_feed(
                path,
                source=source,
                sha256=sha256,
                etag=etag,
                last_modified=last_modified,
                now=now,
            )
        except GtfsError as exc:
            raise CommandError(f"PID GTFS import failed: {exc}") from None
        self.stdout.write(
            self.style.SUCCESS(
                f"Imported PID GTFS {result.feed.version}: {result.stops} stops, "
                f"{result.patterns} patterns ({result.pattern_stops} pattern stops), "
                f"{result.trips} trips, {result.service_dates} service days, "
                f"{result.skipped_trips} trips skipped, "
                f"{time.monotonic() - started:.1f} s."
            )
        )
