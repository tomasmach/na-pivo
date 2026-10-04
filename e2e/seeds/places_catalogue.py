"""A distinct menu proves the map opens and caches the selected venue."""

from pubs.models import PubCommunityData

from e2e.seeds import places_social
from e2e.seeds.places_social import observe as observe


def seed():
    places_social.seed()
    pub = PubCommunityData.objects.get(name="E2E Druhá hospoda")
    pub.beers = [{"name": "E2E Jantar druhé hospody", "price_czk": 67, "volume_ml": 300}]
    pub.save(update_fields=["beers"])
