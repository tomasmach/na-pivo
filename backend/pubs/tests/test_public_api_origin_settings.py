import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def run_settings(debug: str, origin: str | None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["DEBUG"] = debug
    env["DJANGO_SETTINGS_MODULE"] = "config.settings"
    if origin is None:
        env.pop("PUBLIC_API_ORIGIN", None)
    else:
        env["PUBLIC_API_ORIGIN"] = origin
    code = (
        "import django; django.setup(); "
        "from django.conf import settings; "
        "print(settings.PUBLIC_API_ORIGIN)"
    )
    return subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def test_missing_origin_debug_true_defaults_to_local():
    result = run_settings("True", None)
    assert result.returncode == 0
    assert result.stdout.strip() == "http://localhost:8012"


def test_missing_origin_debug_false_fails_with_hint():
    result = run_settings("False", None)
    assert result.returncode != 0
    assert "PUBLIC_API_ORIGIN" in result.stdout + result.stderr


def test_valid_origin_https():
    result = run_settings("True", "https://api.example.test/")
    assert result.returncode == 0
    assert result.stdout.strip() == "https://api.example.test"


@pytest.mark.parametrize(
    "origin",
    [
        "ftp://x.test",
        "https:///path",
        "https://u:p@x.test",
        "https://x.test/sub",
        "https://x.test?q=1",
        "https://x.test#frag",
    ],
)
def test_invalid_origin_rejected(origin):
    result = run_settings("True", origin)
    assert result.returncode != 0
    assert "PUBLIC_API_ORIGIN" in result.stdout + result.stderr
