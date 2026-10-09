import json
import os
from dataclasses import asdict
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from pubs.beer_diary_cleanup import revert_diary_cleanup, run_diary_cleanup
from pubs.beer_menu_cleanup import build_canonicalizer, revert_menu_cleanup, run_menu_cleanup


class Command(BaseCommand):
    help = (
        "Unify beer names on pub menus and in drink logs, and merge menu rows "
        "listing one beer twice. Read-only unless --apply. No drink is added or removed."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument("--apply", action="store_true", help="Write the changes.")
        parser.add_argument(
            "--report",
            help=(
                "JSON Lines file: one line per changed menu or account diary (before "
                "and after), written before it is saved, then a summary line. Required "
                "with --apply: it is the backup for --revert."
            ),
        )
        parser.add_argument(
            "--revert",
            metavar="REPORT",
            help="Restore the menus and drinks in a report that nobody changed since.",
        )

    def handle(self, *args, **options) -> None:
        if options["revert"]:
            self._revert(Path(options["revert"]))
            return

        apply = options["apply"]
        report = Path(options["report"]) if options["report"] else None
        if apply and report is None:
            raise CommandError("--apply needs --report so the previous names are kept.")
        if report is not None and report.exists():
            raise CommandError(f"{report} already exists; refusing to overwrite a backup.")

        if report is None:
            menus, diaries = self._run(apply, record=None)
        else:
            report.parent.mkdir(parents=True, exist_ok=True)
            with report.open("x", encoding="utf-8") as backup:

                def record(changes) -> None:
                    for change in changes:
                        backup.write(json.dumps(asdict(change), ensure_ascii=False) + "\n")
                    backup.flush()
                    os.fsync(backup.fileno())

                menus, diaries = self._run(apply, record=record)
                summary = self._summary(menus, diaries, apply)
                backup.write(json.dumps({"summary": summary}, ensure_ascii=False) + "\n")

        summary = self._summary(menus, diaries, apply)
        prefix = "" if apply else "DRY RUN - "
        self.stdout.write(prefix + " ".join(f"{key}={value}" for key, value in summary.items()))

    def _run(self, apply: bool, record):
        canonicalizer = build_canonicalizer()
        menus = run_menu_cleanup(apply=apply, record=record, canonicalizer=canonicalizer)
        diaries = run_diary_cleanup(canonicalizer.name, apply=apply, record=record)
        return menus, diaries

    def _summary(self, plan, diaries, apply: bool) -> dict:
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
            "drink_beers": diaries.beer_rows,
            "drink_names_before": len(diaries.names_before),
            "drink_names_after": len(diaries.names_after),
            "drinks_renamed": diaries.renamed_rows,
            "drinks_linked": diaries.linked_rows,
            "diaries_changed": len(diaries.changes),
            "diaries_kept_for_badge": diaries.accounts_kept_for_badge,
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
        changes.reverse()
        restored, skipped = revert_menu_cleanup(c for c in changes if c["model"] != "drink")
        drinks, drinks_skipped = revert_diary_cleanup(c for c in changes if c["model"] == "drink")
        self.stdout.write(
            f"restored={restored} skipped_changed_since={skipped} "
            f"drinks_restored={drinks} drinks_skipped_changed_since={drinks_skipped}"
        )
