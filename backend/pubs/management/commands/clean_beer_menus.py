import json
import os
from dataclasses import asdict
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from pubs.beer_menu_cleanup import revert_menu_cleanup, run_menu_cleanup


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
                "JSON Lines file: one line per changed menu (before and after), written "
                "before that menu is saved, then a summary line. Required with --apply: "
                "it is the backup for --revert."
            ),
        )
        parser.add_argument(
            "--revert",
            metavar="REPORT",
            help="Restore the menus listed in a report that the cleanup left untouched since.",
        )

    def handle(self, *args, **options) -> None:
        if options["revert"]:
            self._revert(Path(options["revert"]))
            return

        apply = options["apply"]
        report = Path(options["report"]) if options["report"] else None
        if apply and report is None:
            raise CommandError("--apply needs --report so the previous menus are kept.")
        if report is not None and report.exists():
            raise CommandError(f"{report} already exists; refusing to overwrite a backup.")

        if report is None:
            plan = run_menu_cleanup(apply=apply)
        else:
            report.parent.mkdir(parents=True, exist_ok=True)
            with report.open("x", encoding="utf-8") as backup:

                def record(changes) -> None:
                    for change in changes:
                        backup.write(json.dumps(asdict(change), ensure_ascii=False) + "\n")
                    backup.flush()
                    os.fsync(backup.fileno())

                plan = run_menu_cleanup(apply=apply, record=record)
                summary = self._summary(plan, apply)
                backup.write(json.dumps({"summary": summary}, ensure_ascii=False) + "\n")

        summary = self._summary(plan, apply)
        prefix = "" if apply else "DRY RUN - "
        self.stdout.write(prefix + " ".join(f"{key}={value}" for key, value in summary.items()))

    def _summary(self, plan, apply: bool) -> dict:
        return {
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

    def _revert(self, report: Path) -> None:
        if not report.exists():
            raise CommandError(f"{report} does not exist.")
        with report.open(encoding="utf-8") as lines:
            changes = [
                line for line in (json.loads(raw) for raw in lines if raw.strip())
                if "summary" not in line
            ]
        # Newest first, so a menu changed twice ends at its oldest state.
        restored, skipped = revert_menu_cleanup(reversed(changes))
        self.stdout.write(f"restored={restored} skipped_changed_since={skipped}")
