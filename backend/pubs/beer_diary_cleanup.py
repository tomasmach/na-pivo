"""Unify beer names in drink logs without changing a single logged beer.

A logged beer takes the name pub menus use after ``beer_menu_cleanup``: the
catalog name for an exact catalog alias ("Radek 12" -> "Radegast Ryze Hořká
12°"), otherwise the preferred spelling ("Primátor 11" -> "Primátor 11°"). An
exact catalog name also links the catalog product, so diary stats count both
spellings as one beer, and a linked beer shows the catalog's current name.

Only the name and the catalog link change. No row is added or removed; price,
volume, pub, time, evening and abuse flags stay as they are. An account that
would lose its Ochutnávač badge, because a beer spelled two ways counted as two
beers, is left out whole.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

from django.db import transaction

from pubs.api.profile_helpers import TASTER_MIN_BEERS
from pubs.beer_catalog import BeerCatalogMatchCache, match_beer
from pubs.models import Account, BeerBrand, BeerProduct, DrinkLog

LINK_FIELDS = (
    "beer_brand_id",
    "beer_brand_key",
    "beer_brand_name",
    "beer_product_id",
    "beer_product_key",
    "beer_product_name",
)
FIELDS = ("beer_name", *LINK_FIELDS)


@dataclass
class DiaryChange:
    """One account's renamed drinks. The account itself is not recorded."""

    rows: list[dict]
    model: str = "drink"


@dataclass
class DiaryPlan:
    changes: list[DiaryChange] = field(default_factory=list)
    beer_rows: int = 0
    renamed_rows: int = 0
    linked_rows: int = 0
    accounts_kept_for_badge: int = 0
    names_before: set[str] = field(default_factory=set)
    names_after: set[str] = field(default_factory=set)


def beer_identity(name: str, product_key: str, brand_key: str) -> str | None:
    """One beer for the Ochutnávač count, as ``derive_account_profile_stats`` sees it."""
    return product_key.strip() or brand_key.strip() or name.strip().lower() or None


def _distinct_beers(rows: Iterable[tuple[DrinkLog, dict]]) -> int:
    identities = {
        beer_identity(values["beer_name"], values["beer_product_key"], values["beer_brand_key"])
        for drink, values in rows
        if not drink.is_suspect
    }
    identities.discard(None)
    return len(identities)


def _is_beer(drink: DrinkLog) -> bool:
    return drink.drink_type == DrinkLog.DrinkType.BEER and bool(drink.beer_name.strip())


@dataclass
class _Catalog:
    canonical: Callable[[str], str]
    match_cache: BeerCatalogMatchCache
    brand_names: dict[int, str]
    product_names: dict[int, str]


def _cleaned(drink: DrinkLog, catalog: _Catalog) -> dict:
    values = {name: getattr(drink, name) for name in FIELDS}
    if not _is_beer(drink):
        return values
    values["beer_name"] = catalog.canonical(drink.beer_name)
    # Exact names only: the loose match would file "Birell Pomelo Grep Max"
    # under Birell Světlý.
    match = match_beer(values["beer_name"], fuzzy=False, match_cache=catalog.match_cache)
    if match is not None and match.product is not None:
        values.update(
            beer_brand_id=match.brand.pk,
            beer_brand_key=match.brand.key,
            beer_brand_name=match.brand.name,
            beer_product_id=match.product.pk,
            beer_product_key=match.product.key,
            beer_product_name=match.product.name,
        )
        return values
    # The friend feed shows the linked name, so it follows a catalog rename.
    if values["beer_brand_id"] in catalog.brand_names:
        values["beer_brand_name"] = catalog.brand_names[values["beer_brand_id"]]
    if values["beer_product_id"] in catalog.product_names:
        values["beer_product_name"] = catalog.product_names[values["beer_product_id"]]
    return values


Record = Callable[[list], None]


def _clean_account(
    account_id: int,
    catalog: _Catalog,
    plan: DiaryPlan,
    record: Record,
    *,
    apply: bool,
) -> None:
    drinks = DrinkLog.objects.filter(account_id=account_id).order_by("pk")
    if apply:
        # The badge check must see the drinks it writes. Lock like a drink
        # write does, the account first and then its drinks. NO KEY: a drink
        # edit holding one of these drinks may still add an index row that
        # points at the account.
        account = Account.objects.select_for_update(no_key=True).filter(pk=account_id)
        if account.first() is None:
            return
        drinks = drinks.select_for_update(no_key=True)
    drinks = list(drinks)
    before = [(drink, {name: getattr(drink, name) for name in FIELDS}) for drink in drinks]
    after = [(drink, _cleaned(drink, catalog)) for drink in drinks]
    rows = [
        {"pk": drink.pk, "before": old, "after": new}
        for (drink, old), (_, new) in zip(before, after, strict=True)
        if old != new
    ]
    keep = bool(rows) and _distinct_beers(before) >= TASTER_MIN_BEERS > _distinct_beers(after)
    if keep:
        plan.accounts_kept_for_badge += 1
    beers = [(drink, old, new) for (drink, old), (_, new) in zip(before, after, strict=True) if _is_beer(drink)]
    plan.beer_rows += len(beers)
    plan.names_before.update(old["beer_name"] for _, old, _ in beers)
    plan.names_after.update((old if keep else new)["beer_name"] for _, old, new in beers)
    if not rows or keep:
        return

    plan.renamed_rows += sum(1 for row in rows if row["before"]["beer_name"] != row["after"]["beer_name"])
    plan.linked_rows += sum(
        1 for row in rows if row["before"]["beer_product_id"] != row["after"]["beer_product_id"]
    )
    change = DiaryChange(rows)
    record([change])
    plan.changes.append(change)
    if apply:
        for row in rows:
            DrinkLog.objects.filter(pk=row["pk"]).update(**row["after"])


def run_diary_cleanup(
    canonical: Callable[[str], str],
    *,
    apply: bool,
    record: Record | None = None,
) -> DiaryPlan:
    """Plan the drink log cleanup and, with ``apply``, write it one account at a time.

    Each account is locked only for its own short transaction. ``record``
    receives its rows (before and after) before they are written, so the
    report is a backup even when the run stops halfway.
    """
    plan = DiaryPlan()
    record = record or (lambda changes: None)
    catalog = _Catalog(
        canonical=canonical,
        match_cache=BeerCatalogMatchCache(),
        brand_names=dict(BeerBrand.objects.values_list("pk", "name")),
        product_names=dict(BeerProduct.objects.values_list("pk", "name")),
    )
    account_ids = (
        DrinkLog.objects.filter(drink_type=DrinkLog.DrinkType.BEER)
        .order_by("account_id")
        .values_list("account_id", flat=True)
        .distinct()
    )
    for account_id in account_ids:
        with transaction.atomic():
            _clean_account(account_id, catalog, plan, record, apply=apply)
    return plan


def revert_diary_cleanup(changes: Iterable[dict]) -> tuple[int, int]:
    """Put back the drink names of a cleanup report.

    Only rows still exactly as the cleanup left them are restored; a beer its
    owner renamed since keeps the newer name. Returns (restored, skipped).
    """
    restored = skipped = 0
    for change in changes:
        with transaction.atomic():
            for row in change["rows"]:
                before = dict(row["before"])
                for name, model in (("beer_brand_id", BeerBrand), ("beer_product_id", BeerProduct)):
                    if before[name] is not None and not model.objects.filter(pk=before[name]).exists():
                        before[name] = None
                if DrinkLog.objects.filter(pk=row["pk"], **row["after"]).update(**before):
                    restored += 1
                else:
                    skipped += 1
    return restored, skipped
