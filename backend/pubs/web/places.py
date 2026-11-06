"""Names of places and pubs as people say them: the town and not its post office, Prague in English, a pub without its register code."""

from __future__ import annotations

import re
import unicodedata

from django.utils import translation
from django.utils.translation import gettext

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


# Catalogue names that are a business record, not what the sign says.
_REGISTER_CODE = re.compile(r"^[A-Z]{0,3}\d{3,}\s*[-–:]\s*")
_LEGAL_FORM = re.compile(
    r"(,\s*ul\..*|,?\s+(s\.\s?r\.\s?o\.|spol\.\s?s\s?r\.\s?o\.|a\.\s?s\.|v\.\s?o\.\s?s\.|z\.\s?s\.))$",
    re.IGNORECASE,
)
_PLACEHOLDERS = {"nazev upresnim", "nazev", "bez nazvu", "neznamy", "nevim", "test"}


def _clean_pub_name(name: str) -> str:
    clean = _LEGAL_FORM.sub("", _REGISTER_CODE.sub("", " ".join((name or "").split()))).strip(" ,-–")
    folded = " ".join(re.findall(r"[a-z0-9]+", unicodedata.normalize("NFKD", clean).encode("ascii", "ignore").decode().casefold()))
    return "" if folded in _PLACEHOLDERS else clean


def has_pub_name(name: str) -> bool:
    return bool(_clean_pub_name(name))


def pub_name(name: str) -> str:
    """What every page shows for a pub: "P5342 - Chrudim pivovar, ul.Obc.Ležáků" is Chrudim pivovar.

    Only for showing; addresses, keys and links to the app keep the stored name.
    """

    return _clean_pub_name(name) or gettext("Hospoda bez jména")
