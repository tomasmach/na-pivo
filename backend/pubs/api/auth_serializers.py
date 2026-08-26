"""
pubs.api.auth_serializers — request-body validation for the auth endpoints.

These only validate/clean the wire input; all logic lives in pubs.accounts.
Responses are assembled by the views (see AccountMeSerializer for the canonical
account shape returned after auth).
"""

from __future__ import annotations

from django.utils.translation import gettext_lazy
from rest_framework import serializers

from pubs.models import AuthIdentity

# Minimum password length accepted at the serializer layer; Django's
# AUTH_PASSWORD_VALIDATORS (run in pubs.accounts) enforce the real strength rules.
_MIN_PASSWORD_LEN = 8
_PROVIDER_CHOICES = list(AuthIdentity.Provider.values)  # ["google", "apple"]
_UNLINK_CHOICES = ["email", *AuthIdentity.Provider.values]


class MergeOperationIdField(serializers.UUIDField):
    default_error_messages = {
        **serializers.UUIDField.default_error_messages,
        "not_uuid4": gettext_lazy("Musí být náhodné UUIDv4."),
    }

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        if value.version != 4:
            self.fail("not_uuid4")
        return value


class RegisterSerializer(serializers.Serializer):
    merge_operation_id = MergeOperationIdField(required=False, default=None)
    email = serializers.EmailField()
    password = serializers.CharField(
        write_only=True, min_length=_MIN_PASSWORD_LEN, max_length=128, trim_whitespace=False
    )
    display_name = serializers.CharField(
        required=False, allow_blank=True, max_length=120, default=""
    )


class LoginSerializer(serializers.Serializer):
    merge_operation_id = MergeOperationIdField(required=False, default=None)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)


class GoogleAuthSerializer(serializers.Serializer):
    """Body for /auth/google and /auth/link (provider=google)."""

    merge_operation_id = MergeOperationIdField(required=False, default=None)
    id_token = serializers.CharField(trim_whitespace=True)


class AppleAuthSerializer(serializers.Serializer):
    """Body for /auth/apple and /auth/link (provider=apple).

    ``full_name`` is sent by the client ONLY on the very first Apple sign-in
    (Apple never puts the name in the identity token). ``authorization_code`` is
    exchanged for a refresh token so deletion can revoke it.
    """

    merge_operation_id = MergeOperationIdField(required=False, default=None)
    identity_token = serializers.CharField(trim_whitespace=True)
    authorization_code = serializers.CharField(
        required=False, allow_blank=True, default="", trim_whitespace=True
    )
    full_name = serializers.CharField(
        required=False, allow_blank=True, max_length=120, default=""
    )


class LinkSerializer(serializers.Serializer):
    """Body for POST /auth/link — link a provider to the signed-in account."""

    provider = serializers.ChoiceField(choices=_PROVIDER_CHOICES)
    # Google
    id_token = serializers.CharField(required=False, allow_blank=True, default="")
    # Apple
    identity_token = serializers.CharField(required=False, allow_blank=True, default="")
    authorization_code = serializers.CharField(required=False, allow_blank=True, default="")
    full_name = serializers.CharField(
        required=False, allow_blank=True, max_length=120, default=""
    )

    def validate(self, attrs: dict) -> dict:
        provider = attrs["provider"]
        if provider == AuthIdentity.Provider.GOOGLE and not attrs.get("id_token"):
            raise serializers.ValidationError({"id_token": "Required for provider 'google'."})
        if provider == AuthIdentity.Provider.APPLE and not attrs.get("identity_token"):
            raise serializers.ValidationError(
                {"identity_token": "Required for provider 'apple'."}
            )
        return attrs


class UnlinkSerializer(serializers.Serializer):
    provider = serializers.ChoiceField(choices=_UNLINK_CHOICES)


class SetPasswordSerializer(serializers.Serializer):
    """Body for POST /auth/set-password (escape hatch / add password)."""

    password = serializers.CharField(
        write_only=True, min_length=_MIN_PASSWORD_LEN, max_length=128, trim_whitespace=False
    )
    # Required only when the account has no email yet (social-only account).
    email = serializers.EmailField(required=False, allow_blank=True, default="")


class RequestPasswordResetSerializer(serializers.Serializer):
    email = serializers.EmailField()


class ResetPasswordSerializer(serializers.Serializer):
    token = serializers.CharField(trim_whitespace=True)
    password = serializers.CharField(
        write_only=True, min_length=_MIN_PASSWORD_LEN, max_length=128, trim_whitespace=False
    )


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField(trim_whitespace=True)


class LogoutSerializer(serializers.Serializer):
    # When true, revoke ALL of the account's tokens (sign out everywhere).
    all = serializers.BooleanField(required=False, default=False)
