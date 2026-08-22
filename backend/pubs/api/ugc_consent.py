from django.conf import settings
from rest_framework.response import Response

UGC_POLICY_HEADER = "X-Na-Pivo-UGC-Policy-Version"

_UGC_CONSENT_REQUIRED_DETAIL = "Nejdřív potvrď pravidla pro sdílený obsah."
_UGC_POLICY_UPDATE_DETAIL = "Pravidla pro sdílený obsah se změnila. Potvrď je znovu."


def ugc_consent_snapshot(account):
    """Acceptance proof for this account against the current policy version."""
    accepted_at = account.ugc_terms_accepted_at
    return {
        "policy_version": settings.UGC_POLICY_VERSION,
        "accepted": (
            accepted_at is not None
            and account.ugc_terms_version == settings.UGC_POLICY_VERSION
        ),
        "accepted_version": account.ugc_terms_version,
        "accepted_at": accepted_at.isoformat() if accepted_at else None,
    }


def _ugc_precondition_response(code, detail):
    return Response(
        {"code": code, "detail": detail},
        status=428,
    )


def ugc_consent_precondition(request):
    """Return a 428 response when the client cannot prove current UGC consent.

    Requests without the policy header (legacy clients) pass untouched. A
    header value that differs from the deployed version — or an account whose
    stored acceptance does not match it — blocks the request until the client
    re-confirms the terms.
    """
    header_version = request.headers.get(UGC_POLICY_HEADER)
    if not header_version:
        return None
    if header_version != settings.UGC_POLICY_VERSION:
        return _ugc_precondition_response(
            "ugc_policy_update_required", _UGC_POLICY_UPDATE_DETAIL
        )
    account = getattr(request, "user", None)
    stored_version = getattr(account, "ugc_terms_version", "") or ""
    accepted_at = getattr(account, "ugc_terms_accepted_at", None)
    if accepted_at is None or not stored_version:
        return _ugc_precondition_response(
            "ugc_consent_required", _UGC_CONSENT_REQUIRED_DETAIL
        )
    if stored_version != settings.UGC_POLICY_VERSION:
        return _ugc_precondition_response(
            "ugc_policy_update_required", _UGC_POLICY_UPDATE_DETAIL
        )
    return None
