from pathlib import Path

from django.core.checks import Tags, run_checks
from django.test import override_settings


def _security_check_errors(settings) -> list:
    return [
        error
        for error in run_checks(tags=[Tags.security], include_deployment_checks=True)
        if error.id and error.id.startswith("pubs.E")
    ]


def test_deploy_check_rejects_an_unsafe_pub_report_threshold(settings):
    settings.PUB_REPORT_GLOBAL_HIDE_THRESHOLD = 1

    errors = _security_check_errors(settings)

    assert any(error.id == "pubs.E001" for error in errors)


def test_deploy_check_accepts_the_three_account_quorum(settings):
    settings.PUB_REPORT_GLOBAL_HIDE_THRESHOLD = 3

    errors = _security_check_errors(settings)

    assert all(error.id != "pubs.E001" for error in errors)


def test_deploy_check_survives_a_malformed_threshold(settings):
    """A garbage env value must yield a deterministic deploy Error, not a crash."""

    settings.PUB_REPORT_GLOBAL_HIDE_THRESHOLD = "three"

    errors = _security_check_errors(settings)

    assert any(error.id == "pubs.E002" for error in errors)
    assert all("Traceback" not in str(error) for error in errors)


def test_deploy_check_survives_a_none_threshold(settings):
    settings.PUB_REPORT_GLOBAL_HIDE_THRESHOLD = None

    errors = _security_check_errors(settings)

    assert any(error.id == "pubs.E002" for error in errors)


def _fingerprint_check_errors(settings) -> list:
    wanted = {"pubs.E003", "pubs.E004"}
    return [
        error
        for error in _security_check_errors(settings)
        if error.id in wanted
    ]


def test_fingerprint_check_passes_in_debug_without_configuration(settings):
    settings.DEBUG = True
    settings.ANDROID_APP_LINK_CERT_FINGERPRINTS = ""

    assert _fingerprint_check_errors(settings) == []


def test_fingerprint_check_requires_configuration_in_production(settings):
    settings.DEBUG = False
    settings.ANDROID_APP_LINK_CERT_FINGERPRINTS = ""

    errors = _fingerprint_check_errors(settings)

    assert [error.id for error in errors] == ["pubs.E004"]


def test_fingerprint_check_rejects_malformed_values_in_production(settings):
    settings.DEBUG = False
    settings.ANDROID_APP_LINK_CERT_FINGERPRINTS = "not-a-fingerprint, AABB"

    errors = _fingerprint_check_errors(settings)

    assert [error.id for error in errors] == ["pubs.E003"]


def test_fingerprint_check_accepts_valid_colon_separated_values(settings):
    settings.DEBUG = False
    settings.ANDROID_APP_LINK_CERT_FINGERPRINTS = ":".join(["AA"] * 32)

    assert _fingerprint_check_errors(settings) == []


def test_fingerprint_check_accepts_two_valid_comma_separated_fingerprints(settings):
    """One colon-separated + one plain entry: preview/internal builds stay supported."""

    settings.DEBUG = False
    colon_separated = ":".join(["AB"] * 32)
    plain = "CD" * 32
    settings.ANDROID_APP_LINK_CERT_FINGERPRINTS = f"{colon_separated}, {plain}"

    assert _fingerprint_check_errors(settings) == []


_PLAY_SOURCE_PHRASES = (
    "Google Play Console",
    "App integrity",
    "App signing key certificate",
    "SHA-256",
)


def test_missing_fingerprint_hint_points_to_play_app_signing(settings):
    settings.DEBUG = False
    settings.ANDROID_APP_LINK_CERT_FINGERPRINTS = ""

    error = _fingerprint_check_errors(settings)[0]

    assert error.id == "pubs.E004"
    joined = f"{error.msg} {error.hint}"
    for phrase in _PLAY_SOURCE_PHRASES:
        assert phrase in joined, f"hint is missing {phrase!r}"
    assert "EAS" not in joined
    assert "keytool" not in joined


def test_malformed_fingerprint_hint_points_to_play_app_signing(settings):
    settings.DEBUG = False
    settings.ANDROID_APP_LINK_CERT_FINGERPRINTS = "not-a-fingerprint"

    error = _fingerprint_check_errors(settings)[0]

    assert error.id == "pubs.E003"
    joined = f"{error.msg} {error.hint}"
    for phrase in _PLAY_SOURCE_PHRASES:
        assert phrase in joined, f"hint is missing {phrase!r}"
    assert "EAS" not in joined
    assert "keytool" not in joined

# ---------------------------------------------------------------------------
# Container startup contract
# ---------------------------------------------------------------------------


def test_container_entrypoint_checks_production_config_before_migrating():
    entrypoint = (_BACKEND_DIR / "docker-entrypoint.sh").read_text(encoding="utf-8")

    deploy_check = "python manage.py check --deploy"
    migrate = "python manage.py migrate --no-input"
    assert deploy_check in entrypoint
    assert entrypoint.index(deploy_check) < entrypoint.index(migrate)


# ---------------------------------------------------------------------------
# Docs copy contract — operator docs must name Play App Signing as the source
# ---------------------------------------------------------------------------

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_FINGERPRINT_DOCS_FILES = (
    ".env.example",
    ".env.production.example",
    "README.md",
)


def _fingerprint_doc_section(filename: str) -> str:
    lines = (_BACKEND_DIR / filename).read_text(encoding="utf-8").splitlines()
    hits = [
        i for i, line in enumerate(lines)
        if "ANDROID_APP_LINK_CERT_FINGERPRINTS" in line
    ]
    assert hits, f"{filename} never names ANDROID_APP_LINK_CERT_FINGERPRINTS"
    center = hits[0]
    return "\n".join(lines[max(0, center - 8):center + 9])


def test_fingerprint_docs_name_play_console_as_production_source():
    for filename in _FINGERPRINT_DOCS_FILES:
        section = _fingerprint_doc_section(filename)
        for phrase in ("Google Play Console", "App integrity",
                       "App signing key certificate"):
            assert phrase in section, (
                f"{filename} does not name the production source ({phrase!r}) "
                "near ANDROID_APP_LINK_CERT_FINGERPRINTS"
            )


def test_fingerprint_docs_warn_eas_and_keytool_are_not_production_source():
    for filename in _FINGERPRINT_DOCS_FILES:
        section = _fingerprint_doc_section(filename).lower()
        assert "eas" in section and "keytool" in section, (
            f"{filename} does not mention EAS/keytool near "
            "ANDROID_APP_LINK_CERT_FINGERPRINTS"
        )
        assert any(
            marker in section
            for marker in ("may differ", "can differ", "not the production source")
        ), f"{filename} does not warn EAS/local keytool may differ from production"


# ---------------------------------------------------------------------------
# Linear deploy security check (contract tests — check does not exist yet)
# ---------------------------------------------------------------------------

_LINEAR_CHECK_IDS = {"pubs.E005", "pubs.E006"}


def _linear_check_errors() -> list:
    from pubs.checks import check_linear_feedback_sync_config

    return [
        error
        for error in check_linear_feedback_sync_config()
        if error.id in _LINEAR_CHECK_IDS
    ]


@override_settings(
    DEBUG=False,
    LINEAR_API_KEY="",
    LINEAR_TEAM_ID="",
)
def test_linear_check_allows_fully_unconfigured_sync():
    """No key + no team = Linear feedback sync is off, not a deploy error."""

    assert _linear_check_errors() == []


@override_settings(
    DEBUG=False,
    LINEAR_API_KEY="lin_api_test_key",
    LINEAR_TEAM_ID="",
)
def test_linear_check_flags_key_without_team_as_incomplete():
    errors = _linear_check_errors()

    assert [error.id for error in errors] == ["pubs.E005"]
    assert "incomplete" in errors[0].msg.lower()


@override_settings(
    DEBUG=False,
    LINEAR_API_KEY="",
    LINEAR_TEAM_ID="team-123",
)
def test_linear_check_flags_team_without_key_as_incomplete():
    errors = _linear_check_errors()

    assert [error.id for error in errors] == ["pubs.E005"]


@override_settings(
    DEBUG=False,
    LINEAR_API_KEY="lin_api_test_key",
    LINEAR_TEAM_ID="team-123",
    LINEAR_FEEDBACK_DELETE_ADMIN_CONFIRMED="false",
)
def test_linear_check_requires_admin_confirmation_for_account_purge():
    """issueDelete is permanent; deploys need explicit admin-capable confirmation."""

    errors = _linear_check_errors()

    assert [error.id for error in errors] == ["pubs.E006"]
    joined = f"{errors[0].msg} {errors[0].hint}"
    assert "purge" in joined.lower()
    assert "lin_api_test_key" not in joined
    assert "team-123" not in joined


@override_settings(
    DEBUG=False,
    LINEAR_API_KEY="lin_api_test_key",
    LINEAR_TEAM_ID="team-123",
)
def test_linear_check_flags_missing_admin_confirmation():
    errors = _linear_check_errors()

    assert [error.id for error in errors] == ["pubs.E006"]


@override_settings(
    DEBUG=False,
    LINEAR_API_KEY="lin_api_test_key",
    LINEAR_TEAM_ID="team-123",
    LINEAR_FEEDBACK_DELETE_ADMIN_CONFIRMED="true",
)
def test_linear_check_passes_when_fully_configured_and_confirmed():
    assert _linear_check_errors() == []


@override_settings(
    DEBUG=True,
    LINEAR_API_KEY="lin_api_test_key",
    LINEAR_TEAM_ID="",
)
def test_linear_check_is_production_safe_regardless_of_debug():
    """Direct contract must not be skipped merely because DEBUG is true."""

    assert [error.id for error in _linear_check_errors()] == ["pubs.E005"]
