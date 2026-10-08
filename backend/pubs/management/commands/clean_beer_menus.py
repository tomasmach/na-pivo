import json
from dataclasses import asdict
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from pubs.beer_menu_cleanup import run_menu_cleanup


class Command(BaseCommand):
    help = (
        "Unify beer names on pub menus and merge rows listing one beer twice. "
        "Read-only unless --apply. Drink logs are never changed."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument("--apply", action="store_true", help="Write the changes.")
        parser.add_argument(
            "--report",
            help=(
                "Write every changed menu (before and after) as JSON. Required with "
                "--apply: the before lists are the backup for a revert."
            ),
        )

    def handle(self, *args, **options) -> None:
        apply = options["apply"]
        report = Path(options["report"]) if options["report"] else None
        if apply and report is None:
            raise CommandError("--apply needs --report so the previous menus are kept.")
        if report is not None and report.exists():
            raise CommandError(f"{report} already exists; refusing to overwrite a backup.")
        if report is not None:
            # Fail before writing anything when the backup cannot be saved.
            report.parent.mkdir(parents=True, exist_ok=True)
            report.write_text("{}")

        plan = run_menu_cleanup(apply=apply)
        summary = {
            "applied": apply,
            "community_rows": plan.community_rows,
            "external_rows": plan.external_rows,
            "changed_menus": len({(change.model, change.pk) for change in plan.changes}),
            "items_before": plan.items_before,
            "items_after": plan.items_after,
            "distinct_names_before": len(plan.names_before),
            "distinct_names_after": len(plan.names_after),
            "renamed_items": sum(len(change.renamed) for change in plan.changes),
            "merged_items": sum(len(change.merged) for change in plan.changes),
            "price_conflicts": sum(len(change.price_conflicts) for change in plan.changes),
            "index_links_created": plan.index_links_created,
            "index_links_reactivated": plan.index_links_reactivated,
            "price_index_updates": plan.price_index_updates,
        }
        if report is not None:
            report.write_text(
                json.dumps(
                    {"summary": summary, "changes": [asdict(change) for change in plan.changes]},
                    ensure_ascii=False,
                    indent=1,
                )
            )
        prefix = "" if apply else "DRY RUN - "
        self.stdout.write(prefix + " ".join(f"{key}={value}" for key, value in summary.items()))
