from __future__ import annotations

import json
import uuid
from dataclasses import dataclass

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from pubs.enrichment import geohash8, names_match
from pubs.models import PubReport, UserAddedPub

_NAMESPACE = uuid.UUID("1aa7d6cc-71f7-48e0-8c35-e0c13f6cf1bb")


@dataclass(frozen=True)
class MissingPubFix:
    issue: str
    name: str
    lat: float
    lng: float
    city: str
    address: str
    source_url: str
    source_note: str
    deactivate_reports: bool = False

    @property
    def cache_key(self) -> str:
        return geohash8(self.lat, self.lng)

    @property
    def client_id(self) -> uuid.UUID:
        return uuid.uuid5(_NAMESPACE, f"{self.issue}:{self.name}:{self.cache_key}")


FIXES: tuple[MissingPubFix, ...] = (
    MissingPubFix(
        issue="PIV-4",
        name="Hospůdka U Náhonu",
        lat=50.73908,
        lng=15.10227,
        city="Liberec",
        address="Za Kinem 1717, Liberec XXX-Vratislavice nad Nisou",
        source_url=(
            "https://www.firmy.cz/detail/13362202-hospudka-u-nahonu-liberec-xxx-"
            "vratislavice-nad-nisou.html"
        ),
        source_note="Firmy.cz/Mapy list this as Hospůdka U Náhonu at Za Kinem 1717.",
        deactivate_reports=True,
    ),
    MissingPubFix(
        issue="PIV-8/PIV-12",
        name="Switch Bar&Café",
        lat=50.7676753,
        lng=15.054216,
        city="Liberec",
        address="Barvířská 31/8, 460 07 Liberec-Jeřáb",
        source_url="https://restaurantguru.com/Switch-BarandCafe-Liberec",
        source_note="Public listing confirms the name and address; embedded map link provided coordinates.",
    ),
    MissingPubFix(
        issue="PIV-9",
        name="Restaurace Drápal",
        lat=49.59164,
        lng=17.24953,
        city="Olomouc",
        address="Havlíčkova 637/1, Olomouc",
        source_url="https://www.firmy.cz/detail/13353564-restaurace-drapal-olomouc.html",
        source_note="Firmy.cz and Mapy geocode confirmed the restaurant listing.",
    ),
    MissingPubFix(
        issue="PIV-9",
        name="Radegastovna U Fleka",
        lat=49.59497,
        lng=17.24165,
        city="Olomouc",
        address="Palackého 132/25, Olomouc - Nová Ulice",
        source_url="https://www.firmy.cz/detail/13353553-radegastovna-u-fleka-olomouc-nova-ulice.html",
        source_note="Firmy.cz and Mapy geocode confirmed the restaurant listing.",
    ),
    MissingPubFix(
        issue="PIV-16",
        name="Herba Cafe",
        lat=50.08345,
        lng=14.45030,
        city="Praha",
        address="Bořivojova 768/70, Praha 3 - Žižkov",
        source_url="https://en.firmy.cz/company/13117331-herba-cafe-praha-zizkov.html",
        source_note="Identified as the venue opposite Woodoo music pub; Firmy.cz/Mapy classify it as café/bar.",
    ),
    MissingPubFix(
        issue="PIV-71",
        name="Kurnik Šopa Hospoda",
        lat=49.8388742,
        lng=18.1629726,
        city="Ostrava-Poruba",
        address="Pavlouskova 4457/24, 708 00 Ostrava-Poruba",
        source_url="https://www.kurniksopahospoda.cz/",
        source_note=(
            "The venue's official website and current Firmy.cz listing confirm "
            "the Poruba pub, address, and map position."
        ),
    ),
)


class Command(BaseCommand):
    help = (
        "Apply audited missing-pub production data fixes for PIV-4/PIV-8/PIV-9/"
        "PIV-12/PIV-16/PIV-71. Defaults to dry-run; pass --apply to write."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Write changes. Without this flag the command only reports the plan.",
        )
        parser.add_argument(
            "--issue",
            action="append",
            default=[],
            help=(
                "Limit to an issue id, e.g. PIV-9. Can be repeated. "
                "PIV-8 and PIV-12 both match the Switch record."
            ),
        )

    def handle(self, *args, **options):
        apply = bool(options["apply"])
        issue_filters = {value.upper() for value in options["issue"]}
        fixes = [fix for fix in FIXES if self._matches_issue(fix, issue_filters)]
        if not fixes:
            raise CommandError("No fixes matched the requested --issue filter.")

        summaries = []
        with transaction.atomic():
            for fix in fixes:
                summaries.append(self._handle_fix(fix, apply=apply))
            if not apply:
                transaction.set_rollback(True)

        self.stdout.write(
            json.dumps(
                {
                    "dry_run": not apply,
                    "records": summaries,
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
        )

    @staticmethod
    def _matches_issue(fix: MissingPubFix, filters: set[str]) -> bool:
        if not filters:
            return True
        fix_issues = {part.strip().upper() for part in fix.issue.split("/")}
        return bool(fix_issues & filters)

    def _handle_fix(self, fix: MissingPubFix, *, apply: bool) -> dict:
        existing = (
            UserAddedPub.objects.filter(cache_key=fix.cache_key, name__iexact=fix.name)
            .order_by("-updated_at")
            .first()
        )

        action = "unchanged"
        if existing is None:
            action = "create"
            if apply:
                existing, _ = UserAddedPub.objects.update_or_create(
                    account=None,
                    client_id=fix.client_id,
                    defaults={
                        "cache_key": fix.cache_key,
                        "name": fix.name,
                        "lat": fix.lat,
                        "lng": fix.lng,
                        "city": fix.city,
                        "address": fix.address,
                        "active": True,
                    },
                )
        else:
            needs_update = (
                not existing.active
                or existing.lat != fix.lat
                or existing.lng != fix.lng
                or existing.city != fix.city
                or existing.address != fix.address
            )
            if needs_update:
                action = "update"
                if apply:
                    existing.lat = fix.lat
                    existing.lng = fix.lng
                    existing.city = fix.city
                    existing.address = fix.address
                    existing.active = True
                    existing.save(
                        update_fields=["lat", "lng", "city", "address", "active", "updated_at"]
                    )

        report_ids = []
        if fix.deactivate_reports:
            reports = PubReport.objects.filter(cache_key=fix.cache_key, active=True)
            report_ids = [
                report.pk
                for report in reports
                if names_match(report.name, fix.name)
            ]
            if apply and report_ids:
                PubReport.objects.filter(pk__in=report_ids).update(active=False)

        return {
            "issue": fix.issue,
            "name": fix.name,
            "cache_key": fix.cache_key,
            "client_id": str(fix.client_id),
            "action": action,
            "active_report_ids_to_deactivate": report_ids,
            "lat": fix.lat,
            "lng": fix.lng,
            "city": fix.city,
            "address": fix.address,
            "source_url": fix.source_url,
            "source_note": fix.source_note,
        }
