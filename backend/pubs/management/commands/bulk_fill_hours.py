"""
pubs.management.commands.bulk_fill_hours — one-shot BULK pre-fill of PubHours.

Unlike refresh_hours (lazy, cron-driven, runs through the residential proxy),
this command pre-fills opening hours + ratings for a whole AREA in a single
run, designed to be executed FROM A RESIDENTIAL IP (your laptop) with NO proxy
— a home IP reaches firmy.cz directly, so the per-GB residential-proxy bill is
avoided entirely.

Two phases, two rate regimes, joined by a catalogue file:

  1. CATALOGUE  — sweep a grid of Mapy.cz /v1/suggest cells over the target
     bbox to enumerate pub-like POIs (name, lat, lng, city). Bounded by the
     Mapy daily cap. Cached to --catalogue so a resume / Apify hand-off reuses
     it without re-spending Mapy credits.

  2. FILL       — for each catalogue pub not already fresh in PubHours, scrape
     firmy.cz via FirmyHoursSource (throttled, NO proxy) and upsert the result
     (hours + rating + venue classification), reusing refresh_hours._persist_result.

Resume: re-running skips any pub whose geohash-8 cache_key already has a fresh
PubHours row (status ok/unknown within --ttl-days). Kill it anytime; rerun to
continue.

Ban → Apify hand-off: a residential IP that gets flagged starts bouncing to the
Seznam consent wall (a TransientFetchError). After --ban-threshold consecutive
transient failures the command ABORTS and writes the not-yet-filled pubs to
--remaining-out. Feed that JSON straight into the Apify firmy.cz actor
(delectable_incubator/firmy-cz-scraper, $2.98/1000) to finish the job in the
cloud without burning your home IP.

Usage
-----
  # Prague metro (default), $0 from a home IP, 1.5s throttle:
  python manage.py bulk_fill_hours --throttle 1.5

  # Custom area; large sweep with the Mapy brake lifted:
  python manage.py bulk_fill_hours --center 49.195,16.608 --radius-km 20
  python manage.py bulk_fill_hours --bbox 12.0,48.5,18.9,51.1 --mapy-cap 1000000  # ~whole CZ

  # Reuse a catalogue, cap this run, dry-run:
  python manage.py bulk_fill_hours --limit 500
  python manage.py bulk_fill_hours --dry-run
"""

from __future__ import annotations

import json
import logging
import math
import time
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from pubs.enrichment import FirmyHoursSource, geohash8
from pubs.enrichment.firmy import TransientFetchError
from pubs.enrichment.mapy import (
    MapyAllQueriesFailedError,
    MapyDailyCapExceededError,
    MapySuggestSource,
)

# Reuse the exact PubHours upsert logic the cron command already uses, so the
# bulk path can never diverge from the lazy path on how a result is persisted.
from pubs.management.commands.refresh_hours import _persist_result
from pubs.models import PubHours

logger = logging.getLogger(__name__)

# Default sweep area: greater Prague (a sane first run, not all of CZ).
_DEFAULT_CENTER = (50.0875, 14.4213)
_DEFAULT_RADIUS_KM = 15.0
_FRESH_STATUSES = (PubHours.Status.OK, PubHours.Status.UNKNOWN)


# ---------------------------------------------------------------------------
# Geo helpers
# ---------------------------------------------------------------------------


def _bbox_from_center(lat: float, lng: float, radius_km: float) -> tuple[float, float, float, float]:
    """Return (lonMin, latMin, lonMax, latMax) for a center + radius."""
    d_lat = radius_km / 111.0
    d_lng = radius_km / (111.0 * math.cos(math.radians(lat)))
    return (lng - d_lng, lat - d_lat, lng + d_lng, lat + d_lat)


def _grid_centers(
    bbox: tuple[float, float, float, float], cell_km: float
) -> list[tuple[float, float]]:
    """Return (lat, lng) cell centres tiling *bbox* at ~cell_km spacing."""
    lon_min, lat_min, lon_max, lat_max = bbox
    d_lat = cell_km / 111.0
    centers: list[tuple[float, float]] = []
    lat = lat_min + d_lat / 2
    while lat < lat_max:
        d_lng = cell_km / (111.0 * math.cos(math.radians(lat)))
        lng = lon_min + d_lng / 2
        while lng < lon_max:
            centers.append((lat, lng))
            lng += d_lng
        lat += d_lat
    return centers


def _municipality(item: dict) -> str | None:
    """Best-effort city from a Mapy suggest item's regionalStructure."""
    rs = item.get("regionalStructure") or []
    for entry in rs:
        if entry.get("type") == "regional.municipality" and entry.get("name"):
            return entry["name"]
    for entry in rs:
        if entry.get("name"):
            return entry["name"]
    return None


def _fmt_duration(seconds: float) -> str:
    """Compact h/m/s string for an ETA (e.g. '1h52m', '7m03s', '12s')."""
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h{m:02d}m"
    if m:
        return f"{m}m{s:02d}s"
    return f"{s}s"


# ---------------------------------------------------------------------------
# Command
# ---------------------------------------------------------------------------


class Command(BaseCommand):
    help = (
        "One-shot BULK pre-fill of PubHours for an area, run from a residential "
        "IP with no proxy. Resumable; on a firmy.cz ban, dumps remaining pubs "
        "for the Apify actor."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument("--bbox", type=str, default=None,
                            help='"lonMin,latMin,lonMax,latMax" sweep area (overrides --center).')
        parser.add_argument("--center", type=str, default=None,
                            help='"lat,lng" centre (with --radius-km). Default greater Prague.')
        parser.add_argument("--radius-km", type=float, default=_DEFAULT_RADIUS_KM,
                            help="Radius around --center in km (default 15).")
        parser.add_argument("--cell-km", type=float, default=5.0,
                            help="Mapy grid cell size in km (default 5).")
        parser.add_argument("--mapy-cap", type=int, default=None,
                            help="Per-run Mapy request cap for the sweep (default settings.MAPY_DAILY_CAP=5000). "
                                 "Raise it (e.g. 1000000) to sweep a large area in one go. This counter is "
                                 "per-process and never touches the running app's cap.")
        parser.add_argument("--catalogue", type=str, default="scripts/pub_catalogue.json",
                            help="Catalogue cache file (built if missing).")
        parser.add_argument("--rebuild-catalogue", action="store_true", default=False,
                            help="Force re-sweep Mapy even if the catalogue file exists.")
        parser.add_argument("--remaining-out", type=str, default="scripts/pub_remaining.json",
                            help="Where to dump not-yet-filled pubs on ban/limit (for Apify).")
        parser.add_argument("--throttle", type=float, default=1.5,
                            help="Firmy.cz min interval between requests, seconds (default 1.5).")
        parser.add_argument("--daily-cap", type=int, default=100_000,
                            help="Firmy.cz request cap for this run (default 100000; overrides the 2000 prod rail).")
        parser.add_argument("--ban-threshold", type=int, default=5,
                            help="Consecutive transient/consent-wall failures before aborting to Apify (default 5).")
        parser.add_argument("--limit", type=int, default=0,
                            help="Max pubs to FILL this run (0 = all).")
        parser.add_argument("--ttl-days", type=int, default=None,
                            help="Resume freshness window (default settings.HOURS_TTL_DAYS).")
        parser.add_argument("--dry-run", action="store_true", default=False,
                            help="Scrape but write nothing to the DB.")

    # ------------------------------------------------------------------

    def handle(self, *args, **options) -> None:
        bbox = self._resolve_bbox(options)
        cell_km: float = options["cell_km"]
        catalogue_path = Path(options["catalogue"])
        remaining_path = Path(options["remaining_out"])
        throttle: float = options["throttle"]
        daily_cap: int = options["daily_cap"]
        ban_threshold: int = options["ban_threshold"]
        limit: int = options["limit"]
        ttl_days: int = options["ttl_days"] or int(getattr(settings, "HOURS_TTL_DAYS", 30))
        dry_run: bool = options["dry_run"]

        if dry_run:
            self.stdout.write(self.style.WARNING("[dry-run] No database writes will occur."))

        # --- Phase 1: catalogue -------------------------------------------
        mapy_cap: int = options["mapy_cap"] or int(getattr(settings, "MAPY_DAILY_CAP", 5000))
        catalogue = self._load_or_build_catalogue(
            catalogue_path, bbox, cell_km, mapy_cap=mapy_cap,
            rebuild=options["rebuild_catalogue"],
        )
        self.stdout.write(self.style.SUCCESS(f"Catalogue: {len(catalogue)} unique pubs."))

        # --- Phase 2: fill -------------------------------------------------
        self._fill(
            catalogue=catalogue,
            ttl_days=ttl_days,
            throttle=throttle,
            daily_cap=daily_cap,
            ban_threshold=ban_threshold,
            limit=limit,
            remaining_path=remaining_path,
            dry_run=dry_run,
        )

    # ------------------------------------------------------------------
    # bbox resolution
    # ------------------------------------------------------------------

    def _resolve_bbox(self, options) -> tuple[float, float, float, float]:
        if options["bbox"]:
            try:
                lon_min, lat_min, lon_max, lat_max = (float(x) for x in options["bbox"].split(","))
            except ValueError as exc:
                raise CommandError(f"--bbox must be 'lonMin,latMin,lonMax,latMax': {exc}") from exc
            return (lon_min, lat_min, lon_max, lat_max)

        if options["center"]:
            try:
                lat, lng = (float(x) for x in options["center"].split(","))
            except ValueError as exc:
                raise CommandError(f"--center must be 'lat,lng': {exc}") from exc
        else:
            lat, lng = _DEFAULT_CENTER
        return _bbox_from_center(lat, lng, options["radius_km"])

    # ------------------------------------------------------------------
    # Phase 1: catalogue (Mapy grid sweep, cached to disk)
    # ------------------------------------------------------------------

    def _load_or_build_catalogue(
        self, path: Path, bbox: tuple[float, float, float, float], cell_km: float,
        *, mapy_cap: int, rebuild: bool,
    ) -> list[dict]:
        if path.exists() and not rebuild:
            self.stdout.write(f"Loading cached catalogue from {path}")
            return json.loads(path.read_text())

        api_key = getattr(settings, "MAPY_API_KEY", "")
        if not api_key:
            raise CommandError("MAPY_API_KEY is not set — cannot build the catalogue.")

        centers = _grid_centers(bbox, cell_km)
        self.stdout.write(
            f"Sweeping {len(centers)} Mapy cell(s) (~{cell_km} km) over bbox {bbox} …"
        )

        by_key: dict[str, dict] = {}
        with MapySuggestSource(api_key=api_key, daily_cap=mapy_cap) as mapy:
            for i, (lat, lng) in enumerate(centers, 1):
                try:
                    result = mapy.search_near(lat, lng, cell_km)
                except MapyDailyCapExceededError:
                    self.stdout.write(self.style.WARNING(
                        f"Mapy daily cap hit after {i - 1} cells — saving partial catalogue."
                    ))
                    break
                except MapyAllQueriesFailedError:
                    logger.warning("mapy: all queries failed for cell (%s,%s) — skipping", lat, lng)
                    continue
                for item in result.items:
                    pos = item["position"]
                    plat, plng = pos["lat"], pos["lon"]
                    key = geohash8(plat, plng)
                    if key not in by_key:
                        by_key[key] = {
                            "name": item["name"],
                            "lat": plat,
                            "lng": plng,
                            "city": _municipality(item),
                        }
                if i % 10 == 0:
                    self.stdout.write(f"  swept {i}/{len(centers)} cells, {len(by_key)} unique pubs…")

        catalogue = list(by_key.values())
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(catalogue, ensure_ascii=False, indent=2))
        self.stdout.write(f"Wrote catalogue ({len(catalogue)} pubs) → {path}")
        return catalogue

    # ------------------------------------------------------------------
    # Phase 2: fill (firmy.cz, no proxy, throttled, resumable, ban-aware)
    # ------------------------------------------------------------------

    def _fresh_keys(self, keys: list[str], ttl_days: int) -> set[str]:
        """Return the subset of *keys* with a fresh ok/unknown PubHours row."""
        cutoff = timezone.now() - timedelta(days=ttl_days)
        return set(
            PubHours.objects.filter(
                cache_key__in=keys,
                status__in=_FRESH_STATUSES,
                fetched_at__gte=cutoff,
            ).values_list("cache_key", flat=True)
        )

    def _fill(
        self,
        catalogue: list[dict],
        ttl_days: int,
        throttle: float,
        daily_cap: int,
        ban_threshold: int,
        limit: int,
        remaining_path: Path,
        dry_run: bool,
    ) -> None:
        # Annotate each pub with its cache_key once.
        for pub in catalogue:
            pub["_key"] = geohash8(pub["lat"], pub["lng"])

        all_keys = [pub["_key"] for pub in catalogue]
        fresh = self._fresh_keys(all_keys, ttl_days)
        todo = [pub for pub in catalogue if pub["_key"] not in fresh]
        self.stdout.write(
            f"Resume: {len(fresh)} already fresh, {len(todo)} to fill "
            f"(throttle {throttle}s, ban-threshold {ban_threshold})."
        )

        # No proxy: this run is expected to come from a residential (home) IP.
        source = FirmyHoursSource(proxy_url=None, min_interval=throttle, daily_cap=daily_cap)

        total = len(todo)
        # Live \r progress bar only on a real terminal (tmux). When piped to a
        # file (nohup) or captured in tests, fall back to a periodic line so the
        # carriage returns don't smear the log.
        show_bar = bool(getattr(self.stdout, "isatty", lambda: False)())

        # A clean bar needs a quiet stream — silence the per-pub INFO spam from
        # the scraper (e.g. "search ... returned HTTP 410") while the bar is live.
        noisy = [
            logging.getLogger("pubs.enrichment.firmy"),
            logging.getLogger("pubs.management.commands.refresh_hours"),
        ]
        saved_levels = [lg.level for lg in noisy]
        if show_bar:
            for lg in noisy:
                lg.setLevel(logging.WARNING)

        filled = matched = unmatched = 0
        consecutive_transient = 0
        aborted = False
        t0 = time.monotonic()

        try:
            for idx, pub in enumerate(todo):
                if limit > 0 and filled >= limit:
                    self._close_bar(show_bar)
                    self.stdout.write(self.style.WARNING(f"Reached --limit {limit}."))
                    self._dump_remaining(todo[idx:], remaining_path)
                    aborted = True
                    break

                name, lat, lng, city = pub["name"], pub["lat"], pub["lng"], pub.get("city")
                try:
                    result = source.fetch(name, lat, lng, city=city)
                except TransientFetchError as exc:
                    consecutive_transient += 1
                    logger.warning("bulk: transient (%d/%d) on %r: %s",
                                   consecutive_transient, ban_threshold, name, exc)
                    if consecutive_transient >= ban_threshold:
                        self._close_bar(show_bar)
                        self.stdout.write(self.style.ERROR(
                            f"{consecutive_transient} consecutive consent-wall/transient failures "
                            f"— firmy.cz has likely flagged this IP. Aborting."
                        ))
                        self._dump_remaining(todo[idx:], remaining_path)
                        aborted = True
                        break
                    self._render(show_bar, idx + 1, total, matched, unmatched, t0)
                    continue
                except RuntimeError as exc:
                    self._close_bar(show_bar)
                    self.stdout.write(self.style.WARNING(f"Daily cap reached: {exc}"))
                    self._dump_remaining(todo[idx:], remaining_path)
                    aborted = True
                    break

                # A completed request (hit or clean no-match) clears the ban streak.
                consecutive_transient = 0
                _persist_result(pub["_key"], name, lat, lng, result, dry_run)
                filled += 1
                if result is not None:
                    matched += 1
                else:
                    unmatched += 1

                self._render(show_bar, idx + 1, total, matched, unmatched, t0)
        finally:
            self._close_bar(show_bar)
            for lg, lvl in zip(noisy, saved_levels):
                lg.setLevel(lvl)
            if source._owns_session:
                source._session.close()

        dt = time.monotonic() - t0
        self.stdout.write("\n== SUMMARY ==")
        self.stdout.write(f"filled this run : {filled} ({dt:.0f}s)")
        self.stdout.write(f"  matched       : {matched}")
        self.stdout.write(f"  no-match      : {unmatched}")
        if aborted:
            self.stdout.write(self.style.WARNING(
                f"Aborted early — remaining pubs written to {remaining_path}. "
                f"Feed it into the Apify firmy.cz actor to finish in the cloud."
            ))
        else:
            self.stdout.write(self.style.SUCCESS("Catalogue fully filled."))

    # ------------------------------------------------------------------
    # Progress rendering
    # ------------------------------------------------------------------

    def _render(
        self, show_bar: bool, done: int, total: int,
        matched: int, unmatched: int, t0: float,
    ) -> None:
        """Update the live bar (tty) or emit a periodic line (piped/file)."""
        frac = done / total if total else 1.0
        elapsed = time.monotonic() - t0
        rate = elapsed / done if done else 0.0
        eta = _fmt_duration(rate * (total - done)) if done else "—"

        if show_bar:
            width = 24
            fill = int(frac * width)
            bar = "█" * fill + "░" * (width - fill)
            self.stdout.write(
                f"\r[{bar}] {done}/{total} ({frac * 100:4.1f}%)  "
                f"✓{matched} ✗{unmatched}  {rate:.1f}s/pub  ETA {eta}",
                ending="",
            )
            self._flush()
        elif done % 25 == 0 or done == total:
            self.stdout.write(
                f"  {done}/{total} ({frac * 100:.0f}%)  "
                f"✓{matched} ✗{unmatched}  {rate:.1f}s/pub  ETA {eta}"
            )

    def _close_bar(self, show_bar: bool) -> None:
        """End the current \\r bar line so following output starts cleanly."""
        if show_bar:
            self.stdout.write("\n", ending="")
            self._flush()

    def _flush(self) -> None:
        try:
            self.stdout.flush()
        except Exception:  # noqa: BLE001 — flushing is best-effort
            pass

    def _dump_remaining(self, remaining: list[dict], path: Path) -> None:
        """Write the not-yet-filled pubs (Apify-ready, without the internal key)."""
        payload = [
            {"name": p["name"], "lat": p["lat"], "lng": p["lng"], "city": p.get("city")}
            for p in remaining
        ]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
        self.stdout.write(f"Wrote {len(payload)} remaining pub(s) → {path}")
