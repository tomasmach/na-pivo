import json

from django.utils.translation import gettext
from rest_framework import serializers

# Game payloads are intentionally opaque to the API, but they still need a
# strict storage budget.  These limits leave ample room for a quiz question and
# its answers while preventing a single offline batch from becoming a JSON
# document store.
PARTY_GAME_PAYLOAD_MAX_BYTES = 16 * 1024
PARTY_GAME_PAYLOAD_MAX_DEPTH = 6
PARTY_GAME_PAYLOAD_MAX_ARRAY_ITEMS = 64
PARTY_GAME_PAYLOAD_MAX_OBJECT_ITEMS = 32
PARTY_GAME_PAYLOAD_MAX_TOTAL_ITEMS = 256
PARTY_GAME_PAYLOAD_MAX_STRING_CHARS = 2_048
PARTY_GAME_PAYLOAD_MAX_KEY_CHARS = 80
PARTY_GAME_EVENT_BATCH_MAX_PAYLOAD_BYTES = 64 * 1024

# Durable abuse ceilings.  Normal games produce tens of events; the higher
# limits preserve long-running tables and offline retries without allowing one
# account to grow an evening forever.
PARTY_GAME_EVENT_MAX_PER_GAME = 1_000
PARTY_GAME_EVENT_MAX_PER_EVENING = 5_000
PARTY_GAME_MAX_ROSTER = 64


def _validate_json_shape(value) -> None:
    """Validate a JSON value with bounded depth, fan-out and total nodes."""

    item_count = 0

    def walk(item, *, depth: int) -> None:
        nonlocal item_count
        item_count += 1
        if item_count > PARTY_GAME_PAYLOAD_MAX_TOTAL_ITEMS:
            raise serializers.ValidationError(gettext("Payload obsahuje moc položek."))
        if depth > PARTY_GAME_PAYLOAD_MAX_DEPTH:
            raise serializers.ValidationError(gettext("Payload je moc zanořený."))

        if isinstance(item, dict):
            if len(item) > PARTY_GAME_PAYLOAD_MAX_OBJECT_ITEMS:
                raise serializers.ValidationError(gettext("Payload obsahuje moc položek."))
            for key, child in item.items():
                if not isinstance(key, str):
                    raise serializers.ValidationError(gettext("Klíče payloadu musí být text."))
                if len(key) > PARTY_GAME_PAYLOAD_MAX_KEY_CHARS:
                    raise serializers.ValidationError(gettext("Klíč payloadu je moc dlouhý."))
                walk(child, depth=depth + 1)
            return

        if isinstance(item, list):
            if len(item) > PARTY_GAME_PAYLOAD_MAX_ARRAY_ITEMS:
                raise serializers.ValidationError(gettext("Pole v payloadu obsahuje moc položek."))
            for child in item:
                walk(child, depth=depth + 1)
            return

        if isinstance(item, str) and len(item) > PARTY_GAME_PAYLOAD_MAX_STRING_CHARS:
            raise serializers.ValidationError(gettext("Text v payloadu je moc dlouhý."))

    walk(value, depth=1)


def _serialized_payload_size(value) -> int:
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise serializers.ValidationError(gettext("Payload není platný JSON.")) from exc
    return len(encoded)


class PartyEveningCreateSerializer(serializers.Serializer):
    client_id = serializers.UUIDField()
    # Released clients generated the full A-Z / 2-9 alphabet. New clients avoid
    # ambiguous glyphs, but the server must keep accepting legacy retries.
    join_code = serializers.RegexField(r"^[A-Z2-9]{6}$")
    pub_name = serializers.CharField(max_length=200, trim_whitespace=True)
    pub_city = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    started_at = serializers.DateTimeField(required=False)


class PartyEveningDrinkSerializer(serializers.Serializer):
    client_id = serializers.UUIDField()
    beer_name = serializers.CharField(max_length=120, trim_whitespace=True)
    quantity = serializers.IntegerField(min_value=1, max_value=20, default=1)
    shared_at = serializers.DateTimeField(required=False)


class PartyGameCreateSerializer(serializers.Serializer):
    """
    Putting a game on the table.

    `catalog_key` is not validated against a list on purpose. The catalogue
    lives in the app and grows with releases; rejecting a key this server has
    not heard of would mean every new game needs a backend deploy before anyone
    can play it, and would break a newer phone against an older API. The name
    travels with it so that clients — and this server — can show something
    sensible for a key they do not know.
    """

    client_id = serializers.UUIDField()
    catalog_key = serializers.RegexField(r"^[a-z0-9_-]{1,40}$")
    name = serializers.CharField(max_length=80)
    scoring = serializers.ChoiceField(choices=["points", "drinks"], default="points")
    # Additive: released clients omit this and get the active table snapshotted
    # by the server. New clients send the explicit lobby selection.
    roster_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        allow_empty=True,
        max_length=PARTY_GAME_MAX_ROSTER,
    )
    started_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_roster_ids(self, value):
        # An explicit empty list means "put it on the table; the lobby has not
        # picked its players yet". Omitting the field keeps released clients'
        # behaviour: the server snapshots everyone currently at the table.
        if len(value) == 1:
            raise serializers.ValidationError(gettext("Hru musí hrát aspoň dva hráči."))
        if len(set(value)) != len(value):
            raise serializers.ValidationError(gettext("Každý hráč smí být v sestavě jen jednou."))
        return value


class PartyGameEventSerializer(serializers.Serializer):
    """
    One thing that happened in a game.

    `delta` is signed and capped: a point is ±1 in practice, and a bound stops a
    bad client (or a stuck finger) from writing a scoreboard nobody can read.
    Taking a point back is another event with a negative delta, never a delete —
    the log of a game is the game.
    """

    client_id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=["score", "finish", "answer", "action"])
    #: Public id of the member whose score moved. Absent on `finish`.
    subject_id = serializers.UUIDField(required=False, allow_null=True)
    delta = serializers.IntegerField(required=False, default=0, min_value=-10, max_value=10)
    #: Game-specific detail. Bounded, not validated: the server does not know
    #: what a game means, but it must not become a place to park arbitrary data.
    payload = serializers.JSONField(required=False, default=dict)
    created_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_payload(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError(gettext("Payload musí být objekt."))
        if len(value) > 12:
            raise serializers.ValidationError(gettext("Payload je moc velký."))
        _validate_json_shape(value)
        if _serialized_payload_size(value) > PARTY_GAME_PAYLOAD_MAX_BYTES:
            raise serializers.ValidationError(gettext("Payload je moc velký."))
        return value


class PartyGameEventBatchSerializer(serializers.Serializer):
    """
    A batch, because a phone that was offline comes back with several.

    Sending them one request each is what turns a lost signal into a burst of
    round trips at exactly the moment the connection is worst.
    """

    events = PartyGameEventSerializer(many=True, allow_empty=False, max_length=50)

    def validate_events(self, value):
        payload_bytes = sum(_serialized_payload_size(item.get("payload") or {}) for item in value)
        if payload_bytes > PARTY_GAME_EVENT_BATCH_MAX_PAYLOAD_BYTES:
            raise serializers.ValidationError(gettext("Payloady v dávce jsou dohromady moc velké."))
        return value
