"""Unify beer names on pub menus and drop rows listing one beer twice.

Only the shared menus change: ``PubCommunityData.beers`` /
``historical_beers`` and the imported ``PubExternalBeerMenu.beers``. Drink
logs are never read for names and never written, so nobody loses a logged
beer, a typed name or an achievement.

A menu name becomes:

1. the catalog name when it is an exact catalog alias (what every live write
   already does through ``normalize_beer_payload``), otherwise
2. the preferred spelling of the same name across all menus, e.g.
   "Primátor 11", "primátor 11" and "Primátor 11°" all become "Primátor 11°".

Rows with the same ``beer_menu_identity`` (name and volume) are then merged
into the first one. The run is deterministic and idempotent.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

from django.db import transaction
from django.utils import timezone

from pubs.beer_catalog import (
    BeerCatalogMatchCache,
    beer_menu_identity,
    match_beer,
    normalize_beer_text,
)
from pubs.models import (
    DrinkLog,
    PubBeerBrand,
    PubBeerProduct,
    PubCommunityData,
    PubExternalBeerMenu,
    PubPriceIndex,
)
from pubs.price_index import compute_reference_price, upsert_pub_price_index

_SPACES_RE = re.compile(r"\s+")
# A Plato degree as Czech menus write it: 6 to 24, optionally 10,7.
_PLATO_NUMBER = r"(?:[6-9]|1\d|2[0-4])(?:[,.]\d)?"
_PLATO = r"(?<![\d,.])(" + _PLATO_NUMBER + ")"
_DEGREE_MARKS = r"[°˚º´’'`*•]"
# "Šerák11°" -> "Šerák 11°", but "Dock7 Dark" keeps its name.
_LETTER_DEGREE_RE = re.compile(
    r"(?<=[^\W\d_])(?=" + _PLATO_NUMBER + r"(?:\s*(?:" + _DEGREE_MARKS + r"|%)|$))"
)
_DEGREE_MARKS_RE = re.compile(_PLATO + r"\s*" + _DEGREE_MARKS + "+")
_DEGREE_WORD_RE = re.compile(r"°(?=[^\W\d_])")
_PLATO_DEGREE_RE = re.compile(_PLATO + "°")
_TRAILING_DOT_RE = re.compile(r"(\d)\.$")

Identity = tuple[str, int | None]
PriceResolver = Callable[[str, Identity, list[dict]], int | None]


def tidy_beer_name(name: str) -> str:
    """Fix spacing and the degree sign without changing any word."""
    value = _SPACES_RE.sub(" ", name).strip()
    value = _LETTER_DEGREE_RE.sub(" ", value)
    value = _DEGREE_MARKS_RE.sub(r"\1°", value)
    value = _DEGREE_WORD_RE.sub("° ", value)
    return _TRAILING_DOT_RE.sub(r"\1", value)


def _spelling_rank(spelling: str, count: int) -> tuple:
    return (
        bool(_PLATO_DEGREE_RE.search(spelling)),
        count,
        spelling[:1].isupper(),
        not spelling.isascii(),
        spelling,
    )


def preferred_spellings(names: Iterable[str]) -> dict[str, str]:
    """Normalized name -> the spelling every menu should use.

    Prefers a Plato degree sign ("11°"), then the most common spelling, then
    a capital first letter and Czech diacritics.
    """
    counts: dict[str, Counter] = defaultdict(Counter)
    for name in names:
        spelling = tidy_beer_name(name)
        key = normalize_beer_text(spelling)
        if key:
            counts[key][spelling] += 1
    return {
        key: max(spellings.items(), key=lambda item: _spelling_rank(*item))[0]
        for key, spellings in counts.items()
    }


@dataclass
class MenuChange:
    """One menu field whose rows changed."""

    model: str
    pk: int
    cache_key: str
    pub_name: str
    field: str
    before: list
    after: list
    renamed: list[tuple[str, str]] = field(default_factory=list)
    merged: list[dict] = field(default_factory=list)
    price_conflicts: list[dict] = field(default_factory=list)


@dataclass
class CleanupPlan:
    changes: list[MenuChange] = field(default_factory=list)
    community_rows: int = 0
    external_rows: int = 0
    items_before: int = 0
    items_after: int = 0
    names_before: set[str] = field(default_factory=set)
    names_after: set[str] = field(default_factory=set)
    index_links_created: int = 0
    index_links_reactivated: int = 0
    price_index_updates: int = 0


def _menu_items(value) -> list:
    return value if isinstance(value, list) else []


def _beer_name(item) -> str | None:
    if isinstance(item, dict) and isinstance(item.get("name"), str) and item["name"].strip():
        return item["name"]
    return None


class _Canonicalizer:
    def __init__(self, spellings: dict[str, str]) -> None:
        self._spellings = spellings
        self._match_cache = BeerCatalogMatchCache()

    def name(self, name: str) -> str:
        match = match_beer(name, fuzzy=False, match_cache=self._match_cache)
        if match is not None:
            return match.beer_name
        tidy = tidy_beer_name(name)
        return self._spellings.get(normalize_beer_text(tidy), tidy)


def _merged_price(items: list[dict]) -> int | None:
    for item in items:
        if item.get("price_czk") is not None:
            return item["price_czk"]
    return None


def clean_menu(
    items: list,
    canonical: Callable[[str], str],
    *,
    resolve_price: PriceResolver | None = None,
    merge_price_conflicts: bool = True,
    drop: set[Identity] | None = None,
) -> tuple[list, list[tuple[str, str]], list[dict], list[dict]]:
    """Rename and merge one menu list.

    Returns (rows, renames, merged-away rows, price conflicts). Rows that are
    not beer dicts stay untouched. Rows of one beer and volume collapse into
    the first one; when their prices differ, ``resolve_price`` may pick the
    price, and without ``merge_price_conflicts`` they all stay. ``drop``
    removes identities (keeps a beer out of the history while it is on tap).
    """
    renamed: list[tuple[str, str]] = []
    renamed_items: list = []
    groups: dict[Identity, list[dict]] = defaultdict(list)
    for item in items:
        name = _beer_name(item)
        if name is not None:
            new_name = canonical(name)
            if new_name != name:
                renamed.append((name, new_name))
                item = {**item, "name": new_name}
            groups[beer_menu_identity(item)].append(item)
        renamed_items.append(item)

    rows: list = []
    merged: list[dict] = []
    conflicts: list[dict] = []
    emitted: set[Identity] = set()
    for item in renamed_items:
        if _beer_name(item) is None:
            rows.append(item)
            continue
        identity = beer_menu_identity(item)
        group = groups[identity]
        if drop and identity in drop:
            merged.append(item)
            continue
        prices = {row.get("price_czk") for row in group} - {None}
        if len(group) == 1 or (len(prices) > 1 and not merge_price_conflicts):
            rows.append(item)
            continue
        if identity in emitted:
            merged.append(item)
            continue
        emitted.add(identity)
        price = _merged_price(group)
        if len(prices) > 1:
            resolved = resolve_price(item["name"], identity, group) if resolve_price else None
            conflicts.append(
                {
                    "name": item["name"],
                    "volume_ml": item.get("volume_ml"),
                    "prices": [row.get("price_czk") for row in group],
                    "chosen": resolved if resolved is not None else price,
                    "from_drink": resolved is not None,
                }
            )
            if resolved is not None:
                price = resolved
        rows.append({**item, "price_czk": price})
    return rows, renamed, merged, conflicts


def _latest_drink_price(cache_key: str) -> PriceResolver:
    """Price of the newest countable drink of this beer at this pub, if any."""

    def resolve(name: str, identity: Identity, group: list[dict]) -> int | None:
        drinks = (
            DrinkLog.objects.filter(
                cache_key=cache_key,
                drink_type=DrinkLog.DrinkType.BEER,
                is_suspect=False,
                price_czk__isnull=False,
                volume_ml=identity[1],
            )
            .order_by("-drank_at")
            .only("beer_name", "price_czk")[:200]
        )
        for drink in drinks:
            if normalize_beer_text(drink.beer_name) == identity[0]:
                return drink.price_czk
        return None

    return resolve


def _all_menu_names() -> Iterable[str]:
    for row in PubCommunityData.objects.only("beers", "historical_beers").iterator(chunk_size=500):
        for item in [*_menu_items(row.beers), *_menu_items(row.historical_beers)]:
            if (name := _beer_name(item)) is not None:
                yield name
    for row in PubExternalBeerMenu.objects.only("beers").iterator(chunk_size=500):
        for item in _menu_items(row.beers):
            if (name := _beer_name(item)) is not None:
                yield name


def _count(plan: CleanupPlan, before: list, after: list) -> None:
    plan.items_before += sum(1 for item in before if _beer_name(item))
    plan.items_after += sum(1 for item in after if _beer_name(item))
    plan.names_before.update(_beer_name(item) for item in before if _beer_name(item))
    plan.names_after.update(_beer_name(item) for item in after if _beer_name(item))


def _ensure_index_links(
    row: PubCommunityData,
    beers: list,
    match_cache: BeerCatalogMatchCache,
    *,
    apply: bool,
) -> tuple[int, int]:
    """Make the brand/product index list every catalog beer on the menu.

    Additive only: existing links keep their price, source and timestamps.
    Returns (created, reactivated); without ``apply`` it only counts.
    """
    created = reactivated = 0
    seen: set[tuple[type, int]] = set()
    shared = {
        "name": row.name,
        "lat": row.lat,
        "lng": row.lng,
        "city": row.city or "",
        "external_id": row.external_id or "",
        "source": PubBeerBrand.Source.COMMUNITY,
        "active": True,
        # System work: no contributor, so the link never appears in anybody's
        # data export and never takes a lock on an account row.
        "account": None,
        "last_seen_at": row.beers_updated_at or timezone.now(),
    }
    for item in beers:
        name = _beer_name(item)
        if name is None:
            continue
        # A product only on an exact catalog name: the loose match would file
        # "Birell Pomelo Grep Max" under Birell Světlý. The brand is safe either way.
        match = match_beer(name, fuzzy=False, match_cache=match_cache)
        loose = match or match_beer(name, match_cache=match_cache)
        if loose is None:
            continue
        brand = loose.brand
        values = {
            **shared,
            "last_price_czk": item.get("price_czk"),
            "last_volume_ml": item.get("volume_ml"),
            "brand_key": brand.key,
            "brand_name": brand.name,
        }
        targets = [(PubBeerBrand, {"brand": brand}, values)]
        if match is not None and match.product is not None:
            product = match.product
            targets.append(
                (
                    PubBeerProduct,
                    {"product": product},
                    {
                        **values,
                        "brand": brand,
                        "product_key": product.key,
                        "product_name": product.name,
                    },
                )
            )
        for model, lookup, defaults in targets:
            target_id = next(iter(lookup.values())).pk
            if (model, target_id) in seen:
                continue
            seen.add((model, target_id))
            link = model.objects.filter(cache_key=row.cache_key, **lookup).first()
            if link is None:
                created += 1
                if apply:
                    # A live drink write may create the same link meanwhile.
                    model.objects.get_or_create(
                        cache_key=row.cache_key, **lookup, defaults=defaults
                    )
            elif not link.active:
                reactivated += 1
                if apply:
                    model.objects.filter(pk=link.pk, active=False).update(
                        active=True, updated_at=timezone.now()
                    )
    return created, reactivated


def _update_price_index(plan: CleanupPlan, before: list, after: list, *, apply: bool, **row) -> None:
    def reference(items: list) -> tuple[int, int | None] | None:
        return compute_reference_price([item for item in items if isinstance(item, dict)])

    if reference(before) == reference(after):
        return
    plan.price_index_updates += 1
    if apply:
        upsert_pub_price_index(beers=after, **row)


Record = Callable[[list[MenuChange]], None]


def _clean_community_row(
    row: PubCommunityData,
    plan: CleanupPlan,
    canonicalizer: _Canonicalizer,
    record: Record,
    *,
    apply: bool,
) -> list:
    """Clean one community menu; returns the beers now on it."""
    beers = _menu_items(row.beers)
    new_beers, renamed, merged, conflicts = clean_menu(
        beers, canonicalizer.name, resolve_price=_latest_drink_price(row.cache_key)
    )
    current = {beer_menu_identity(item) for item in new_beers if _beer_name(item)}
    historical = _menu_items(row.historical_beers)
    new_historical, h_renamed, h_merged, _ = clean_menu(
        historical, canonicalizer.name, drop=current
    )
    _count(plan, beers, new_beers)
    changes = []
    if new_beers != beers:
        changes.append(
            MenuChange(
                "community", row.pk, row.cache_key, row.name, "beers",
                beers, new_beers, renamed, merged, conflicts,
            )
        )
    if new_historical != historical:
        changes.append(
            MenuChange(
                "community", row.pk, row.cache_key, row.name, "historical_beers",
                historical, new_historical, h_renamed, h_merged,
            )
        )
    if not changes:
        return new_beers
    record(changes)
    plan.changes.extend(changes)
    if apply:
        row.beers = new_beers
        row.historical_beers = new_historical
        row.save(update_fields=["beers", "historical_beers", "updated_at"])
    _update_price_index(
        plan,
        beers,
        new_beers,
        apply=apply,
        cache_key=row.cache_key,
        name=row.name,
        lat=row.lat,
        lng=row.lng,
        city=row.city or "",
        external_id=row.external_id or "",
        observed_at=row.beers_updated_at,
        source=PubPriceIndex.Source.COMMUNITY,
    )
    return new_beers


def _clean_external_row(
    row: PubExternalBeerMenu,
    plan: CleanupPlan,
    canonicalizer: _Canonicalizer,
    record: Record,
    *,
    apply: bool,
) -> None:
    beers = _menu_items(row.beers)
    # Imported menus are reviewed source data: the same beer at the same
    # volume with two prices is usually two servings (tank and keg), so keep it.
    new_beers, renamed, merged, conflicts = clean_menu(
        beers, canonicalizer.name, merge_price_conflicts=False
    )
    _count(plan, beers, new_beers)
    if new_beers == beers:
        return
    change = MenuChange(
        "external", row.pk, row.cache_key, row.name, "beers",
        beers, new_beers, renamed, merged, conflicts,
    )
    record([change])
    plan.changes.append(change)
    if apply:
        row.beers = new_beers
        row.save(update_fields=["beers", "updated_at"])
    if row.active:
        _update_price_index(
            plan,
            beers,
            new_beers,
            apply=apply,
            cache_key=row.cache_key,
            name=row.name,
            lat=row.lat,
            lng=row.lng,
            city=row.city,
            observed_at=row.verified_at or row.fetched_at,
            source=PubPriceIndex.Source.EXTERNAL,
        )


def run_menu_cleanup(*, apply: bool, record: Record | None = None) -> CleanupPlan:
    """Plan the cleanup and, with ``apply``, write it one pub at a time.

    Each pub is locked only for its own short transaction, so live drink
    writes never wait for the whole run, and ``record`` receives the pub's
    changes before they are written, so a backup exists for every committed
    pub even when the run stops halfway. A rerun finishes an interrupted one.
    """
    plan = CleanupPlan()
    record = record or (lambda changes: None)
    canonicalizer = _Canonicalizer(preferred_spellings(_all_menu_names()))
    index_cache = BeerCatalogMatchCache()

    def locked(model, pk):
        rows = model.objects.select_for_update() if apply else model.objects
        return rows.filter(pk=pk).first()

    for pk in PubCommunityData.objects.order_by("pk").values_list("pk", flat=True):
        with transaction.atomic():
            row = locked(PubCommunityData, pk)
            if row is None:
                continue
            beers = _clean_community_row(row, plan, canonicalizer, record, apply=apply)
        # Outside the menu lock: a drink write locks its account first and the
        # menu second, so nothing here may wait on an account while holding a menu.
        with transaction.atomic():
            created, reactivated = _ensure_index_links(row, beers, index_cache, apply=apply)
        plan.index_links_created += created
        plan.index_links_reactivated += reactivated

    for pk in PubExternalBeerMenu.objects.order_by("pk").values_list("pk", flat=True):
        with transaction.atomic():
            row = locked(PubExternalBeerMenu, pk)
            if row is not None:
                _clean_external_row(row, plan, canonicalizer, record, apply=apply)

    plan.community_rows = PubCommunityData.objects.count()
    plan.external_rows = PubExternalBeerMenu.objects.count()
    return plan


def revert_menu_cleanup(changes: Iterable[dict]) -> tuple[int, int]:
    """Put back the "before" lists of a cleanup report.

    Only fields still exactly as the cleanup left them are restored; a menu
    somebody edited since keeps the newer edit. Returns (restored, skipped).
    """
    models = {"community": PubCommunityData, "external": PubExternalBeerMenu}
    restored = skipped = 0
    for change in changes:
        model = models[change["model"]]
        with transaction.atomic():
            row = model.objects.select_for_update().filter(pk=change["pk"]).first()
            if row is None or getattr(row, change["field"]) != change["after"]:
                skipped += 1
                continue
            setattr(row, change["field"], change["before"])
            row.save(update_fields=[change["field"], "updated_at"])
            restored += 1
    return restored, skipped
