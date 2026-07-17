"""Shared XP ladder normalization and progress math."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class Ladder:
    """A fixed-title XP ladder with defensively normalized thresholds."""

    titles: tuple[str, ...]
    thresholds: tuple[int, ...]

    def __init__(self, titles: tuple[str, ...], thresholds: Sequence[int]) -> None:
        raw = list(thresholds)
        if not raw:
            raw = [0]
        raw = raw[: len(titles)]

        normalized: list[int] = []
        previous = 0
        for index, value in enumerate(raw):
            threshold = max(0, int(value))
            if index == 0:
                threshold = 0
            threshold = max(threshold, previous)
            normalized.append(threshold)
            previous = threshold

        object.__setattr__(self, "titles", titles)
        object.__setattr__(self, "thresholds", tuple(normalized))

    def levels(self) -> list[dict]:
        """Return the full wire ladder as ``{level, title, xp}`` rows."""
        return [
            {"level": index + 1, "title": self.titles[index], "xp": threshold}
            for index, threshold in enumerate(self.thresholds)
        ]

    def progress(self, xp: int) -> dict:
        """Derive level, title and within-level progress from durable XP."""
        xp = max(0, int(xp))
        level_index = 0
        for index, threshold in enumerate(self.thresholds):
            if xp >= threshold:
                level_index = index
            else:
                break

        current_threshold = self.thresholds[level_index]
        next_level = level_index + 1
        return {
            "level": level_index + 1,
            "title": self.titles[level_index],
            "xp_into_level": xp - current_threshold,
            "xp_for_next_level": (
                self.thresholds[next_level] - current_threshold
                if next_level < len(self.thresholds)
                else None
            ),
        }

    def snapshot(self, xp: int) -> dict:
        """Return the compact wire envelope derived from stored XP."""
        normalized_xp = max(0, int(xp))
        progress = self.progress(normalized_xp)
        return {
            "xp": normalized_xp,
            "level": progress["level"],
            "title": progress["title"],
            "xp_into_level": progress["xp_into_level"],
            "xp_for_next_level": progress["xp_for_next_level"],
        }
