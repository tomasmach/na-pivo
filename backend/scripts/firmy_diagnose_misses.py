"""
firmy_diagnose_misses — explain WHY each Firmy.cz no-match happened.

Re-runs the same Mapy sample as firmy_smoke_test, and for every pub that
FirmyHoursSource.fetch() rejects, introspects the pipeline:

    * did SEARCH return a candidate at all?           (None → firmy-gap)
    * candidate name from the detail page
    * raw name_similarity  (the MIN_NAME_SIM=0.5 gate)
    * geo distance metres   (the 5km search pre-filter / geo score)
    * final verify_match confidence  (the MIN_CONFIDENCE=0.55 gate)

This separates "firmy.cz genuinely doesn't list it" from "matcher was too
strict", which decides whether the fix is the matcher or the source.

Run: cd na-pivo-backend && uv run python scripts/firmy_diagnose_misses.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

# reuse the smoke-test helpers
from firmy_smoke_test import find_mapy_key, load_env, municipality  # noqa: E402

from pubs.enrichment.firmy import FirmyHoursSource, TransientFetchError  # noqa: E402
from pubs.enrichment.mapy import MapySuggestSource  # noqa: E402
from pubs.enrichment.matcher import _haversine_m, name_similarity, verify_match  # noqa: E402


def diagnose(firmy: FirmyHoursSource, name: str, lat: float, lng: float, city: str | None) -> str:
    try:
        search = firmy._search(name, city, lat, lng)
    except TransientFetchError as exc:
        return f"SEARCH transient: {exc}"
    if search is None:
        return "FIRMY-GAP: search returned no detail link (410/no result)"

    firm_id, slug, search_lb = search
    # geo pre-filter (uses search card geo)
    distant = firmy._search_hit_is_geographically_distant(lat, lng, search_lb)

    try:
        detail = firmy._fetch_detail(firm_id, slug)
    except TransientFetchError as exc:
        return f"firm {firm_id}: DETAIL transient: {exc}"
    if detail is None:
        return f"firm {firm_id} ({slug}): detail had no LocalBusiness block"

    detail_lb = detail[0]
    c_name = detail_lb.get("name") or search_lb.get("name") or ""
    geo = detail_lb.get("geo") or search_lb.get("geo") or {}
    try:
        c_lat = float(geo.get("latitude") or geo.get("lat") or 0) or None
        c_lng = float(geo.get("longitude") or geo.get("lng") or 0) or None
    except (TypeError, ValueError):
        c_lat = c_lng = None

    nsim = name_similarity(name, c_name)
    dist = _haversine_m(lat, lng, c_lat, c_lng) if (c_lat and c_lng) else None
    conf = verify_match(name, lat, lng, c_name, c_lat, c_lng)

    reasons = []
    if distant:
        reasons.append("GEO-PREFILTER killed (search card >5km)")
    if nsim < 0.5:
        reasons.append(f"NAME-GATE failed (name_sim={nsim:.2f}<0.5)")
    if conf < 0.55:
        reasons.append(f"LOW-CONF (conf={conf:.2f}<0.55)")
    if not reasons:
        reasons.append("?? would have matched on re-run (flaky?)")

    dstr = f"{dist:.0f}m" if dist is not None else "—"
    return (
        f"firm {firm_id} -> cand={c_name[:38]!r}\n"
        f"        name_sim={nsim:.2f}  dist={dstr}  conf={conf:.2f}  | "
        + "; ".join(reasons)
    )


def main() -> int:
    env = load_env(REPO / ".env")
    mapy_key = find_mapy_key(env) or os.environ.get("MAPY_API_KEY")
    if not mapy_key:
        print("ERROR: no Mapy API key.")
        return 1

    lat = float(os.environ.get("LAT", "50.0875"))
    lng = float(os.environ.get("LNG", "14.4213"))
    radius_km = float(os.environ.get("RADIUS_KM", "3"))
    sample = int(os.environ.get("SAMPLE", "25"))
    min_interval = float(os.environ.get("MIN_INTERVAL", "3"))

    with MapySuggestSource(api_key=mapy_key) as mapy:
        pubs = mapy.search_near(lat, lng, radius_km).items[:sample]

    firmy = FirmyHoursSource(proxy_url=None, min_interval=min_interval)

    print(f"Diagnosing no-matches in first {len(pubs)} pubs near ({lat},{lng})\n")
    for i, pub in enumerate(pubs, 1):
        name = pub["name"]
        pos = pub["position"]
        city = municipality(pub)
        try:
            raw = firmy.fetch(name, pos["lat"], pos["lon"], city)
        except Exception:  # noqa: BLE001
            raw = None
        if raw is not None:
            continue  # matched — skip
        # re-introspect this miss (costs a second search+detail; acceptable)
        verdict = diagnose(firmy, name, pos["lat"], pos["lon"], city)
        print(f"{i:2}. {name}")
        print(f"        {verdict}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
