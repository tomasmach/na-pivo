from __future__ import annotations

import json
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from pubs.enrichment.pivarova_mapa import ExportProgress


def test_export_requires_source_permission(tmp_path):
    with pytest.raises(CommandError, match="source operator's permission"):
        call_command("export_pivarova_mapa", tmp_path / "out.jsonl")


@patch("pubs.management.commands.export_pivarova_mapa.PivarovaMapaClient")
def test_export_writes_jsonl_and_resume_skips_completed(mock_client, tmp_path):
    output = tmp_path / "nested" / "out.jsonl"
    client = mock_client.return_value
    client.list_slugs.return_value = ["first", "second"]
    client.export.return_value = iter(
        [
            ExportProgress(
                row={"source_slug": "first", "name": "První", "beers": []},
                completed=1,
                total=2,
            ),
            ExportProgress(
                row={"source_slug": "second", "name": "Druhý", "beers": [{"price_czk": 50}]},
                completed=2,
                total=2,
            ),
        ]
    )

    call_command(
        "export_pivarova_mapa",
        output,
        confirm_source_permission=True,
        stdout=StringIO(),
    )

    rows = [json.loads(line) for line in output.read_text().splitlines()]
    assert [row["source_slug"] for row in rows] == ["first", "second"]

    client.export.return_value = iter([])
    call_command(
        "export_pivarova_mapa",
        output,
        confirm_source_permission=True,
        resume=True,
        stdout=StringIO(),
    )
    client.export.assert_called_with([])
