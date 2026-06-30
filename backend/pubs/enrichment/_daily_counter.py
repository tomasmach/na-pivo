"""
pubs.enrichment._daily_counter — process-wide daily request cap shared by the
enrichment HTTP clients (firmy / mapy / openrouter).

Each client owns its OWN module-level counter instance (so the caps are
independent), but the thread-safe "increment, reset at the UTC calendar-day
boundary, refuse past the cap" logic is identical, so it lives here once.
"""

from __future__ import annotations

import threading
from datetime import UTC, date, datetime


class DailyCounter:
    """Thread-safe counter that resets at the calendar-day boundary (UTC)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._day: date | None = None
        self._count: int = 0

    def increment_and_check(self, cap: int) -> bool:
        """Increment and return True if the cap is NOT exceeded (request allowed)."""
        with self._lock:
            today = datetime.now(tz=UTC).date()
            if self._day != today:
                self._day = today
                self._count = 0
            if self._count >= cap:
                return False
            self._count += 1
            return True

    def current(self) -> int:
        with self._lock:
            return self._count
