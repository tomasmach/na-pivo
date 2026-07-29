"""Plan or apply one explicitly reviewed, non-destructive pub merge."""

from __future__ import annotations

import json

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError, CommandParser

from pubs.pub_merge import apply_pub_merge_plan, build_pub_merge_plan


class Command(BaseCommand):
    help = (
        "Merge one reviewed duplicate pub using aliases and soft deactivation. "
        "Dry-run is the default; pass --apply to write."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--source-cache-key", required=True)
        parser.add_argument("--source-name", required=True)
        parser.add_argument("--target-cache-key", required=True)
        parser.add_argument("--target-name", required=True)
        parser.add_argument("--canonical-name")
        parser.add_argument("--canonical-lat", type=float)
        parser.add_argument("--canonical-lng", type=float)
        parser.add_argument("--canonical-city", default="")
        parser.add_argument("--canonical-country", default="")
        parser.add_argument("--canonical-external-id", default="")
        parser.add_argument("--actor", default="")
        parser.add_argument("--reason", default="")
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Persist aliases and deactivate only the reviewed source catalog rows.",
        )

    def handle(self, *args, **options) -> None:
        try:
            plan = build_pub_merge_plan(
                source_cache_key=options["source_cache_key"],
                source_name=options["source_name"],
                target_cache_key=options["target_cache_key"],
                target_name=options["target_name"],
                canonical_name=options["canonical_name"],
                canonical_lat=options["canonical_lat"],
                canonical_lng=options["canonical_lng"],
                canonical_city=options["canonical_city"],
                canonical_country=options["canonical_country"],
                canonical_external_id=options["canonical_external_id"],
            )
            payload = plan.as_dict()
            if options["apply"]:
                audit = apply_pub_merge_plan(
                    plan,
                    actor=options["actor"],
                    reason=options["reason"],
                )
                payload["mode"] = "applied"
                payload["audit_id"] = audit.pk
                payload["canonical_pub_id"] = str(audit.canonical_pub.public_id)
        except ValidationError as exc:
            raise CommandError("; ".join(exc.messages)) from exc

        self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))

