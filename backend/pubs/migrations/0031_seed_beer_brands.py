# Hand-written: seed major Czech and Slovak beer brands for autocomplete.

from django.db import migrations

WIKI_CZ = "https://en.wikipedia.org/wiki/Beer_in_the_Czech_Republic"
PRAZDROJ = "https://www.prazdroj.cz/en/our-beer"
WIKI_SK = "https://en.wikipedia.org/wiki/Beer_in_Slovakia"

BRANDS = [
    ("pilsner-urquell", "Pilsner Urquell", ["Plzeň", "Plzen", "Pilsner", "Prazdroj"], 10, "Beer in the Czech Republic / Plzeňský Prazdroj", WIKI_CZ),
    ("gambrinus", "Gambrinus", ["Gambáč", "Gambac"], 20, "Plzeňský Prazdroj", PRAZDROJ),
    ("velkopopovicky-kozel", "Velkopopovický Kozel", ["Kozel", "Velkopopovicky Kozel"], 30, "Plzeňský Prazdroj", PRAZDROJ),
    ("radegast", "Radegast", [], 40, "Plzeňský Prazdroj", PRAZDROJ),
    ("staropramen", "Staropramen", ["Staráč", "Starac"], 50, "Beer in the Czech Republic", WIKI_CZ),
    ("budweiser-budvar", "Budweiser Budvar", ["Budvar", "Budějovický Budvar", "Budejovicky Budvar"], 60, "Beer in the Czech Republic", WIKI_CZ),
    ("krusovice", "Krušovice", ["Krusovice", "Krušky", "Krusky"], 70, "Beer in the Czech Republic", WIKI_CZ),
    ("starobrno", "Starobrno", ["Starobrno 10", "Starobrno 11", "Starobrno 12", "Starobrno Drak"], 80, "Beer in the Czech Republic", WIKI_CZ),
    ("branik", "Braník", ["Branik"], 90, "Beer in the Czech Republic", WIKI_CZ),
    ("breznak", "Březňák", ["Breznak"], 100, "Beer in the Czech Republic", WIKI_CZ),
    ("zlatopramen", "Zlatopramen", ["Zlato"], 110, "Beer in the Czech Republic", WIKI_CZ),
    ("bernard", "Bernard", [], 120, "Beer in the Czech Republic", WIKI_CZ),
    ("svijany", "Svijany", [], 130, "Beer in the Czech Republic", WIKI_CZ),
    ("lobkowicz", "Lobkowicz", ["Lobkowitz"], 140, "Beer in the Czech Republic", WIKI_CZ),
    ("ostravar", "Ostravar", [], 150, "Beer in the Czech Republic", WIKI_CZ),
    ("birell", "Birell", ["Birell nealko"], 160, "Plzeňský Prazdroj", PRAZDROJ),
    ("master", "Master", [], 170, "Plzeňský Prazdroj", PRAZDROJ),
    ("primus", "Primus", [], 180, "Plzeňský Prazdroj", PRAZDROJ),
    ("excelent", "Excelent", [], 190, "Plzeňský Prazdroj", PRAZDROJ),
    ("litovel", "Litovel", [], 200, "Curated Czech regional brand", ""),
    ("holba", "Holba", [], 210, "Curated Czech regional brand", ""),
    ("zubr", "Zubr", [], 220, "Curated Czech regional brand", ""),
    ("regent", "Regent", ["Bohemia Regent"], 230, "Curated Czech regional brand", ""),
    ("rychtar", "Rychtář", ["Rychtar"], 240, "Curated Czech regional brand", ""),
    ("bakalar", "Bakalář", ["Bakalar"], 250, "Curated Czech regional brand", ""),
    ("dudak", "Dudák", ["Dudak"], 260, "Curated Czech regional brand", ""),
    ("zlaty-bazant", "Zlatý Bažant", ["Zlaty Bazant", "Bažant", "Bazant"], 300, "Beer in Slovakia", WIKI_SK),
    ("saris", "Šariš", ["Saris"], 310, "Beer in Slovakia", WIKI_SK),
    ("topvar", "Topvar", [], 320, "Beer in Slovakia", WIKI_SK),
    ("corgon", "Corgoň", ["Corgon"], 330, "Beer in Slovakia", WIKI_SK),
    ("smadny-mnich", "Smädný Mních", ["Smadny Mnich"], 340, "Beer in Slovakia", WIKI_SK),
    ("kelt", "Kelt", [], 350, "Beer in Slovakia", WIKI_SK),
    ("steiger", "Steiger", [], 360, "Beer in Slovakia", WIKI_SK),
    ("urpiner", "Urpiner", [], 370, "Beer in Slovakia", WIKI_SK),
    ("martiner", "Martiner", [], 380, "Beer in Slovakia", WIKI_SK),
    ("gemer", "Gemer", [], 390, "Beer in Slovakia", WIKI_SK),
    ("stein", "Stein", [], 400, "Beer in Slovakia", WIKI_SK),
]


def add_beer_brands(apps, schema_editor):
    BeerBrand = apps.get_model("pubs", "BeerBrand")
    for key, name, aliases, rank, source_label, source_url in BRANDS:
        BeerBrand.objects.update_or_create(
            key=key,
            defaults={
                "name": name,
                "aliases": aliases,
                "rank": rank,
                "source_label": source_label,
                "source_url": source_url,
                "active": True,
            },
        )


def remove_beer_brands(apps, schema_editor):
    BeerBrand = apps.get_model("pubs", "BeerBrand")
    BeerBrand.objects.filter(key__in=[brand[0] for brand in BRANDS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0030_beer_brand_catalog"),
    ]

    operations = [
        migrations.RunPython(add_beer_brands, remove_beer_brands),
    ]
