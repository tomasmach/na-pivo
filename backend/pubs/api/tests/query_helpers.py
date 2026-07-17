"""Small query-count helpers for API tests."""

from __future__ import annotations


def count_beer_catalog_selects(captured_queries: list[dict[str, str]]) -> tuple[int, int]:
    product_selects = 0
    brand_selects = 0
    for query in captured_queries:
        sql = query["sql"].lower()
        if not sql.lstrip().startswith("select"):
            continue
        if 'from "pubs_beerproduct"' in sql:
            product_selects += 1
        if 'from "pubs_beerbrand"' in sql:
            brand_selects += 1
    return product_selects, brand_selects
