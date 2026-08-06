from rest_framework import serializers


class PartyEveningCreateSerializer(serializers.Serializer):
    client_id = serializers.UUIDField()
    # Readable across a noisy table: no O/I/L/S/Z or 0/1/5.
    join_code = serializers.RegexField(r"^[ABCDEFGHJKMNPQRTUVWXY2346789]{6}$")
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
    started_at = serializers.DateTimeField(required=False, allow_null=True)


class PartyGameEventSerializer(serializers.Serializer):
    """
    One thing that happened in a game.

    `delta` is signed and capped: a point is ±1 in practice, and a bound stops a
    bad client (or a stuck finger) from writing a scoreboard nobody can read.
    Taking a point back is another event with a negative delta, never a delete —
    the log of a game is the game.
    """

    client_id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=["score", "finish", "answer"])
    #: Public id of the member whose score moved. Absent on `finish`.
    subject_id = serializers.UUIDField(required=False, allow_null=True)
    delta = serializers.IntegerField(required=False, default=0, min_value=-10, max_value=10)
    #: Game-specific detail. Bounded, not validated: the server does not know
    #: what a game means, but it must not become a place to park arbitrary data.
    payload = serializers.JSONField(required=False, default=dict)
    created_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_payload(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Payload musí být objekt.")
        if len(value) > 12:
            raise serializers.ValidationError("Payload je moc velký.")
        return value


class PartyGameEventBatchSerializer(serializers.Serializer):
    """
    A batch, because a phone that was offline comes back with several.

    Sending them one request each is what turns a lost signal into a burst of
    round trips at exactly the moment the connection is worst.
    """

    events = PartyGameEventSerializer(many=True, allow_empty=False, max_length=50)
