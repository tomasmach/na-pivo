# Hand-written: seed common beer products under the major beer brands.

from django.db import migrations

PRAZDROJ = "https://www.prazdroj.cz/en/our-beer"
HEINEKEN_CZ = "https://www.heinekenceskarepublika.cz/en/"
WIKI_CZ = "https://en.wikipedia.org/wiki/Beer_in_the_Czech_Republic"
WIKI_SK = "https://en.wikipedia.org/wiki/Beer_in_Slovakia"

# key, brand_key, name, aliases, rank, source_label, source_url
PRODUCTS = [
    ("pilsner-urquell", "pilsner-urquell", "Pilsner Urquell", ["Plzeň", "Plzen", "Prazdroj", "Plzeň 12", "Plzen 12"], 10, "Plzeňský Prazdroj", PRAZDROJ),
    ("gambrinus-10", "gambrinus", "Gambrinus 10°", ["Gambrinus desítka", "Gambáč 10", "Gambac 10"], 20, "Plzeňský Prazdroj", PRAZDROJ),
    ("gambrinus-11", "gambrinus", "Gambrinus 11°", ["Gambrinus jedenáctka", "Gambáč 11", "Gambac 11"], 21, "Plzeňský Prazdroj", PRAZDROJ),
    ("gambrinus-12", "gambrinus", "Gambrinus 12°", ["Gambrinus dvanáctka", "Gambrinus Plná 12"], 22, "Plzeňský Prazdroj", PRAZDROJ),
    ("velkopopovicky-kozel-10", "velkopopovicky-kozel", "Velkopopovický Kozel 10°", ["Kozel 10", "Kozel 10°", "Kozel desítka"], 30, "Plzeňský Prazdroj", PRAZDROJ),
    ("velkopopovicky-kozel-11", "velkopopovicky-kozel", "Velkopopovický Kozel 11°", ["Kozel 11", "Kozel 11°", "Kozel jedenáctka"], 31, "Plzeňský Prazdroj", PRAZDROJ),
    ("velkopopovicky-kozel-12", "velkopopovicky-kozel", "Velkopopovický Kozel 12°", ["Kozel 12", "Kozel 12°", "Kozel dvanáctka"], 32, "Plzeňský Prazdroj", PRAZDROJ),
    ("velkopopovicky-kozel-cerny", "velkopopovicky-kozel", "Velkopopovický Kozel Černý", ["Kozel černý", "Kozel cerny", "Kozel tmavý", "Kozel tmavy"], 33, "Plzeňský Prazdroj", PRAZDROJ),
    ("radegast-razna-10", "radegast", "Radegast Rázná 10°", ["Radegast 10", "Radegast 10°", "Radegast desítka"], 40, "Plzeňský Prazdroj", PRAZDROJ),
    ("radegast-ryze-horka-12", "radegast", "Radegast Ryzí hořká 12°", ["Radegast 12", "Radegast 12°", "Radegast Ryze hořká", "Radegast Ryze horka"], 41, "Plzeňský Prazdroj", PRAZDROJ),
    ("radegast-ratar", "radegast", "Radegast Ratar", ["Ratar"], 42, "Plzeňský Prazdroj", PRAZDROJ),
    ("staropramen-10", "staropramen", "Staropramen 10°", ["Staropramen desítka", "Staráč 10", "Starac 10"], 50, "Curated common Czech tap product", WIKI_CZ),
    ("staropramen-11", "staropramen", "Staropramen 11°", ["Staropramen jedenáctka", "Staráč 11", "Starac 11"], 51, "Curated common Czech tap product", WIKI_CZ),
    ("staropramen-12", "staropramen", "Staropramen 12°", ["Staropramen dvanáctka", "Staráč 12", "Starac 12"], 52, "Curated common Czech tap product", WIKI_CZ),
    ("budweiser-budvar-original", "budweiser-budvar", "Budweiser Budvar Original", ["Budvar", "Budvar Original", "Budějovický Budvar", "Budejovicky Budvar"], 60, "Curated common Czech tap product", WIKI_CZ),
    ("budweiser-budvar-33", "budweiser-budvar", "Budweiser Budvar 33", ["Budvar 33"], 61, "Curated common Czech tap product", WIKI_CZ),
    ("budweiser-budvar-dark", "budweiser-budvar", "Budweiser Budvar Dark", ["Budvar tmavý", "Budvar tmavy", "Budvar černý", "Budvar cerny"], 62, "Curated common Czech tap product", WIKI_CZ),
    ("krusovice-10", "krusovice", "Krušovice 10°", ["Krusovice 10", "Krušovice desítka", "Krusovice desitka"], 70, "Heineken Česká republika", HEINEKEN_CZ),
    ("krusovice-11", "krusovice", "Krušovice 11°", ["Krusovice 11", "Krušovice jedenáctka", "Krusovice jedenactka"], 71, "Heineken Česká republika", HEINEKEN_CZ),
    ("krusovice-12", "krusovice", "Krušovice 12°", ["Krusovice 12", "Krušovice dvanáctka", "Krusovice dvanactka"], 72, "Heineken Česká republika", HEINEKEN_CZ),
    ("krusovice-cerne", "krusovice", "Krušovice Černé", ["Krusovice cerne", "Krušovice tmavé", "Krusovice tmave"], 73, "Heineken Česká republika", HEINEKEN_CZ),
    ("starobrno-medium", "starobrno", "Starobrno Medium", ["Starobrno 11", "Starobrno 11°"], 80, "Heineken Česká republika", HEINEKEN_CZ),
    ("starobrno-bittr", "starobrno", "Starobrno Bitr", ["Starobrno Bitr", "Starobrno Bitr 11"], 81, "Heineken Česká republika", HEINEKEN_CZ),
    ("starobrno-drak", "starobrno", "Starobrno Drak", ["Starobrno Drak 12"], 82, "Heineken Česká republika", HEINEKEN_CZ),
    ("branik-10", "branik", "Braník 10°", ["Branik 10", "Braník desítka", "Branik desitka"], 90, "Curated common Czech tap product", WIKI_CZ),
    ("branik-11", "branik", "Braník 11°", ["Branik 11", "Braník jedenáctka", "Branik jedenactka"], 91, "Curated common Czech tap product", WIKI_CZ),
    ("breznak-10", "breznak", "Březňák 10°", ["Breznak 10", "Březňák desítka", "Breznak desitka"], 100, "Heineken Česká republika", HEINEKEN_CZ),
    ("breznak-11", "breznak", "Březňák 11°", ["Breznak 11", "Březňák jedenáctka", "Breznak jedenactka"], 101, "Heineken Česká republika", HEINEKEN_CZ),
    ("breznak-12", "breznak", "Březňák 12°", ["Breznak 12", "Březňák dvanáctka", "Breznak dvanactka"], 102, "Heineken Česká republika", HEINEKEN_CZ),
    ("zlatopramen-11", "zlatopramen", "Zlatopramen 11°", ["Zlato 11", "Zlatopramen jedenáctka"], 110, "Heineken Česká republika", HEINEKEN_CZ),
    ("bernard-10", "bernard", "Bernard 10°", ["Bernard desítka", "Bernard desitka"], 120, "Curated common Czech tap product", WIKI_CZ),
    ("bernard-11", "bernard", "Bernard 11°", ["Bernard jedenáctka", "Bernard jedenactka"], 121, "Curated common Czech tap product", WIKI_CZ),
    ("bernard-12", "bernard", "Bernard 12°", ["Bernard dvanáctka", "Bernard dvanactka"], 122, "Curated common Czech tap product", WIKI_CZ),
    ("svijany-maz-11", "svijany", "Svijanský Máz 11°", ["Svijany Máz", "Svijansky Maz", "Svijany 11"], 130, "Curated common Czech tap product", WIKI_CZ),
    ("svijany-rytir-12", "svijany", "Svijanský Rytíř 12°", ["Svijany Rytíř", "Svijansky Rytir", "Svijany 12"], 131, "Curated common Czech tap product", WIKI_CZ),
    ("birell-svetly", "birell", "Birell Světlý", ["Birell", "Birell světlý", "Birell svetly"], 160, "Plzeňský Prazdroj", PRAZDROJ),
    ("birell-polotmavy", "birell", "Birell Polotmavý", ["Birell polotmavý", "Birell polotmavy"], 161, "Plzeňský Prazdroj", PRAZDROJ),
    ("zlaty-bazant-10", "zlaty-bazant", "Zlatý Bažant 10°", ["Zlaty Bazant 10", "Bažant 10", "Bazant 10"], 300, "Beer in Slovakia", WIKI_SK),
    ("zlaty-bazant-12", "zlaty-bazant", "Zlatý Bažant 12°", ["Zlaty Bazant 12", "Bažant 12", "Bazant 12"], 301, "Beer in Slovakia", WIKI_SK),
    ("saris-10", "saris", "Šariš 10°", ["Saris 10", "Šariš desiatka", "Saris desiatka"], 310, "Beer in Slovakia", WIKI_SK),
    ("saris-12", "saris", "Šariš 12°", ["Saris 12", "Šariš dvanástka", "Saris dvanastka"], 311, "Beer in Slovakia", WIKI_SK),
    ("topvar-10", "topvar", "Topvar 10°", ["Topvar desiatka"], 320, "Beer in Slovakia", WIKI_SK),
    ("topvar-12", "topvar", "Topvar 12°", ["Topvar dvanástka", "Topvar dvanastka"], 321, "Beer in Slovakia", WIKI_SK),
    ("corgon-10", "corgon", "Corgoň 10°", ["Corgon 10", "Corgoň desiatka", "Corgon desiatka"], 330, "Beer in Slovakia", WIKI_SK),
    ("corgon-12", "corgon", "Corgoň 12°", ["Corgon 12", "Corgoň dvanástka", "Corgon dvanastka"], 331, "Beer in Slovakia", WIKI_SK),
    ("smadny-mnich-10", "smadny-mnich", "Smädný Mních 10°", ["Smadny Mnich 10"], 340, "Beer in Slovakia", WIKI_SK),
    ("kelt-10", "kelt", "Kelt 10°", ["Kelt desiatka"], 350, "Beer in Slovakia", WIKI_SK),
]


def add_beer_products(apps, schema_editor):
    BeerBrand = apps.get_model("pubs", "BeerBrand")
    BeerProduct = apps.get_model("pubs", "BeerProduct")

    brands = {brand.key: brand for brand in BeerBrand.objects.filter(key__in={p[1] for p in PRODUCTS})}
    for key, brand_key, name, aliases, rank, source_label, source_url in PRODUCTS:
        brand = brands.get(brand_key)
        if brand is None:
            continue
        BeerProduct.objects.update_or_create(
            key=key,
            defaults={
                "brand": brand,
                "brand_key": brand.key,
                "brand_name": brand.name,
                "name": name,
                "aliases": aliases,
                "rank": rank,
                "source_label": source_label,
                "source_url": source_url,
                "active": True,
            },
        )


def remove_beer_products(apps, schema_editor):
    BeerProduct = apps.get_model("pubs", "BeerProduct")
    BeerProduct.objects.filter(key__in=[product[0] for product in PRODUCTS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0032_drinklog_beer_product_key_drinklog_beer_product_name_and_more"),
    ]

    operations = [
        migrations.RunPython(add_beer_products, remove_beer_products),
    ]
