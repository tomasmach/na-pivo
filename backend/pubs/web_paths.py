"""Addresses of the public web pages, shared by every page's header."""

from pubs.beer_pages import PATHS as BEER_PATHS
from pubs.price_map import PATHS as PRICE_PATHS

HOME_PATHS = {"cs": "/", "en": "/en"}
PUBS_PATHS = {"cs": "/hospody", "en": "/en/pubs"}
PUB_PATHS = {"cs": "/hospoda", "en": "/en/pub"}
EVENTS_PATHS = {"cs": "/akce", "en": "/en/events"}
TOURS_PATHS = {"cs": "/trasy", "en": "/en/routes"}


def nav_paths(lang: str) -> dict[str, str]:
    return {
        "home": HOME_PATHS[lang],
        "pubs": PUBS_PATHS[lang],
        "beers": BEER_PATHS[lang],
        "prices": PRICE_PATHS[lang],
        "events": EVENTS_PATHS[lang],
        "tours": TOURS_PATHS[lang],
    }
