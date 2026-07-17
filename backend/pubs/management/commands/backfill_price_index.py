"""Backfill the materialized per-pub reference beer price index."""

from django.core.management.base import BaseCommand

from pubs.models import PubCommunityData, PubExternalBeerMenu, PubPriceIndex
from pubs.price_index import upsert_pub_price_index


class Command(BaseCommand):
    help = "Backfill reference beer prices from community and external menus."

    def handle(self, *args, **options) -> None:
        community_seen = 0
        community_indexed = 0
        community_cache_keys: set[str] = set()
        for row in PubCommunityData.objects.exclude(beers_updated_at=None).iterator(
            chunk_size=500
        ):
            community_seen += 1
            result = upsert_pub_price_index(
                cache_key=row.cache_key,
                name=row.name,
                lat=row.lat,
                lng=row.lng,
                city=row.city or "",
                external_id=row.external_id or "",
                beers=row.beers,
                observed_at=row.beers_updated_at,
                source=PubPriceIndex.Source.COMMUNITY,
            )
            if result is not None:
                community_indexed += 1
                community_cache_keys.add(row.cache_key)

        external_seen = 0
        external_indexed = 0
        for row in PubExternalBeerMenu.objects.filter(active=True).iterator(chunk_size=500):
            if row.cache_key in community_cache_keys:
                continue
            external_seen += 1
            result = upsert_pub_price_index(
                cache_key=row.cache_key,
                name=row.name,
                lat=row.lat,
                lng=row.lng,
                city=row.city,
                beers=row.beers,
                observed_at=row.verified_at or row.fetched_at,
                source=PubPriceIndex.Source.EXTERNAL,
            )
            if result is not None and result.source == PubPriceIndex.Source.EXTERNAL:
                external_indexed += 1

        self.stdout.write(
            "Price index backfill: "
            f"community_seen={community_seen} community_indexed={community_indexed} "
            f"external_seen={external_seen} external_indexed={external_indexed} "
            f"total={PubPriceIndex.objects.count()}"
        )
