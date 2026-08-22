from django.core.checks import Tags, run_checks


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
