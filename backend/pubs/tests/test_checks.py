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


# ---------------------------------------------------------------------------
# OpenAI moderation deploy security check
# ---------------------------------------------------------------------------

_MODERATION_CHECK_IDS = {"pubs.E007", "pubs.E008", "pubs.E009"}
_MODERATION_SECRET_SENTINEL = "sk-sentinel-do-not-leak-123"


def _moderation_check_errors() -> list:
    from pubs.checks import check_openai_moderation_config

    return [
        error
        for error in check_openai_moderation_config()
        if error.id in _MODERATION_CHECK_IDS
    ]


def test_moderation_check_requires_api_key_in_production():
    for bad_key in (None, "", "   ", "\t\n"):
        with override_settings(
            DEBUG=False,
            OPENAI_MODERATION_API_KEY=bad_key,
            OPENAI_MODERATION_MODEL="omni-moderation-latest",
            OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS=10,
            OPENAI_MODERATION_READ_TIMEOUT_SECONDS=30,
        ):
            errors = _moderation_check_errors()

        assert [error.id for error in errors] == ["pubs.E007"]


def test_moderation_check_allows_missing_api_key_in_debug():
    with override_settings(
        DEBUG=True,
        OPENAI_MODERATION_API_KEY=None,
        OPENAI_MODERATION_MODEL="omni-moderation-latest",
        OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS=10,
        OPENAI_MODERATION_READ_TIMEOUT_SECONDS=30,
    ):
        assert _moderation_check_errors() == []


def test_moderation_check_never_echoes_the_secret():
    with override_settings(
        DEBUG=False,
        OPENAI_MODERATION_API_KEY=_MODERATION_SECRET_SENTINEL,
        OPENAI_MODERATION_MODEL="bogus-model",
        OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS=0,
        OPENAI_MODERATION_READ_TIMEOUT_SECONDS=0,
    ):
        errors = _moderation_check_errors()

    assert errors
    for error in errors:
        joined = f"{error.msg} {error.hint}"
        assert _MODERATION_SECRET_SENTINEL not in joined


def test_moderation_check_rejects_wrong_model_in_production():
    for bad_model in (
        None,
        "",
        "   ",
        "OMNI-MODERATION-LATEST",
        "Omni-Moderation-Latest",
        "text-moderation-latest",
        "omni-moderation-latest ",
    ):
        with override_settings(
            DEBUG=False,
            OPENAI_MODERATION_API_KEY="sk-test",
            OPENAI_MODERATION_MODEL=bad_model,
            OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS=10,
            OPENAI_MODERATION_READ_TIMEOUT_SECONDS=30,
        ):
            errors = _moderation_check_errors()

        assert [error.id for error in errors] == ["pubs.E008"], repr(bad_model)


def test_moderation_check_accepts_exact_model():
    with override_settings(
        DEBUG=False,
        OPENAI_MODERATION_API_KEY="sk-test",
        OPENAI_MODERATION_MODEL="omni-moderation-latest",
        OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS=10,
        OPENAI_MODERATION_READ_TIMEOUT_SECONDS=30,
    ):
        assert _moderation_check_errors() == []


_BAD_TIMEOUT_VALUES = (
    "soon",
    "",
    None,
    float("nan"),
    float("inf"),
    float("-inf"),
    True,
    False,
    0,
    0.0,
    -1,
    -2.5,
)

_BAD_CONNECT_TIMEOUT_VALUES = _BAD_TIMEOUT_VALUES + (10.5, 11)
_BAD_READ_TIMEOUT_VALUES = _BAD_TIMEOUT_VALUES + (30.5, 31)

_GOOD_TIMEOUT_VALUES = (1, 2.5, "3", "4.5")
_GOOD_CONNECT_TIMEOUT_VALUES = _GOOD_TIMEOUT_VALUES + (10, "9.5")
_GOOD_READ_TIMEOUT_VALUES = _GOOD_TIMEOUT_VALUES + (30, "29.5")


def test_moderation_check_rejects_bad_connect_timeout_without_crashing():
    for bad_value in _BAD_CONNECT_TIMEOUT_VALUES:
        with override_settings(
            DEBUG=False,
            OPENAI_MODERATION_API_KEY="sk-test",
            OPENAI_MODERATION_MODEL="omni-moderation-latest",
            OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS=bad_value,
            OPENAI_MODERATION_READ_TIMEOUT_SECONDS=30,
        ):
            errors = _moderation_check_errors()

        assert [error.id for error in errors] == ["pubs.E009"], repr(bad_value)
        assert all(
            "Traceback" not in f"{error.msg} {error.hint}" for error in errors
        )


def test_moderation_check_rejects_bad_read_timeout_without_crashing():
    for bad_value in _BAD_READ_TIMEOUT_VALUES:
        with override_settings(
            DEBUG=False,
            OPENAI_MODERATION_API_KEY="sk-test",
            OPENAI_MODERATION_MODEL="omni-moderation-latest",
            OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS=10,
            OPENAI_MODERATION_READ_TIMEOUT_SECONDS=bad_value,
        ):
            errors = _moderation_check_errors()

        assert [error.id for error in errors] == ["pubs.E009"], repr(bad_value)
        assert all(
            "Traceback" not in f"{error.msg} {error.hint}" for error in errors
        )


def test_moderation_check_accepts_positive_numeric_timeouts():
    for good_value in _GOOD_CONNECT_TIMEOUT_VALUES:
        with override_settings(
            DEBUG=False,
            OPENAI_MODERATION_API_KEY="sk-test",
            OPENAI_MODERATION_MODEL="omni-moderation-latest",
            OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS=good_value,
            OPENAI_MODERATION_READ_TIMEOUT_SECONDS=30,
        ):
            assert _moderation_check_errors() == [], repr(good_value)
    for good_value in _GOOD_READ_TIMEOUT_VALUES:
        with override_settings(
            DEBUG=False,
            OPENAI_MODERATION_API_KEY="sk-test",
            OPENAI_MODERATION_MODEL="omni-moderation-latest",
            OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS=10,
            OPENAI_MODERATION_READ_TIMEOUT_SECONDS=good_value,
        ):
            assert _moderation_check_errors() == [], repr(good_value)


def test_moderation_check_enforces_the_same_maxima_as_runtime():
    from pubs import checks as pubs_checks
    from pubs.moderation import (
        MAX_MODERATION_CONNECT_TIMEOUT_SECONDS,
        MAX_MODERATION_READ_TIMEOUT_SECONDS,
    )

    assert pubs_checks.MAX_MODERATION_CONNECT_TIMEOUT_SECONDS == (
        MAX_MODERATION_CONNECT_TIMEOUT_SECONDS
    )
    assert pubs_checks.MAX_MODERATION_READ_TIMEOUT_SECONDS == (
        MAX_MODERATION_READ_TIMEOUT_SECONDS
    )


@override_settings(
    DEBUG=False,
    OPENAI_MODERATION_API_KEY="sk-test",
    OPENAI_MODERATION_MODEL="omni-moderation-latest",
    OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS=10,
    OPENAI_MODERATION_READ_TIMEOUT_SECONDS=30,
)
def test_moderation_check_passes_with_valid_production_configuration():
    assert _moderation_check_errors() == []


# ---------------------------------------------------------------------------
# Docs copy contract — operator docs must name all four moderation variables
# and carry the server-only / production-required story
# ---------------------------------------------------------------------------

_MODERATION_VARIABLES = (
    "OPENAI_MODERATION_API_KEY",
    "OPENAI_MODERATION_MODEL",
    "OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS",
    "OPENAI_MODERATION_READ_TIMEOUT_SECONDS",
)


def _moderation_doc_section(filename: str) -> str:
    lines = (_BACKEND_DIR / filename).read_text(encoding="utf-8").splitlines()
    hits = [
        i for i, line in enumerate(lines)
        if "OPENAI_MODERATION" in line
    ]
    assert hits, f"{filename} never mentions OPENAI_MODERATION"
    center = hits[0]
    return "\n".join(lines[max(0, center - 8):center + 9])


def test_moderation_docs_name_all_four_variables_near_one_section():
    for filename in (".env.example", ".env.production.example", "README.md"):
        section = _moderation_doc_section(filename)
        missing = [v for v in _MODERATION_VARIABLES if v not in section]
        assert not missing, f"{filename} is missing {missing} near its moderation section"


def test_production_example_states_key_is_required_and_server_only():
    section = _moderation_doc_section(".env.production.example").lower()
    assert any(
        marker in section
        for marker in ("required", "must be set")
    ), ".env.production.example does not state the API key is required"
    assert "server" in section, ".env.production.example does not say server-side"
    assert "expo" in section or "mobile" in section or "client" in section, (
        ".env.production.example does not warn against client exposure"
    )


def test_dev_example_warns_never_expose_key_in_expo_or_mobile():
    section = _moderation_doc_section(".env.example").lower()
    assert "expo" in section or "mobile" in section, (
        ".env.example does not warn about Expo/mobile exposure"
    )
    assert any(
        marker in section
        for marker in ("never", "do not expose", "don't expose")
    ), ".env.example does not say never to expose the key"


def test_readme_documents_defaults_and_deploy_check_ids():
    section = _moderation_doc_section("README.md")
    lowered = section.lower()
    assert "unset" in lowered or "not set" in lowered, (
        "README.md does not document the default unset key"
    )
    assert "omni-moderation-latest" in section, (
        "README.md does not document the default model"
    )
    assert any(marker in section for marker in ("2",)), (
        "README.md does not document connect timeout default of 2s"
    )
    assert any(marker in section for marker in ("5",)), (
        "README.md does not document read timeout default of 5s"
    )
    for check_id in ("E007", "E008", "E009"):
        assert check_id in section, (
            f"README.md does not document deploy check {check_id}"
        )
    lowered = section.lower()
    assert "server" in lowered, "README.md does not say server-side only"
    assert "expo" in lowered or "mobile" in lowered or "client" in lowered, (
        "README.md does not warn against Expo/mobile/client exposure"
    )


def test_moderation_docs_state_text_and_image_are_sent_to_openai():
    """Docs must truthfully say UGC text + normalized image go to OpenAI when used."""

    for filename in (".env.example", ".env.production.example", "README.md"):
        section = _moderation_doc_section(filename).lower()
        assert "openai" in section, f"{filename} does not name OpenAI"
        assert any(
            marker in section
            for marker in ("sent to openai", "are sent", "is sent")
        ), f"{filename} does not state that content is sent to OpenAI"
        assert any(
            marker in section for marker in ("not integrated", "no ugc endpoints")
        ), f"{filename} does not state Phase A is not integrated"


def test_moderation_readme_states_maximum_timeouts():
    section = _moderation_doc_section("README.md").lower()
    assert "maximum" in section, "README.md does not state timeout maximums"
    assert "10" in section and "30" in section, (
        "README.md does not state the 10s connect / 30s read maximums"
    )
