from __future__ import annotations

from pubs.pivar import pivar_levels, pivar_progress, pivar_snapshot


def test_pivar_default_ladder_and_progress(settings):
    settings.PIVAR_LEVEL_THRESHOLDS = [0, 150, 500, 1500, 4000, 9000, 18000]

    assert pivar_levels() == [
        {"level": 1, "title": "Zelenáč", "xp": 0},
        {"level": 2, "title": "Ochutnávač", "xp": 150},
        {"level": 3, "title": "Pivní tovaryš", "xp": 500},
        {"level": 4, "title": "Výčepní", "xp": 1500},
        {"level": 5, "title": "Sládek", "xp": 4000},
        {"level": 6, "title": "Pivní mistr", "xp": 9000},
        {"level": 7, "title": "Pivní legenda", "xp": 18000},
    ]
    assert pivar_progress(149) == {
        "level": 1,
        "title": "Zelenáč",
        "xp_into_level": 149,
        "xp_for_next_level": 150,
    }
    assert pivar_progress(500) == {
        "level": 3,
        "title": "Pivní tovaryš",
        "xp_into_level": 0,
        "xp_for_next_level": 1000,
    }


def test_pivar_threshold_normalisation_and_max_level(settings):
    settings.PIVAR_LEVEL_THRESHOLDS = [99, 300, -5, 250, 900, 1000, 1100, 9999]

    assert [row["xp"] for row in pivar_levels()] == [0, 300, 300, 300, 900, 1000, 1100]
    assert pivar_snapshot(2500) == {
        "xp": 2500,
        "level": 7,
        "title": "Pivní legenda",
        "xp_into_level": 1400,
        "xp_for_next_level": None,
    }
