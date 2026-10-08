# Hand-written: add the beers people actually write on pub menus to the
# catalog, so autocomplete offers them and every write stores one spelling.
#
# The list comes from the production menus and drink names of October 2026
# (names at least ~6 people or pubs use), proposed independently by two
# reviewers and merged; ambiguous names stay free text. An exact alias match
# rewrites a typed name to the product name on every write, from every app
# version, so aliases are only spellings of that one beer: never a bare brand
# name, never another degree, never nealko/radler/flavour of a different beer.
#
# Existing menus are rewritten separately by `manage.py clean_beer_menus`.
# Drink logs are not touched here or there.

from django.db import migrations

SOURCE_LABEL = "Curated from Na pivo menus"

# key, name, aliases
BRANDS = [
    ("policka", "Polička", []),
    ("hoegaarden", "Hoegaarden", ["Hoegarden"]),
    ("vinohradsky", "Vinohradský pivovar", []),
    ("samson", "Samson", []),
    ("rampusak", "Rampušák", []),
    ("birgo", "Birgo", []),
    ("guinness", "Guinness", ["Guiness"]),
    ("kutna-hora", "Kutná Hora", []),
    ("hauskrecht", "Hauskrecht", []),
    ("argus", "Argus", []),
    ("lucky-bastard", "Lucky Bastard", []),
    ("raven", "Raven", []),
    ("mordyr", "Mordýř", []),
    ("lomnicke", "Lomnické pivo", []),
    ("cvikov", "Cvikov", []),
    ("zlata-labut", "Zlatá labuť", []),
    ("vorkloster", "Vorkloster", []),
    ("bradac", "Bradáč", []),
    ("zvikov", "Zvíkov", []),
    ("turnov", "Turnov", []),
    ("maisels-weisse", "Maisel's Weisse", []),
    ("libertas", "Libertas", []),
    ("hostivar", "Hostivař", []),
    ("falkenstejn", "Falkenštejn", []),
    ("beranek", "Beránek", []),
    ("heineken", "Heineken", []),
    ("corona", "Corona", []),
    ("tri-sestry", "Tři Sestry", []),
    ("elektrarna", "Elektrárna", []),
    ("zewl", "Zewl", []),
    ("beskydsky", "Beskydský pivovárek", []),
    ("proud", "Proud", []),
    ("stella-artois", "Stella Artois", []),
    ("karlovacko", "Karlovačko", []),
    ("desperados", "Desperados", ["Desperado"]),
    ("ozujsko", "Ožujsko", []),
    ("skopsko", "Skopsko", []),
    ("cruzcampo", "Cruzcampo", []),
    ("paulaner", "Paulaner", []),
    ("birra-moretti", "Birra Moretti", []),
    ("mythos", "Mythos", []),
    ("zlaten-dab", "Zlaten Dab", []),
    ("lasko", "Laško", []),
    ("estrella-galicia", "Estrella Galicia", []),
    ("coral", "Coral", []),
    ("messina", "Messina", []),
    ("augustiner", "Augustiner", []),
    ("alhambra", "Alhambra", []),
    ("amstel", "Amstel", []),
]

# brand_key, key, name, aliases. Most used first: the order sets the
# suggestion rank.
PRODUCTS = [
    ("birell", "birell-pomelo-grep", "Birell Pomelo & Grep", ["Birell Pomelo a Grep"]),
    ("holba", "holba-serak-11", "Holba Šerák 11°", ["Holba Šerák", "Šerák", "Šerák 11"]),
    ("policka", "policka-otakar-11", "Polička Otakar 11°", ["Polička 11", "Polička11", "Otakar 11"]),
    ("poutnik", "poutnik-12", "Poutník 12°", ["Poutník světlý ležák – premium 12°"]),
    ("krakonos", "krakonos-12", "Krakonoš 12°", []),
    ("ostravar", "ostravar-mustang-11", "Ostravar Mustang 11°", ["Mustang 11"]),
    ("krusovice", "krusovice-bohem", "Krušovice Bohém", []),
    ("holba", "holba-keprnik-12", "Holba Keprník 12°", ["Holba Keprník", "Keprník 12", "Keprník"]),
    ("gambrinus", "gambrinus-nepasterizovana-11", "Gambrinus Nepasterizovaná 11°", []),
    ("starobrno", "starobrno-statl-12", "Starobrno Štatl 12°", ["Štatl", "Štatl 12°", "Štatl12"]),
    ("svijany", "svijany-450", "Svijany 450", ["Svijanská 450°"]),
    ("dalesice", "dalesice-11", "Dalešice 11°", ["Dalešická 11", "Dalešice Jedenáctka"]),
    ("gambrinus", "gambrinus-nepasterizovana-10", "Gambrinus Nepasterizovaná 10°", []),
    ("staropramen", "staropramen-cool-grep-nealko", "Staropramen Cool Grep Nealko", ["Staropramen Cool Grep"]),
    ("krusovice", "krusovice-nealko", "Krušovice Nealko", []),
    ("platan", "platan-11", "Platan 11°", ["Platan Jedenáctka"]),
    ("ostravar", "ostravar-cerna-barbora", "Ostravar Černá Barbora", ["Černá Barbora"]),
    ("zubr", "zubr-grand-11", "Zubr Grand 11°", ["Zubr Grand"]),
    ("hoegaarden", "hoegaarden-white", "Hoegaarden White", []),
    ("primator", "primator-11", "Primátor 11°", []),
    ("uneticke", "uneticke-12", "Únětické pivo 12°", ["Únětice 12", "Únětická 12"]),
    ("vinohradsky", "vinohradsky-11", "Vinohradská 11°", []),
    ("zubr", "zubr-gold", "Zubr Gold", []),
    ("uneticke", "uneticke-10-7", "Únětické pivo 10,7°", ["Únětice 10,7", "Únětická 10,7"]),
    ("uneticke", "uneticke-10", "Únětické pivo 10°", ["Únětice 10", "Únětická 10"]),
    ("staropramen", "staropramen-nealko", "Staropramen Nealko", []),
    ("budweiser-budvar", "budweiser-budvar-krouzkovany", "Budweiser Budvar Kroužkovaný", ["Budvar Kroužkovaný", "Budvar original kroužkovaný"]),
    ("budweiser-budvar", "budweiser-budvar-nealko", "Budweiser Budvar Nealko", ["Budvar Nealko"]),
    ("bernard", "bernard-free", "Bernard Free", []),
    ("policka", "policka-zavis-12", "Polička Záviš 12°", ["Polička 12"]),
    ("beranek", "beranek-polotmavy-lezak", "Beránek Polotmavý ležák", []),
    ("jezek", "jezek-11", "Ježek 11°", []),
    ("samson", "samson-11", "Samson 11°", []),
    ("rampusak", "rampusak-12", "Rampušák 12°", []),
    ("birgo", "birgo-mango-limetka", "Birgo Mango & Limetka", ["Birgo Mango a limetka"]),
    ("hauskrecht", "hauskrecht-brnenska-11", "Hauskrecht Brněnská 11°", ["Hauskrecht 11"]),
    ("krakonos", "krakonos-11", "Krakonoš 11°", []),
    ("konrad", "konrad-11", "Konrad 11°", []),
    ("guinness", "guinness-draught", "Guinness Draught", []),
    ("bakalar", "bakalar-11", "Bakalář 11°", []),
    ("lomnicke", "lomnicke-summer-ale", "Lomnické pivo Summer Ale", ["Lomnický Summer Ale"]),
    ("rychtar", "rychtar-11", "Rychtář 11°", []),
    ("bernard", "bernard-cerna-12", "Bernard Černá 12°", []),
    ("bernard", "bernard-free-grep", "Bernard Free Grep", ["Bernard s čistou hlavou Grep"]),
    ("bernard", "bernard-free-svestka", "Bernard Free Švestka", []),
    ("staropramen", "staropramen-extra-chmel", "Staropramen Extra Chmel", []),
    ("ostravar", "ostravar-12", "Ostravar 12°", []),
    ("gambrinus", "gambrinus-legenda-nefiltrovany-lezak", "Gambrinus Legenda Nefiltrovaný ležák", []),
    ("budweiser-budvar", "budweiser-budvar-redix", "Budweiser Budvar Redix", ["Budvar Redix"]),
    ("bernard", "bernard-nefiltrovana-12", "Bernard Nefiltrovaná 12°", []),
    ("poutnik", "poutnik-11", "Poutník 11°", ["Poutník světlý ležák 11°"]),
    ("pernstejn", "pernstejn-horka-12-ze-sklepa", "Pernštejn Hořká 12° ze sklepa", []),
    ("pernstejn", "pernstejn-arnostova-horka-10", "Pernštejn Arnoštova hořká 10°", []),
    ("pernstejn", "pernstejn-vilem-11", "Pernštejn Vilém 11°", ["Vilém 11"]),
    ("lobkowicz", "lobkowicz-premium-nealko", "Lobkowicz Premium Nealko", []),
    ("kutna-hora", "kutna-hora-zlata-12", "Kutná Hora Zlatá 12°", []),
    ("krusovice", "krusovice-original-10", "Krušovice Originál 10°", []),
    ("rohozec", "rohozec-11", "Rohozec 11°", []),
    ("regent", "regent-11", "Regent 11°", ["Bohemia Regent 11°"]),
    ("zewl", "zewl-12", "Zewl 12°", []),
    ("rychtar", "rychtar-grunt-11", "Rychtář Grunt 11°", []),
    ("nachmelena-opice", "nachmelena-opice-11", "Nachmelená Opice 11°", []),
    ("litovel", "litovel-moravan", "Litovel Moravan", []),
    ("samson", "samson-12", "Samson 12°", []),
    ("rebel", "rebel-11", "Rebel 11°", []),
    ("gambrinus", "gambrinus-nefiltrovany-12", "Gambrinus Nefiltrovaný 12°", ["Gambrinus 12° nefiltr", "Gambrinus Nefiltr 12°"]),
    ("cvikov", "cvikov-klic-12", "Cvikov Klíč 12°", ["Klíč 12"]),
    ("hubertus", "hubertus-11", "Hubertus 11°", []),
    ("argus", "argus-12", "Argus 12°", []),
    ("velkopopovicky-kozel", "velkopopovicky-kozel-rezany", "Velkopopovický Kozel Řezaný", ["Kozel Řezaný"]),
    ("platan", "platan-starka", "Platan Starka", []),
    ("matuska", "matuska-california", "Matuška California", []),
    ("lucky-bastard", "lucky-bastard-blond-11", "Lucky Bastard Blond 11°", []),
    ("zlatopramen", "zlatopramen-radler-tmavy-citron", "Zlatopramen Radler Tmavý citron", []),
    ("svijany", "svijany-vozka", "Svijany Vozka", []),
    ("staropramen", "staropramen-nefiltr", "Staropramen Nefiltr", []),
    ("rohozec", "rohozec-cherry", "Rohozec Cherry", []),
    ("pernstejn", "pernstejn-12", "Pernštejn 12°", []),
    ("ostravar", "ostravar-mustang-12-horky", "Ostravar Mustang Hořký 12°", ["Ostravar Mustang 12 Hořký"]),
    ("samson", "samson-12-nefiltr", "Samson Nefiltrovaný 12°", ["Samson 12 nefiltr"]),
    ("rychtar", "rychtar-12", "Rychtář 12°", []),
    ("raven", "raven-12", "Raven 12°", []),
    ("rampusak", "rampusak-11", "Rampušák 11°", []),
    ("primator", "primator-tchyne", "Primátor Tchyně", []),
    ("dudak", "dudak-11", "Dudák 11°", []),
    ("heineken", "heineken-original", "Heineken Original", []),
    ("corona", "corona-extra", "Corona Extra", []),
    ("svijany", "svijany-knezna-13", "Svijanská Kněžna 13°", ["Svijany Kněžna 13"]),
    ("svijany", "svijany-vozka-yuzu-bergamot", "Svijany Vozka Yuzu & Bergamot", []),
    ("master", "master-tmavy-18", "Master Tmavý 18°", []),
    ("krusovice", "krusovice-psenicne", "Krušovice Pšeničné", []),
    ("bakalar", "bakalar-12", "Bakalář 12°", []),
    ("lomnicke", "lomnicke-12", "Lomnické pivo 12°", ["Lomnická 12"]),
    ("tri-sestry", "tri-sestry-lezak", "Tři Sestry Ležák", []),
    ("svijany", "svijany-desitka-10", "Svijanská Desítka 10°", ["Svijany Desítka 10"]),
    ("rebel", "rebel-original-premium", "Rebel Original Premium", []),
    ("radegast", "radegast-nefiltrovana-12", "Radegast Nefiltrovaná 12°", []),
    ("policka", "policka-hradebni-10", "Polička Hradební 10°", []),
    ("pernstejn", "pernstejn-10", "Pernštejn 10°", []),
    ("nachmelena-opice", "nachmelena-opice-ipa-14", "Nachmelená Opice IPA 14°", []),
    ("mordyr", "mordyr-11", "Mordýř 11°", []),
    ("krakonos", "krakonos-10", "Krakonoš 10°", []),
    ("holba", "holba-ryzi-nealko", "Holba Ryzí nealko", []),
    ("excelent", "excelent-11", "Excelent 11°", []),
    ("chotebor", "chotebor-premium-12", "Chotěboř Premium 12°", []),
    ("chotebor", "chotebor-12", "Chotěboř 12°", []),
    ("bernard", "bernard-jantarova-12", "Bernard Jantarová 12°", []),
    ("bakalar", "bakalar-10", "Bakalář 10°", []),
    ("argus", "argus-11", "Argus 11°", []),
    ("argus", "argus-10", "Argus 10°", []),
    ("beranek", "beranek-weizenbier", "Beránek Weizenbier", []),
    ("pilsner-urquell", "pilsner-urquell-nefiltrovany", "Pilsner Urquell Nefiltrovaný", ["Pilsner Urquell - nefiltr"]),
    ("zlata-labut", "zlata-labut-11", "Zlatá labuť 11°", []),
    ("vorkloster", "vorkloster-klasterni-10", "Vorkloster Klášterní 10°", []),
    ("rebel", "rebel-horka-11", "Rebel Hořká 11°", []),
    ("rebel", "rebel-12", "Rebel 12°", []),
    ("ostravar", "ostravar-10-vycepni", "Ostravar Výčepní 10°", ["Ostravar 10 Výčepní"]),
    ("litovel", "litovel-visen", "Litovel Višeň", []),
    ("krakonos", "krakonos-10-tmave", "Krakonoš Tmavé 10°", ["Krakonoš 10 tmavé"]),
    ("ferdinand", "ferdinand-max-11", "Ferdinand Max 11°", []),
    ("dalesice", "dalesice-12", "Dalešice 12°", []),
    ("cerna-hora", "cerna-hora-pater", "Černá Hora Páter", []),
    ("budweiser-budvar", "budweiser-budvar-vycepni", "Budweiser Budvar Výčepní", ["Budvar Výčepní"]),
    ("bradac", "bradac-12", "Bradáč 12°", []),
    ("argus", "argus-maestic-12", "Argus Maestic 12°", []),
    ("elektrarna", "elektrarna-nefiltrovany-11", "Elektrárna Nefiltrovaný 11°", ["Elektrárna 11° nefiltr"]),
    ("beskydsky", "beskydsky-lezak", "Beskydský pivovárek Ležák", ["Beskydský Ležák"]),
    ("lobkowicz", "lobkowicz-demon-13", "Lobkowicz Démon 13°", []),
    ("zvikov", "zvikov-rarasek", "Zvíkovský Rarášek", []),
    ("urpiner", "urpiner-12", "Urpiner 12°", []),
    ("regent", "regent-12", "Regent 12°", []),
    ("maisels-weisse", "maisels-weisse-original", "Maisel's Weisse Original", []),
    ("lucky-bastard", "lucky-bastard-rocker-12", "Lucky Bastard Rocker 12°", []),
    ("litovel", "litovel-gustav-13", "Litovel Gustav 13°", []),
    ("litovel", "litovel-cerny-citron", "Litovel Černý citron", []),
    ("litovel", "litovel-11", "Litovel 11°", []),
    ("libertas", "libertas-12", "Libertas 12°", []),
    ("dudak", "dudak-klostermann-polotmavy", "Dudák Klostermann Polotmavý", []),
    ("hostivar", "hostivar-11", "Hostivař 11°", []),
    ("holba", "holba-10", "Holba 10°", []),
    ("hoegaarden", "hoegaarden-rose", "Hoegaarden Rosé", []),
    ("falkenstejn", "falkenstejn-11", "Falkenštejn 11°", []),
    ("cvikov", "cvikov-hvozd-11", "Cvikov Hvozd 11°", []),
    ("chotebor", "chotebor-11", "Chotěboř 11°", []),
    ("chodovar", "chodovar-11", "Chodovar 11°", []),
    ("cerna-hora", "cerna-hora-horka-11", "Černá Hora Hořká 11°", []),
    ("bernard", "bernard-cerna-lavina", "Bernard Černá lavina", []),
    ("postrizinske", "postrizinske-jedenactka", "Postřižinské pivo Jedenáctka", []),
]

# Spellings of beers and brands already in the catalog.
PRODUCT_ALIASES = {
    "pilsner-urquell": ["Pilsner Urquell 12", "Pilsner Urquell světlý ležák", "Pilsner Urquell ležák", "Pilsner Urquel", "Pilsner Urqell", "Pillsner Urquel", "Plzeňský Prazdroj"],
    "radegast-ryze-horka-12": ["Radegast Ryze hořká 12"],
    "budweiser-budvar-original": ["Budvar 12"],
    "budweiser-budvar-33": ["Budvar 33 světlý ležák"],
    "krusovice-12": ["Krušovice Ležák 12"],
    "bernard-11": ["Bernard 11 světlé"],
    "svijany-maz-11": ["Svijany Máz 11"],
}
BRAND_ALIASES = {
    "hubertus": ["Kácov"],
    "postrizinske": ["Postřižiny"],
}

def expand_catalog(apps, schema_editor):
    BeerBrand = apps.get_model("pubs", "BeerBrand")
    BeerProduct = apps.get_model("pubs", "BeerProduct")

    for index, (key, name, aliases) in enumerate(BRANDS):
        BeerBrand.objects.update_or_create(
            key=key,
            defaults={
                "name": name,
                "aliases": aliases,
                "rank": 800 + index * 10,
                "source_label": SOURCE_LABEL,
                "source_url": "",
                "active": True,
            },
        )

    brands = {brand.key: brand for brand in BeerBrand.objects.all()}
    for index, (brand_key, key, name, aliases) in enumerate(PRODUCTS):
        brand = brands.get(brand_key)
        if brand is None:
            # Only a database emptied after the earlier catalog seeds (tests).
            continue
        BeerProduct.objects.update_or_create(
            key=key,
            defaults={
                "brand": brand,
                "brand_key": brand.key,
                "brand_name": brand.name,
                "name": name,
                "aliases": aliases,
                "rank": 400 + index * 5,
                "source_label": SOURCE_LABEL,
                "source_url": "",
                "active": True,
            },
        )

    for model, extra_aliases in ((BeerProduct, PRODUCT_ALIASES), (BeerBrand, BRAND_ALIASES)):
        for key, extra in extra_aliases.items():
            entity = model.objects.filter(key=key).first()
            if entity is None:
                continue
            entity.aliases = list(dict.fromkeys([*(entity.aliases or []), *extra]))
            entity.save(update_fields=["aliases", "updated_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0154_transit_feed"),
    ]

    operations = [
        migrations.RunPython(expand_catalog, migrations.RunPython.noop),
    ]
