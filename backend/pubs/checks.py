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
                    f"Set {ANDROID_APP_LINK_FINGERPRINTS_ENV} to the production "
                    "Android signing certificate's SHA-256 fingerprint from "
                    "Google Play Console > App integrity > App signing key "
                    "certificate (Play App Signing). Without it "
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
                f"Set {ANDROID_APP_LINK_FINGERPRINTS_ENV} to the production "
                "Android signing certificate's SHA-256 value from Google Play "
                "Console > App integrity > App signing key certificate (Play "
                "App Signing), or unset the variable to serve no Android "
                "app-link association."
            ),
            id="pubs.E003",
        )
    ]


def _is_explicit_truthy(value) -> bool:
    """Accept an actual bool or a common explicit true string; else False."""

    if isinstance(value, bool):
        return value
    return isinstance(value, str) and value.strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


@register(Tags.security, deploy=True)
def check_linear_feedback_sync_config(**_kwargs):
    """Linear feedback sync must be fully configured or fully disabled.

    Account purge performs a permanent issueDelete on Linear, so a deploy
    with sync enabled requires an admin-capable key plus an explicit
    operator confirmation env var. Runs regardless of DEBUG.
    """

    api_key = str(getattr(settings, "LINEAR_API_KEY", "") or "").strip()
    team_id = str(getattr(settings, "LINEAR_TEAM_ID", "") or "").strip()

    if not api_key and not team_id:
        return []

    if not api_key or not team_id:
        return [
            Error(
                "Linear feedback sync configuration is incomplete.",
                hint=(
                    "Set both LINEAR_API_KEY and LINEAR_TEAM_ID to enable the "
                    "sync, or unset both to disable it entirely."
                ),
                id="pubs.E005",
            )
        ]

    if not _is_explicit_truthy(
        getattr(settings, "LINEAR_FEEDBACK_DELETE_ADMIN_CONFIRMED", False)
    ):
        return [
            Error(
                "Linear feedback sync is enabled but the permanent delete "
                "confirmation for account purge is missing.",
                hint=(
                    "Account purge permanently deletes the user's Linear "
                    "issues via issueDelete, which requires an admin-capable "
                    "API key. Set LINEAR_FEEDBACK_DELETE_ADMIN_CONFIRMED=true "
                    "to assert the key has that capability, or unset "
                    "LINEAR_API_KEY/LINEAR_TEAM_ID to disable the sync."
                ),
                id="pubs.E006",
            )
        ]

    return []
