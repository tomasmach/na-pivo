# Hand-written: add popular regional and craft Czech breweries to the beer
# catalog, then index the menus and drinks that already mention them so the
# brand filter finds those pubs right after deploy.

from importlib import import_module

from django.db import migrations

_catalog_backfill = import_module("pubs.migrations.0034_backfill_beer_catalog_indexes")

SOURCE_LABEL = "Curated Czech regional brand"

# key, name, aliases
BRANDS = [
    ("uneticke", "Únětické pivo", ["Únětické", "Únětická", "Únětický", "Únětice", "Únětický pivovar"]),
    ("matuska", "Matuška", ["Pivovar Matuška"]),
    ("kocour", "Kocour", ["Pivovar Kocour"]),
    ("primator", "Primátor", ["Pivovar Náchod"]),
    ("chotebor", "Chotěboř", ["Pivovar Chotěboř"]),
    ("rohozec", "Rohozec", ["Skalák", "Pivovar Rohozec"]),
    ("krakonos", "Krakonoš", ["Pivovar Krakonoš"]),
    ("ferdinand", "Ferdinand", ["Pivovar Ferdinand"]),
    ("konrad", "Konrad", ["Pivovar Vratislavice"]),
    ("postrizinske", "Postřižinské pivo", ["Postřižinské", "Pivovar Nymburk", "Francinův ležák"]),
    ("zatec", "Žatec", ["Žatecký pivovar"]),
    ("cerna-hora", "Černá Hora", ["Pivovar Černá Hora"]),
    ("pernstejn", "Pernštejn", ["Pardubický Porter", "Pivovar Pernštejn"]),
    ("rebel", "Rebel", ["Pivovar Rebel"]),
    ("platan", "Platan", ["Pivovar Protivín"]),
    ("hostan", "Hostan", ["Pivovar Hostan"]),
    ("janacek", "Janáček", ["Pivovar Janáček"]),
    ("herold", "Herold", ["Pivovar Herold"]),
    ("chodovar", "Chodovar", ["Pivovar Chodovar"]),
    ("poutnik", "Poutník", ["Pivovar Poutník"]),
    ("opat", "Opat", ["Pivovar Broumov"]),
    ("jezek", "Ježek", ["Jihlavský Ježek", "Pivovar Jihlava"]),
    ("dalesice", "Dalešice", ["Pivovar Dalešice"]),
    ("hubertus", "Hubertus", ["Pivovar Kácov"]),
    ("u-fleku", "U Fleků", ["Flekovský ležák"]),
    ("strahov", "Klášterní pivovar Strahov", ["Strahov", "Svatý Norbert", "Sv. Norbert"]),
    ("nachmelena-opice", "Nachmelená Opice", ["Nachmelena Opice"]),
    ("zichovec", "Zichovec", ["Pivovar Zichovec"]),
    ("sibeeria", "Sibeeria", ["Pivovar Sibeeria"]),
    ("falkon", "Falkon", ["Pivovar Falkon"]),
    ("clock", "Clock", ["Pivovar Clock"]),
]

NEW_BRAND_KEYS = {key for key, _name, _aliases in BRANDS}


def add_brands_and_backfill(apps, schema_editor):
    BeerBrand = apps.get_model("pubs", "BeerBrand")
    DrinkLog = apps.get_model("pubs", "DrinkLog")
    PubBeerBrand = apps.get_model("pubs", "PubBeerBrand")
    PubBeerProduct = apps.get_model("pubs", "PubBeerProduct")
    PubCommunityData = apps.get_model("pubs", "PubCommunityData")

    for index, (key, name, aliases) in enumerate(BRANDS):
        BeerBrand.objects.update_or_create(
            key=key,
            defaults={
                "name": name,
                "aliases": aliases,
                "rank": 410 + index * 10,
                "source_label": SOURCE_LABEL,
                "source_url": "",
                "active": True,
            },
        )

    # Match against the whole catalog, as live writes do, and only apply
    # results that land on a new brand. Existing links stay untouched.
    products, brands = _catalog_backfill.load_catalog(apps)

    def new_brand_match(name):
        match = _catalog_backfill.find_match(name, products, brands)
        if match is None or match[0].key not in NEW_BRAND_KEYS:
            return None
        return match

    drinks = DrinkLog.objects.filter(beer_brand__isnull=True, drink_type="beer").exclude(
        beer_name=""
    )
    for drink in drinks.iterator(chunk_size=500):
        match = new_brand_match(drink.beer_name)
        if match is None:
            continue
        brand, _product = match
        drink.beer_brand = brand
        drink.beer_brand_key = brand.key
        drink.beer_brand_name = brand.name
        drink.save(update_fields=["beer_brand", "beer_brand_key", "beer_brand_name"])

    for row in PubCommunityData.objects.all().iterator(chunk_size=200):
        beers = row.beers if isinstance(row.beers, list) else []
        seen_at = row.beers_updated_at or row.updated_at
        for beer in beers:
            if not isinstance(beer, dict):
                continue
            match = new_brand_match(beer.get("name"))
            if match is None:
                continue
            brand, product = match
            _catalog_backfill.upsert_pub_indexes(
                pub_beer_brand_model=PubBeerBrand,
                pub_beer_product_model=PubBeerProduct,
                cache_key=row.cache_key,
                row=row,
                beer=beer,
                brand=brand,
                product=product,
                seen_at=seen_at,
            )


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0147_tour_search_text"),
    ]

    operations = [
        migrations.RunPython(add_brands_and_backfill, migrations.RunPython.noop),
    ]
