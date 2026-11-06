"""Names of places as people say them: the town and not its post office, Prague in English."""

from __future__ import annotations

import re

from django.utils import translation

# Geocoders name the post office: "Louny 1" is in Louny. In Prague and Plzeň the number is the district.
_POST_OFFICE = re.compile(r"^(\D*\S)\s+\d{1,2}$")
_NUMBERED_DISTRICTS = ("Praha", "Plzeň")
_ENGLISH = {"Praha": "Prague", "Plzeň": "Pilsen"}

# Czech bends town names after "v", so the towns people search for most have theirs written out.
_IN = {
    "Praha": "v Praze", "Brno": "v Brně", "Ostrava": "v Ostravě", "Plzeň": "v Plzni", "Liberec": "v Liberci",
    "Olomouc": "v Olomouci", "České Budějovice": "v Českých Budějovicích", "Hradec Králové": "v Hradci Králové",
    "Ústí nad Labem": "v Ústí nad Labem", "Pardubice": "v Pardubicích", "Zlín": "ve Zlíně", "Havířov": "v Havířově",
    "Kladno": "v Kladně", "Most": "v Mostě", "Opava": "v Opavě", "Frýdek-Místek": "ve Frýdku-Místku",
    "Jihlava": "v Jihlavě", "Karviná": "v Karviné", "Teplice": "v Teplicích", "Děčín": "v Děčíně",
    "Karlovy Vary": "v Karlových Varech", "Chomutov": "v Chomutově", "Jablonec nad Nisou": "v Jablonci nad Nisou",
    "Mladá Boleslav": "v Mladé Boleslavi", "Prostějov": "v Prostějově", "Přerov": "v Přerově",
    "Česká Lípa": "v České Lípě", "Třebíč": "v Třebíči", "Třinec": "v Třinci", "Tábor": "v Táboře",
    "Znojmo": "ve Znojmě", "Kolín": "v Kolíně", "Příbram": "v Příbrami", "Cheb": "v Chebu", "Písek": "v Písku",
    "Trutnov": "v Trutnově", "Kroměříž": "v Kroměříži", "Vsetín": "ve Vsetíně", "Šumperk": "v Šumperku",
    "Uherské Hradiště": "v Uherském Hradišti", "Břeclav": "v Břeclavi", "Hodonín": "v Hodoníně",
    "Litoměřice": "v Litoměřicích", "Nový Jičín": "v Novém Jičíně", "Chrudim": "v Chrudimi",
    "Havlíčkův Brod": "v Havlíčkově Brodě", "Sokolov": "v Sokolově", "Strakonice": "ve Strakonicích",
    "Klatovy": "v Klatovech", "Jindřichův Hradec": "v Jindřichově Hradci", "Kutná Hora": "v Kutné Hoře",
    "Beroun": "v Berouně", "Louny": "v Lounech", "Žďár nad Sázavou": "ve Žďáru nad Sázavou", "Mělník": "v Mělníku",
    "Telč": "v Telči", "Český Krumlov": "v Českém Krumlově", "Benešov": "v Benešově", "Rakovník": "v Rakovníku",
    "Náchod": "v Náchodě", "Vyškov": "ve Vyškově", "Žatec": "v Žatci", "Jičín": "v Jičíně",
    "Domažlice": "v Domažlicích", "Rokycany": "v Rokycanech", "Mikulov": "v Mikulově", "Třeboň": "v Třeboni",
    "Poděbrady": "v Poděbradech", "Bratislava": "v Bratislavě", "Košice": "v Košicích",
}


def municipality(name: str) -> str:
    """The town behind a post office name: "Louny 1" is Louny, "Praha 7" stays a district."""

    name = " ".join((name or "").split())
    match = _POST_OFFICE.match(name)
    if match and match.group(1) not in _NUMBERED_DISTRICTS:
        return match.group(1)
    return name


def _english(name: str) -> str:
    base, _, rest = name.partition(" ")
    if base in _ENGLISH and (not rest or rest.isdigit()):
        return " ".join(part for part in (_ENGLISH[base], rest) if part)
    return name


def place_name(name: str) -> str:
    """How the page names a town or a Prague district in the language it speaks."""

    name = municipality(name)
    return _english(name) if translation.get_language() == "en" else name


def in_place(name: str) -> str:
    """"v Praze", "v Praze 7", "in Pilsen"; empty when Czech has no written form for the town."""

    name = municipality(name)
    if translation.get_language() == "en":
        return f"in {_english(name)}"
    base, _, rest = name.partition(" ")
    if base in _NUMBERED_DISTRICTS and rest.isdigit():
        return f"{_IN[base]} {rest}"
    return _IN.get(name, "")
