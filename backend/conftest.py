import subprocess
import sys
from pathlib import Path

import pytest
from django.core.cache import cache

LOCALE_DIR = Path(__file__).resolve().parent / "locale"


def _compile_messages_if_stale() -> None:
    """Build the .mo catalogues when they are missing or older than their .po.

    The .mo files are gitignored (the Docker build compiles them), so a fresh
    checkout would otherwise run every English assertion against the Czech
    source string and pass for the wrong reason.
    """

    if not LOCALE_DIR.is_dir():
        return
    stale = False
    for po in LOCALE_DIR.rglob("*.po"):
        mo = po.with_suffix(".mo")
        if not mo.exists() or mo.stat().st_mtime < po.stat().st_mtime:
            stale = True
            break
    if not stale:
        return
    result = subprocess.run(
        [sys.executable, "manage.py", "compilemessages", "--ignore=.venv"],
        cwd=LOCALE_DIR.parent,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        # A broken .po must be loud, but it must not stop the rest of the suite.
        print(f"compilemessages failed:\n{result.stderr}")


_compile_messages_if_stale()


@pytest.fixture(autouse=True)
def _isolate_django_cache_between_tests():
    """Do not let request throttles or cached API rows leak across test cases."""

    cache.clear()
    yield
    cache.clear()
