from rest_framework import serializers


class PartyEveningCreateSerializer(serializers.Serializer):
    client_id = serializers.UUIDField()
    join_code = serializers.RegexField(r"^[A-Z2-9]{6}$")
    pub_name = serializers.CharField(max_length=200, trim_whitespace=True)
    pub_city = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    started_at = serializers.DateTimeField(required=False)


class PartyEveningDrinkSerializer(serializers.Serializer):
    client_id = serializers.UUIDField()
    beer_name = serializers.CharField(max_length=120, trim_whitespace=True)
    quantity = serializers.IntegerField(min_value=1, max_value=20, default=1)
    shared_at = serializers.DateTimeField(required=False)
