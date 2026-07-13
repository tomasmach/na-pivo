"""Export Pivařova mapa beer prices to resumable JSONL for manual review."""

from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from pubs.enrichment.pivarova_mapa import (
    DEFAULT_BBOX,
    PivarovaMapaClient,
    PivarovaMapaError,
)


def _completed_slugs(path: Path) -> set[str]:
    if not path.exists():
        return set()
    completed: set[str] = set()
    try:
        with path.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                row = json.loads(line)
                slug = str(row.get("source_slug") or "").strip()
                if not slug:
                    raise ValueError(f"line {line_number} has no source_slug")
                completed.add(slug)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise CommandError(f"Cannot resume export: {exc}") from exc
    return completed


class Command(BaseCommand):
    help = "Export public Pivařova mapa beer prices to a reviewed JSONL staging file."

    def add_arguments(self, parser) -> None:
        parser.add_argument("output_file", type=Path)
        parser.add_argument("--bbox", default=DEFAULT_BBOX)
        parser.add_argument("--limit", type=int, default=20)
        parser.add_argument("--all", action="store_true", dest="export_all")
        parser.add_argument("--delay-seconds", type=float, default=1.0)
        parser.add_argument("--resume", action="store_true")
        parser.add_argument(
            "--confirm-source-permission",
            action="store_true",
            help="Confirm that the source operator has permitted this data reuse.",
        )

    def handle(self, *args, **options) -> None:
        if not options["confirm_source_permission"]:
            raise CommandError(
                "Refusing network export without --confirm-source-permission. "
                "Get the source operator's permission before crawling or reusing its database."
            )
        if options["limit"] < 1:
            raise CommandError("--limit must be at least 1")
        if options["delay_seconds"] < 0.5:
            raise CommandError("--delay-seconds must be at least 0.5")

        output_file: Path = options["output_file"]
        if output_file.exists() and not options["resume"]:
            raise CommandError("Output already exists; use --resume or choose a new file")

        completed = _completed_slugs(output_file) if options["resume"] else set()
        client = PivarovaMapaClient(delay_seconds=options["delay_seconds"])
        try:
            slugs = client.list_slugs(bbox=options["bbox"])
            if not options["export_all"]:
                slugs = slugs[: options["limit"]]
            pending = [slug for slug in slugs if slug not in completed]
            output_file.parent.mkdir(parents=True, exist_ok=True)
            with output_file.open("a", encoding="utf-8") as handle:
                for progress in client.export(pending):
                    handle.write(
                        json.dumps(progress.row, ensure_ascii=False, separators=(",", ":")) + "\n"
                    )
                    handle.flush()
                    self.stdout.write(
                        f"Exported {progress.completed}/{progress.total}: "
                        f"{progress.row['source_slug']} ({len(progress.row['beers'])} prices)"
                    )
        except (OSError, PivarovaMapaError) as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            self.style.SUCCESS(
                f"Export complete: added={len(pending)} resumed={len(completed)} file={output_file}"
            )
        )
