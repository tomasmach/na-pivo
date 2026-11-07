from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta

import pytest
from django.utils import timezone

from pubs.enrichment.matcher import geohash8
from pubs.models import (
    Account,
    BeerCheckIn,
    CanonicalPub,
    PubAlias,
    PubCommunityData,
    PubDirectory,
    PubHours,
    PubPriceIndex,
    PubReport,
)
from pubs.web import pubs_data, pubs_views
from pubs.web.pubs_views import sitemap_paths

pytestmark = pytest.mark.django_db

PRAGUE = pubs_data.PRAGUE
TIGER = (50.0875, 14.4213)
ALWAYS = {day: [["00:00", "24:00"]] for day in pubs_data.DAY_KEYS}


def _pub(name="U Zlatého tygra", lat=TIGER[0], lng=TIGER[1], city="Praha 1", **extra) -> PubDirectory:
    extra.setdefault("venue_kind", PubHours.VenueKind.PUB)
    return PubDirectory.objects.create(
        name=name, lat=lat, lng=lng, city=city, country="cz", source="test", refreshed_at=timezone.now(), **extra,
    )


def _menu(pub: PubDirectory, beers=None, hours=None) -> PubCommunityData:
    return PubCommunityData.objects.create(
        cache_key=pub.cache_key, name=pub.name, lat=pub.lat, lng=pub.lng, city=pub.city,
        beers=beers if beers is not None else [{"name": "Pilsner Urquell 12° tankové", "price_czk": 59, "volume_ml": 500}],
        hours_json=hours, beers_updated_at=timezone.now(),
    )


def _price(pub: PubDirectory, price: int, volume: int = 500) -> None:
    PubPriceIndex.objects.create(
        cache_key=pub.cache_key, name=pub.name, lat=pub.lat, lng=pub.lng, city=pub.city, price_czk=price,
        volume_ml=volume, observed_at=timezone.now(), source=PubPriceIndex.Source.COMMUNITY,
    )


def _rater(index: int) -> Account:
    return Account.objects.create(
        device_id=f"rater-{index}", nickname=f"Rater{index}", ugc_terms_accepted_at=timezone.now()
    )


def _rate(pub: PubDirectory, account: Account, rating: float, note: str = "", visibility="public") -> None:
    BeerCheckIn.objects.create(
        account=account, client_id=uuid.uuid4(), beer_name="Pilsner Urquell 12°", beer_key="pilsner-urquell-12",
        rating=rating, note=note, pub_cache_key=pub.cache_key, pub_name=pub.name, visibility=visibility,
        checked_in_at=timezone.now() - timedelta(days=2),
    )


def _listed(client, path: str) -> list[str]:
    html = client.get(path).content.decode()
    return re.findall(r'<span class="np-pubrow__name">([^<]+)</span>', html)


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    """3. 11. 2026 is a Tuesday; day 0 is the Monday before it."""

    return datetime(2026, 11, 2 + day, hour, minute, tzinfo=PRAGUE)


# ---------- opening hours ----------


def test_open_state_reads_spans_after_midnight_and_the_next_opening():
    week = pubs_data.valid_hours({
        "mo": [["15:00", "02:00"]], "tu": [], "we": [["11:00", "23:00"]], "th": [], "fr": [], "sa": [], "su": [],
    })

    late_monday = pubs_data.open_state(week, _at(1, 1, 30))
    assert late_monday["open"] and late_monday["until"] == _at(1, 2)

    tuesday = pubs_data.open_state(week, _at(1, 12))
    assert not tuesday["open"] and tuesday["opens"] == _at(2, 11)


def test_open_state_joins_back_to_back_spans_and_rejects_broken_hours():
    week = pubs_data.valid_hours({**{day: [] for day in pubs_data.DAY_KEYS}, "fr": [["18:00", "24:00"]], "sa": [["00:00", "03:00"]]})
    assert pubs_data.open_state(week, _at(4, 23))["until"] == _at(5, 3)

    assert pubs_data.valid_hours({"mo": [["25:00", "26:00"]]}) is None
    assert pubs_data.valid_hours({day: [] for day in pubs_data.DAY_KEYS}) is None
    assert pubs_data.open_state(None) is None


# ---------- /hospody, /hospody/<město> ----------


def test_city_page_lists_pubs_with_price_tap_and_rating(client):
    tiger = _pub()
    _menu(tiger, hours=ALWAYS)
    _price(tiger, 59)
    raters = [_rater(index) for index in range(3)]
    for account, rating in zip(raters, (4, 5, 4.5), strict=True):
        _rate(tiger, account, rating)
    _pub("Lokál Dlouhááá", lat=50.0903, lng=14.4255, city="Praha 1")
    _pub("U Medvídků", lat=50.0833, lng=14.4185, city="Praha 1")
    _pub("Pivnice Pegas", lat=49.1950, lng=16.6080, city="Brno-střed")

    response = client.get("/hospody/praha")

    html = response.content.decode()
    assert response.status_code == 200
    assert "Hospody v Praze" in html
    assert _listed(client, "/hospody/praha") == ["U Zlatého tygra", "Lokál Dlouhááá", "U Medvídků"]
    assert "59 Kč" in html and "Pilsner Urquell 12° tankové" in html and "4,5" in html
    assert "otevřeno do 24:00" in html
    assert f'href="/hospoda/u-zlateho-tygra-{tiger.cache_key}"' in html
    assert '<link rel="canonical" href="https://na-pivo.cz/hospody/praha">' in html
    assert '"@type": "ItemList"' in html
    # The map is drawn here, with nothing loaded from other hosts.
    assert 'class="np-map__svg"' in html and "googleapis" not in html


def test_city_filters_narrow_the_list(client):
    cheap = _pub("Levná", lat=50.0801, lng=14.4401, city="Praha 2 - Vinohrady")
    _menu(cheap, beers=[{"name": "Kozel 11°", "price_czk": 45, "volume_ml": 500}], hours=ALWAYS)
    _price(cheap, 45)
    dear = _pub("Drahá", lat=50.0901, lng=14.4101, city="Praha 1")
    _menu(dear, beers=[{"name": "Pilsner Urquell 12° tankové", "price_czk": 69, "volume_ml": 500}])
    _price(dear, 69)

    assert _listed(client, "/hospody/praha?open=1") == ["Levná"]
    assert _listed(client, "/hospody/praha?max55=1") == ["Levná"]
    assert _listed(client, "/hospody/praha?tank=1") == ["Drahá"]
    assert _listed(client, "/hospody/praha-2") == ["Levná"]
    assert _listed(client, "/hospody/praha?sort=price") == ["Levná", "Drahá"]
    nothing = client.get("/hospody/praha?open=1&tank=1").content.decode()
    assert "Takovou hospodu tu nemám" in nothing


def test_city_list_loads_more_by_page(client):
    for index in range(25):
        _pub(f"Hospoda {index:02d}", lat=50.08 + index / 1000, lng=14.42, city="Praha")

    first = client.get("/hospody/praha").content.decode()
    assert first.count('class="np-pubrow"') == 20 and 'href="?page=2#h21" data-more' in first
    # Only its own pubs, so the page can be its own canonical; the script appends it under page 1.
    second = client.get("/hospody/praha?page=2").content.decode()
    assert second.count('class="np-pubrow"') == 5 and 'id="h21"' in second and "Načíst další" not in second
    assert "25 z 25" in second


def test_city_list_builds_rows_only_for_the_pubs_it_shows(client, monkeypatch):
    from pubs.web import pubs_views

    for index in range(60):
        _pub(f"Hospoda {index:02d}", lat=50.08 + index / 1000, lng=14.42, city="Praha")
    built = []
    real = pubs_views._pub_row
    monkeypatch.setattr(pubs_views, "_pub_row", lambda pub, *args: built.append(pub["key"]) or real(pub, *args))

    page = client.get("/hospody/praha").content.decode()

    assert page.count('class="np-pubrow"') == 20 and "z 60" in page
    # The page and the 20 best of the structured list, not all 60.
    assert len(built) == 40


def test_unknown_city_is_404_with_other_cities(client):
    _pub()

    response = client.get("/hospody/atlantida")

    assert response.status_code == 404
    assert "Tohle město neznám" in response.content.decode()
    assert 'href="/hospody/praha"' in response.content.decode()


def test_city_index_and_english_pages(client):
    _pub()
    _pub("Pivnice Pegas", lat=49.1950, lng=16.6080, city="Brno-střed")

    html = client.get("/hospody").content.decode()
    assert 'href="/hospody/praha"' in html and 'href="/hospody/brno"' in html

    english = client.get("/en/pubs/praha").content.decode()
    assert "Pubs in Prague" in english and 'href="/en/pub/u-zlateho-tygra-' in english
    assert "Hospody v Praze" not in english


def test_more_cities_follow_the_czech_alphabet():
    names = ["Žatec", "Ústí nad Labem", "Chomutov", "Senica", "Česká Lípa", "Zlín", "Hodonín", "Cheb", "Šaľa", "Cvikov", "Uherský Brod"]

    groups = pubs_views._by_letter([{"label": name} for name in names])

    assert [(group["letter"], [city["label"] for city in group["cities"]]) for group in groups] == [
        ("C", ["Cvikov"]), ("Č", ["Česká Lípa"]), ("H", ["Hodonín"]), ("Ch", ["Cheb", "Chomutov"]),
        ("S", ["Senica"]), ("Š", ["Šaľa"]), ("U", ["Uherský Brod", "Ústí nad Labem"]), ("Z", ["Zlín"]), ("Ž", ["Žatec"]),
    ]


def test_reported_pub_needs_a_quorum_to_disappear(client, settings):
    settings.PUB_REPORT_GLOBAL_HIDE_THRESHOLD = 2
    tiger = _pub()
    _menu(tiger)  # community data must not bring a hidden pub back
    key = f"/hospoda/u-zlateho-tygra-{tiger.cache_key}"
    old = timezone.now() - timedelta(days=60)
    reporters = [Account.objects.create(device_id=f"reporter-{index}") for index in range(2)]
    Account.objects.filter(pk__in=[r.pk for r in reporters]).update(quorum_trusted_at=old)

    PubReport.objects.create(account=reporters[0], cache_key=tiger.cache_key, reason="closed", name=tiger.name, lat=tiger.lat, lng=tiger.lng)
    assert client.get(key).status_code == 200

    from django.core.cache import cache

    cache.clear()
    PubReport.objects.create(account=reporters[1], cache_key=tiger.cache_key, reason="closed", name=tiger.name, lat=tiger.lat, lng=tiger.lng)
    assert client.get(key).status_code == 404


# ---------- /hospoda/<klíč> ----------


def test_pub_page_shows_community_data_without_who_was_there(client):
    tiger = _pub()
    _menu(tiger, hours={**ALWAYS, "su": []})
    _price(tiger, 59)
    PubHours.objects.create(cache_key=tiger.cache_key, name=tiger.name, lat=tiger.lat, lng=tiger.lng, rating_value=4.9, rating_count=1234)
    raters = [_rater(index) for index in range(3)]
    for account in raters:
        _rate(tiger, account, 4, note="Pěna jak má být")
    hidden = _rater(9)
    _rate(tiger, hidden, 1, visibility="private")

    response = client.get(f"/hospoda/u-zlateho-tygra-{tiger.cache_key}")

    html = response.content.decode()
    assert response.status_code == 200
    assert "<h1 class=\"np-pub-h1\">U Zlatého tygra</h1>" in html
    assert "Pilsner Urquell 12° tankové" in html and "59 Kč" in html
    assert "00:00–24:00" in html and "Zavřeno" in html
    assert "„Pěna jak má být“" in html and "4,0" in html
    assert f'href="napivo://h/{tiger.cache_key}?n=U+Zlat%C3%A9ho+tygra"' in html
    # Nobody's name, the Firmy.cz rating or the private rating leaks out.
    for leak in ("Rater0", "Rater9", "4,9", "1234", "1,0"):
        assert leak not in html
    data = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', html).group(1))
    place = next(item for item in data["@graph"] if item["@type"] == "BarOrPub")
    assert place["name"] == "U Zlatého tygra" and len(place["openingHoursSpecification"]) == 6
    assert re.search(r'<meta property="og:image" content="https://na-pivo.cz/hospoda/u-zlateho-tygra-\w+/og.png\?v=\w+">', html)


def test_cheapest_beer_follows_the_menu_on_the_page(client):
    # A beer logged with a price lowered the menu, while the index kept the older menu price.
    kalich = _pub("Hostinec U Kalicha")
    _menu(kalich, beers=[
        {"name": "Starobrno 11°", "price_czk": 30, "volume_ml": 300},
        {"name": "Svijanský Máz 11°", "price_czk": 59, "volume_ml": 500},
        {"name": "Velkopopovický Kozel 11°", "price_czk": 45, "volume_ml": 500},
    ])
    _price(kalich, 59)

    html = client.get(f"/hospoda/hostinec-u-kalicha-{kalich.cache_key}").content.decode()

    assert re.search(r">45\u00a0Kč</span><span [^>]+>nejlevnější pivo, 0,5\u00a0l<", html)
    assert "3\u00a0piva od 45 Kč" in html
    og = pubs_views._og_payload(pubs_data.find_pub(f"hostinec-u-kalicha-{kalich.cache_key}")["pub"], "cs")
    assert (og["price"], og["price_beer"]) == (45, "Velkopopovický Kozel 11°")


def test_pub_rating_needs_three_people(client):
    tiger = _pub()
    account = _rater(1)
    for _ in range(4):
        _rate(tiger, account, 5)

    html = client.get(f"/hospoda/u-zlateho-tygra-{tiger.cache_key}").content.decode()

    assert "Hodnocení piv" not in html and "5,0" not in html


def test_pub_address_forms_redirect_to_the_canonical_one(client):
    tiger = _pub()
    canonical = f"/hospoda/u-zlateho-tygra-{tiger.cache_key}"

    for old in (f"/hospoda/{tiger.cache_key}", f"/hospoda/stary-nazev-{tiger.cache_key}", f"/hospoda/{tiger.cache_key.upper()}"):
        response = client.get(old)
        assert response.status_code == 301 and response["Location"] == canonical
    assert client.get("/en/pub/x-" + tiger.cache_key)["Location"] == f"/en/pub/u-zlateho-tygra-{tiger.cache_key}"
    assert client.get("/hospoda/nic").status_code == 404
    assert client.get("/hospoda/u-zlateho-tygra-aaaaaaaa").status_code == 404


def test_merged_duplicate_redirects_to_the_pub_it_joined(client):
    tiger = _pub()
    canonical = CanonicalPub.objects.create(cache_key=tiger.cache_key, name=tiger.name, lat=tiger.lat, lng=tiger.lng)
    old_key = geohash8(50.0901, 14.4301)
    PubAlias.objects.create(canonical_pub=canonical, cache_key=old_key, name="Tygr", lat=50.0901, lng=14.4301)

    response = client.get(f"/hospoda/tygr-{old_key}")

    assert response.status_code == 301
    assert response["Location"] == f"/hospoda/u-zlateho-tygra-{tiger.cache_key}"


def test_pub_without_data_still_has_a_page(client):
    tiger = _pub()

    html = client.get(f"/hospoda/u-zlateho-tygra-{tiger.cache_key}").content.decode()

    assert "Co tu čepují, zatím nevím." in html and "Otevírací doba" not in html


def test_pub_share_image_is_a_cached_png(client, django_assert_max_num_queries):
    tiger = _pub()
    _menu(tiger)
    _price(tiger, 59)
    path = f"/hospoda/u-zlateho-tygra-{tiger.cache_key}/og.png"

    response = client.get(path)

    assert response.status_code == 200 and response["Content-Type"] == "image/png"
    assert response.content[:8] == b"\x89PNG\r\n\x1a\n"
    from io import BytesIO

    from PIL import Image

    assert Image.open(BytesIO(response.content)).size == (1200, 630)
    with django_assert_max_num_queries(4):
        assert client.get(path).content == response.content
    assert client.get(f"/en/pub/u-zlateho-tygra-{tiger.cache_key}/og.png").status_code == 200


def test_long_pub_name_fits_the_share_image():
    from pubs.web.pubs_og import render_pub_og

    image = render_pub_og({
        "name": "Restaurace a pivnice U Dvou Koček a jednoho velice dlouhého jména", "place": "Praha 1",
        "rating": 4.3, "price": None, "price_beer": "", "tank": False, "beers": 0, "week_beers": None,
        "address": "na-pivo.cz/hospoda/x", "lang": "cs",
    })

    assert image[:8] == b"\x89PNG\r\n\x1a\n"


# ---------- /h/<geohash> from released apps ----------


def test_app_share_link_leads_to_the_pub_page(client):
    _pub("Alfa")
    beta = _pub("Beta")

    response = client.get(f"/h/{beta.cache_key}?n=beta")
    assert response.status_code == 301 and response["Location"] == f"/hospoda/beta-{beta.cache_key}"

    english = client.get(f"/h/{beta.cache_key}?n=Beta", HTTP_ACCEPT_LANGUAGE="en")
    assert english["Location"] == f"/en/pub/beta-{beta.cache_key}"


@pytest.mark.parametrize("key", ["nope", "u2fkbnhu1", "aaaaaaaa"])
def test_app_share_link_to_an_unknown_cell_is_404(client, key):
    response = client.get(f"/h/{key}")

    assert response.status_code == 404
    assert "Tuhle hospodu neznám" in response.content.decode()


def test_app_share_link_to_a_place_that_is_not_a_pub_is_404(client):
    place = _pub(venue_kind=PubHours.VenueKind.NOT_PUB)

    assert client.get(f"/h/{place.cache_key}").status_code == 404


def test_pub_pages_are_throttled(client, monkeypatch):
    from pubs.api.throttling import SharedScopedRateThrottle

    monkeypatch.setattr(
        SharedScopedRateThrottle, "THROTTLE_RATES", {**SharedScopedRateThrottle.THROTTLE_RATES, "web_pages": "2/min"}
    )
    tiger = _pub()

    statuses = [client.get(f"/hospoda/u-zlateho-tygra-{tiger.cache_key}").status_code for _ in range(3)]

    assert statuses == [200, 200, 429]


# ---------- /hledat ----------


def test_search_ignores_accents_and_finds_pubs_beers_and_cities(client):
    _pub()
    _pub("Na Spilce", lat=49.7470, lng=13.3770, city="Plzeň")

    pubs = client.get("/hledat?q=zlateho tygra").content.decode()
    assert "U Zlatého tygra" in pubs and "1\u00a0výsledek" in pubs

    city = client.get("/hledat?q=plzen").content.decode()
    assert "Na Spilce" in city and 'href="/hospody/plzen"' in city

    beer = client.get("/hledat?q=pilsner").content.decode()
    assert "Pilsner Urquell" in beer
    assert 'name="robots"' not in beer and "noindex" in client.get("/hledat?q=pilsner")["X-Robots-Tag"]


def test_search_without_results_suggests_similar_names(client):
    _pub("Pivnice U Bobra", lat=50.0700, lng=14.4600, city="Praha 10 - Vršovice")

    html = client.get("/hledat?q=u vousatýho bobra").content.decode()

    assert "Tuhle hospodu ještě neznáme" in html
    assert "Nemyslel jsi náhodou" in html and "Pivnice U Bobra" in html


def test_empty_search_shows_the_form(client):
    response = client.get("/hledat")

    assert response.status_code == 200 and 'id="np-search-page"' in response.content.decode()


def test_search_is_throttled(client, monkeypatch):
    from pubs.api.throttling import SharedScopedRateThrottle

    monkeypatch.setattr(
        SharedScopedRateThrottle, "THROTTLE_RATES", {**SharedScopedRateThrottle.THROTTLE_RATES, "web_search": "2/min"}
    )

    statuses = [client.get(f"/hledat?q=pivo{index}").status_code for index in range(3)]

    assert statuses == [200, 200, 429]


# ---------- cost of a visit ----------


def test_pages_stay_cheap_once_cached(client, django_assert_max_num_queries):
    for index in range(30):
        pub = _pub(f"Hospoda {index}", lat=50.08 + index / 1000, lng=14.42, city="Praha 1")
        _menu(pub, hours=ALWAYS)
        _price(pub, 40 + index)
    tiger = _pub()
    _menu(tiger)

    with django_assert_max_num_queries(30):
        client.get("/hospody/praha")
    with django_assert_max_num_queries(6):
        assert client.get("/hospody/praha").status_code == 200
    with django_assert_max_num_queries(25):
        client.get(f"/hospoda/u-zlateho-tygra-{tiger.cache_key}")
    with django_assert_max_num_queries(6):
        assert client.get(f"/hospoda/u-zlateho-tygra-{tiger.cache_key}").status_code == 200
    client.get("/hledat?q=hospoda")
    with django_assert_max_num_queries(4):
        assert client.get("/hledat?q=hospoda").status_code == 200


def test_sitemap_paths_list_cities_and_pubs_with_data():
    tiger = _pub()
    _menu(tiger)
    for index in range(3):
        _pub(f"Hospoda {index}", lat=50.08 + index / 1000, lng=14.42, city="Praha")

    paths = sitemap_paths()
    pubs = pubs_data.indexed_pubs()

    assert "/hospody" in paths and "/hospody/praha" in paths
    assert f"u-zlateho-tygra-{tiger.cache_key}" in pubs
    assert not any(key.startswith("hospoda-") for key in pubs)
