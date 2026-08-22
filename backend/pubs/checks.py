from django.conf import settings
from django.core.checks import Error, Tags, register

_FINGERPRINT_DIGITS = set("0123456789ABCDEF")

ANDROID_APP_LINK_FINGERPRINTS_ENV = "ANDROID_APP_LINK_CERT_FINGERPRINTS"


@register(Tags.security, deploy=True)
def check_pub_report_global_hide_threshold(**_kwargs):
    """Production must keep the intended three-account global-hide quorum."""

    raw = getattr(settings, "PUB_REPORT_GLOBAL_HIDE_THRESHOLD", 3)
    try:
        threshold = int(raw)
    except (TypeError, ValueError):
        return [
            Error(
                f"PUB_REPORT_GLOBAL_HIDE_THRESHOLD is not an integer: {raw!r}.",
                hint="Set PUB_REPORT_GLOBAL_HIDE_THRESHOLD=3 or higher before deploy.",
                id="pubs.E002",
            )
        ]
    if threshold >= 3:
        return []
    return [
        Error(
            "PUB_REPORT_GLOBAL_HIDE_THRESHOLD must be at least 3 in production.",
            hint="Set PUB_REPORT_GLOBAL_HIDE_THRESHOLD=3 or higher before deploy.",
            id="pubs.E001",
        )
    ]


def normalized_cert_fingerprints(raw: str) -> list[str]:
    """Parse comma-separated SHA-256 cert fingerprints; drop malformed ones."""

    cleaned: list[str] = []
    for chunk in raw.split(","):
        value = chunk.strip().upper().replace(":", "")
        if len(value) == 64 and set(value) <= _FINGERPRINT_DIGITS:
            cleaned.append(value)
    return cleaned


@register(Tags.security, deploy=True)
def check_android_app_link_cert_fingerprints(**_kwargs):
    """Android App Links need the real signing fingerprint in production.

    Missing or malformed values never break the endpoint (it fails closed by
    serving no association), but production deploys must fail fast instead of
    silently shipping without app-link verification.
    """

    if getattr(settings, "DEBUG", False):
        return []

    raw = str(getattr(settings, ANDROID_APP_LINK_FINGERPRINTS_ENV, "") or "")
    if not raw.strip():
        return [
            Error(
                f"{ANDROID_APP_LINK_FINGERPRINTS_ENV} is not configured.",
                hint=(
                    f"Set {ANDROID_APP_LINK_FINGERPRINTS_ENV} to the Android "
                    "signing certificate's SHA-256 fingerprint (from EAS "
                    "credentials or `keytool -list -v`). Without it "
                    "/.well-known/assetlinks.json serves no association and "
                    "installed apps will not verify as app links."
                ),
                id="pubs.E004",
            )
        ]
    if normalized_cert_fingerprints(raw):
        return []
    return [
        Error(
            f"{ANDROID_APP_LINK_FINGERPRINTS_ENV} is set but contains no valid "
            "SHA-256 fingerprint (expected 64 hex characters, colons optional).",
            hint=(
                f"Set {ANDROID_APP_LINK_FINGERPRINTS_ENV} to the signing key's "
                "SHA-256 value (e.g. from EAS credentials or `keytool -list "
                "-v`), or unset it to serve no Android app-link association."
            ),
            id="pubs.E003",
        )
    ]
