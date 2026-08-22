import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def run_settings(secret_key: str, *, debug: bool = False) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["DJANGO_SETTINGS_MODULE"] = "config.settings"
    env["DEBUG"] = "True" if debug else "False"
    env["SECRET_KEY"] = secret_key
    env["PUBLIC_API_ORIGIN"] = "https://api.example.test"
    env["FIRMY_PROXY_URL"] = "https://proxy.example.test"
    env["APPLE_TEAM_ID"] = "TEST_TEAM"
    env["APPLE_KEY_ID"] = "TEST_KEY"
    env["APPLE_PRIVATE_KEY"] = "TEST_PRIVATE_KEY"
    return subprocess.run(
        [
            sys.executable,
            "-c",
            "import django; django.setup(); print(\"SETTINGS_LOADED\")",
        ],
        cwd=BACKEND_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


@pytest.mark.parametrize(
    "secret_key",
    [
        "",
        "short-secret",
        "django-insecure-" + "Ab3xyZ90" * 6,
        "replace-me-" + "Qr7vN2kP" * 6,
        "A" * 64,
        "abcd1234" * 8,
    ],
)
def test_production_rejects_insecure_secret_key(secret_key: str) -> None:
    result = run_settings(secret_key, debug=False)
    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "SECRET_KEY" in output
    if secret_key:
        assert secret_key not in output


def test_production_accepts_long_diverse_secret_key() -> None:
    result = run_settings(
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        debug=False,
    )
    assert result.returncode == 0
    assert result.stdout.strip() == "SETTINGS_LOADED"


def test_debug_accepts_short_secret_key() -> None:
    result = run_settings("short-secret", debug=True)
    assert result.returncode == 0
    assert result.stdout.strip() == "SETTINGS_LOADED"
