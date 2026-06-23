# Zmapuj hospodu (pub amenities) — BACKEND contract (locked)

Community-mapped pub amenities. Each user votes yes/no per amenity for a pub; the backend aggregates votes into a **public, confidence-weighted truth** about the place that everyone sees, and that powers a FUTURE pub map with amenity filters. This file is the authoritative backend wire contract; the mobile repo has the mirror at `na-pivo/docs/pub-amenities-spec.md`. All field names and endpoint shapes here are reproduced EXACTLY so the mobile spec can reference them.

This is a **design-only** spec. No source files are changed. The map filter is FUTURE and out of scope (see §6).

## 1. Overview

- **Feature.** "Zmapuj hospodu" lets a user record objective facts about a pub (platba kartou, zahrádka, šipky, wifi, psi vítáni, …) from a bottom sheet launched off the evening card / pub context. Each fact is a per-user yes/no vote. The server folds every user's votes into one aggregate per (pub, amenity) and serves that aggregate as community truth.
- **Public-aggregate model.** Unlike `PubRating` (per-user PRIVATE thumbs/note), amenities are **public community facts**. The per-user vote (`PubAmenityVote`) is the input; the aggregate (`PubAmenity`) is the everyone-sees-it output AND the queryable substrate for the future map filter. This mirrors the existing split: `PubBeerBrand` (queryable side-table) is to `PubCommunityData.beers` (display blob) as `PubAmenity` is to the future amenity map.
- **Gamification.** A lightweight "Mapér" XP system rides on top (the FIRST points system in the app): XP for mapping, a per-pub completeness meter ("zmapováno z 60 %"), a one-time first-mapper bonus, diminishing reward for confirming known facts, new badges. XP is **server-authoritative** (§7) because first-mapper/diminishing-reward depend on global state the client cannot see.
- **API-compatibility constraint.** Everything is **additive**. New tables, new endpoints, new env vars, new `ClientEvent` enum members, new additive fields on `GET /v1/account/me`. ZERO change to any released endpoint, request field, response field, or status meaning. Released apps that never call the new endpoints are unaffected; new fields they don't parse are ignored. `PubHours.has_garden` and the `gardenBadge='Zahrádka'` path keep their current source and meaning untouched (§2.5).
- **Privacy constraint.** Per-pub data is keyed by coarse **geohash-8 `cache_key`** (~38 m), identical to every other per-pub model. Raw lat/lng is server-side only (used to derive `cache_key`, denormalized onto rows for the bounding-box prefilter, never exposed in reads). No raw GPS history, no PII in logs — the new views log `cache_key` + `amenity_key` only, exactly as `PubRatingView` does. New telemetry events carry operation/status only, never coordinates/names/vote contents.

## 2. Data model (`pubs/models.py`, appended after `PubRating`)

### 2.1 Decision — separate rows, not a JSONField blob

One aggregate **row per (`cache_key`, `amenity_key`)** in `PubAmenity`, and one **row per (`account`, `cache_key`, `amenity_key`)** in `PubAmenityVote`. NOT a single JSONField blob per pub.

Justification (tied to the locked map-filter decision and repo conventions):

- **The future map filter must hit an index.** "Show pubs with `darts` AND `wifi`" is the whole point. A JSONField blob would force a full-table scan or DB-specific JSON-path operators — and the repo has **zero `django.contrib.postgres`** usage, so JSON querying is exactly the SQLite/Postgres-parity trap the conventions forbid. `PubBeerBrand` already set this precedent: the JSON menu (`PubCommunityData.beers`) is the display blob; the **side-table is the queryable path**. Amenities are the same shape.
- **Confidence aggregation is per-amenity** (`yes_count`/`no_count`/`status`/`confidence` per key). Separate rows keep each amenity's counters isolated and let `update_or_create` touch exactly one row per vote.
- **Per-user votes are per-amenity** so LWW conflict resolution and offline dedup work at the (account, pub, amenity) granularity — see §2.3 / §5.2.

### 2.2 Taxonomy = `AmenityKind` (server-driven, seeded)

```python
class AmenityKind(models.Model):
    """
    Canonical catalogue of mappable pub amenities ("Zmapuj hospodu").

    Server-driven so the set can grow without a mobile release. The client GETs
    this list (GET /v1/pub-amenities/kinds) to render the mapping sheet. Voting
    against an unknown/inactive key on the WRITE path is IGNORED (not 400) for
    additive forward-compat; the future map FILTER param is the only place an
    unknown key is a 400 (a client bug). Mirrors BeerBrand: stable slug + rank.
    """

    class Group(models.TextChoices):
        PAYMENT = "payment", "Platba"
        SEATING = "seating", "Posezení"
        GAMES = "games", "Zábava"
        ATMOSPHERE = "atmosphere", "Atmosféra"
        PRACTICAL = "practical", "Praktické"

    key = models.SlugField(
        max_length=40, unique=True, db_index=True,
        help_text="Stable ASCII id, e.g. payment_card, seating_garden, game_darts. NEVER renamed/reused.",
    )
    label = models.CharField(max_length=80, help_text="Czech display label, e.g. 'Platba kartou'.")
    short_label = models.CharField(
        max_length=40, blank=True, default="",
        help_text="Optional compact chip label.",
    )
    icon = models.CharField(
        max_length=40, blank=True, default="",
        help_text="IconGlyph export name the client renders, e.g. 'CreditCardIcon'. NO emoji.",
    )
    group = models.CharField(max_length=16, choices=Group.choices, db_index=True)
    rank = models.PositiveSmallIntegerField(
        default=1000, db_index=True, help_text="Lower ranks render earlier.",
    )
    filter_candidate = models.BooleanField(
        default=True,
        help_text="Whether this is a planned map-filter facet (design signal; filter is future).",
    )
    active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Amenity Kind"
        verbose_name_plural = "Amenity Kinds"
        ordering = ["rank", "key"]
```

### 2.3 `PubAmenityVote` — per-user vote (mirrors `PubRating`, but per-amenity)

```python
class PubAmenityVote(models.Model):
    """
    One user's yes/no vote that a pub has a given amenity, keyed by geohash-8.

    PUBLIC community input (NOT private, unlike PubRating): every vote feeds the
    confidence-weighted PubAmenity aggregate everyone sees and the future map
    filter. Identity is (account, cache_key, amenity_key) so the same physical
    pub + amenity collapses to ONE current vote per account regardless of which
    provider id the client saw — a flip yes->no OVERWRITES, it does not stack.

    Two-way sync, LAST-WRITE-WINS on the client's ``client_updated_at`` (NOT the
    server's updated_at), per AMENITY (not per report) — see §5.2. A wire vote
    value of null is an explicit RETRACTION (tombstone): it deletes the user's
    row, guarded by the same LWW timestamp. Absent-from-payload means 'no change'
    (the client sends one amenity per request — §4.2).
    """

    class Value(models.TextChoices):
        YES = "yes", "Has it"
        NO = "no", "Doesn't have it"

    account = models.ForeignKey(
        Account, on_delete=models.CASCADE, related_name="amenity_votes",
        help_text="The user who cast this vote.",
    )
    cache_key = models.CharField(
        max_length=12, db_index=True,
        help_text="Geohash-8 of (lat, lng) — matches PubHours / PubRating.cache_key.",
    )
    amenity_key = models.SlugField(
        max_length=40, db_index=True,
        help_text="AmenityKind.key this vote is about.",
    )
    # Free text the client controls → TextField, NEVER bounded CharField (SQLite
    # truncates silently, Postgres raises DataError). Bound enforced in the
    # serializer. name is also the geohash-8 collision guard (§2.6).
    name = models.TextField(blank=True, default="", help_text="Pub name as the client saw it.")
    lat = models.FloatField(help_text="Server-side only: derives cache_key; never exposed in reads.")
    lng = models.FloatField(help_text="Server-side only: derives cache_key; never exposed in reads.")
    city = models.TextField(blank=True, default="")
    external_id = models.TextField(blank=True, default="", help_text="Client provider id (Mapy item id).")
    value = models.CharField(
        max_length=3, choices=Value.choices,
        help_text='"yes" | "no". A retraction deletes the row instead of storing empty.',
    )
    awarded_xp = models.PositiveIntegerField(
        default=0,
        help_text="XP this row has EVER paid out. Gates idempotent XP — a flip/re-vote pays 0 (§7.3).",
    )
    client_updated_at = models.DateTimeField(
        help_text="Client's local updatedAt; the last-write-wins conflict key (per amenity).",
    )
    taxonomy_version = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text=(
            "Which bundled taxonomy version the client captured this vote under "
            "(mobile CURRENT_TAXONOMY_VERSION). Optional, analytics-only — NEVER a "
            "validation gate. Lets us spot votes cast under an old amenity set and "
            "drive future re-check nudges. Absent (legacy/unknown clients) is fine."
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Pub Amenity Vote"
        verbose_name_plural = "Pub Amenity Votes"
        ordering = ["-client_updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "cache_key", "amenity_key"],
                name="unique_amenity_vote_per_account_pub",
            )
        ]
        indexes = [
            # GET /v1/pub-amenities/votes lists by account; restore on reinstall.
            models.Index(fields=["account", "cache_key"]),
            # Aggregate recount slice: all votes for one (pub, amenity).
            models.Index(fields=["cache_key", "amenity_key"]),
        ]
```

### 2.4 `PubAmenity` — aggregate side-table (mirrors `PubBeerBrand`)

```python
class PubAmenity(models.Model):
    """
    Confidence-weighted community truth for one (pub, amenity), aggregated from
    PubAmenityVote. One row per (cache_key, amenity_key). PUBLIC (no account FK on
    the row identity). This is the everyone-sees-it fact AND the queryable path
    for the FUTURE map filter ("pubs with garden + wifi"), exactly as PubBeerBrand
    is for "pubs serving brand X".

    Recomputed synchronously on every vote write (no Celery). The recompute holds
    a row lock on THIS aggregate row (get_or_create then select_for_update) so
    concurrent voters on a hot pub serialize and counts never lost-update (§5.3).
    """

    class Status(models.TextChoices):
        YES = "yes", "Has it"
        NO = "no", "Doesn't have it"
        DISPUTED = "disputed", "Disputed"
        UNKNOWN = "unknown", "Not enough votes"

    cache_key = models.CharField(
        max_length=12, db_index=True,
        help_text="Geohash-8 of (lat, lng) — matches PubAmenityVote / PubHours.",
    )
    amenity_key = models.SlugField(max_length=40, db_index=True)

    # Last-known pub identity (denormalised from the most recent vote, same as
    # PubBeerBrand stores name/lat/lng/city). Free text → TextField. name is the
    # collision guard surfaced in reads (§2.6); lat/lng feed the future bbox scan
    # and are NOT exposed in the read payload (§6 privacy).
    name = models.TextField(blank=True, default="")
    lat = models.FloatField()
    lng = models.FloatField()
    city = models.TextField(blank=True, default="")
    external_id = models.TextField(blank=True, default="")

    yes_count = models.PositiveIntegerField(default=0)
    no_count = models.PositiveIntegerField(default=0)
    distinct_voter_count = models.PositiveIntegerField(
        default=0,
        help_text="Distinct accounts that have a live vote here (one per account by unique constraint).",
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.UNKNOWN, db_index=True,
    )
    confidence = models.FloatField(
        default=0.0,
        help_text="0.0–1.0 agreement×volume score; stored (indexable), recomputed on write. See §5.4.",
    )
    first_mapper = models.ForeignKey(
        Account, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="amenities_first_mapped",
        help_text="Account that created this aggregate row (the FIRST vote). IMMUTABLE — never reattributed.",
    )
    first_mapped_at = models.DateTimeField(
        null=True, blank=True,
        help_text="Server time the first vote created this row. Immutable.",
    )
    last_updated = models.DateTimeField(
        default=timezone.now, db_index=True,
        help_text="Server time of the last vote that touched this aggregate.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Pub Amenity"
        verbose_name_plural = "Pub Amenities"
        ordering = ["-last_updated"]
        constraints = [
            models.UniqueConstraint(
                fields=["cache_key", "amenity_key"],
                name="unique_pub_amenity",
            )
        ]
        indexes = [
            # FUTURE map filter: "which pubs have amenity X with status yes".
            models.Index(fields=["amenity_key", "status"]),
            # Read all amenities for one pub (dedicated GET, §4.4).
            models.Index(fields=["cache_key"]),
        ]
```

### 2.5 `seating_garden` vs the existing `has_garden`

`PubHours.has_garden` is a firmy.cz-derived **server fact** (indexed boolean, surfaced as `hasGarden` on `/v1/pubs/near`, rendered as `gardenBadge='Zahrádka'`). `seating_garden` is the **community-voted** version of the same fact.

- They **coexist**; neither overwrites the other on the wire (API compatibility). Community votes write ONLY to `PubAmenity`; `has_garden` stays firmy-sourced.
- We deliberately **do NOT backfill** `seating_garden` votes from `has_garden`. Seeding scraped booleans as if they were community votes pollutes `yes_count`/`confidence` and steals the first-mapper credit from the first real human. If product later wants a day-one prior, it must be a SEPARATE, explicitly-sourced field (e.g. `firmy_prior` on `PubAmenity`) that does NOT increment `yes_count`/`distinct_voter_count` and does NOT count toward `completeness` — out of scope here.
- The read-path merge (community `seating_garden` confirming/overriding the `hasGarden` badge above a confidence threshold) is a future decision; the released `hasGarden` field never changes meaning.

### 2.6 Geohash-8 collision guard (`names_match`)

The repo already knows a geohash-8 cell (~38 m) can hold two different businesses and guards every per-pub READ with `names_match` (`pubs/enrichment/matcher.py:118`; used in `pubs/api/cache.py:162/442/508`, and in the drink merge). For PUBLIC amenity truth this is more important than for private ratings, so:

- Every aggregate READ (the dedicated GET, §4.4) MUST gate each `PubAmenity` row against the requesting client's pub `name` via `names_match(request_name, row.name)`. On a mismatch, treat the row as **unmapped** (omit it / return `unknown`) rather than leaking a neighbouring business's votes.
- The WRITE path stores `name` on both the vote and the aggregate (denormalised from the latest vote). When a new vote's `name` does not match the aggregate's stored `name`, that is a logged collision signal; v1 keeps the aggregate's name as the dominant (most-recent) one and relies on the read-time `names_match` guard to protect consumers. (Splitting one cell into multiple distinct businesses is a future refinement; the contract surfaces it now because the taxonomy keys are permanent.)

## 3. Taxonomy storage — client-bundled base + server-driven discovery

**Hybrid, client-bundled authoritative for rendering + server overlay for forward-compat.**

- The client ships a bundled `AMENITY_TAXONOMY` (labels, Czech copy, IconGlyph names, sections) so the sheet renders fully **offline-first** even with the backend dormant. Icons stay client-bundled (no server-controlled imagery; the no-emoji rule means a new amenity must land its lucide glyph in an app release).
- The server owns the canonical key set via `AmenityKind` and exposes it at `GET /v1/pub-amenities/kinds` (§4.1). The server can introduce a key the client doesn't know yet; the client renders only keys it has a bundled definition for, and round-trips unknown keys untouched (the JSONField-free row model already accepts any slug). A released app never breaks: it simply never sends a key it doesn't know.
- **Seed data migration** mirrors `0031_seed_beer_brands` exactly: `0037_seed_amenity_kinds` does idempotent `update_or_create` over the v1 set, with a `reverse_code` that deletes the seeded keys. The v1 set is **16 active + 2 reserved** (the reserved rows are seeded with `active=False`):

| key | label (cs) | short_label (cs) | group | icon (IconGlyph) | filter_candidate | active | rank |
|---|---|---|---|---|---|---|---|
| `payment_card` | Platba kartou | Karta | payment | `CreditCardIcon` | true | true | 10 |
| `payment_cash_only` | Jen hotovost | Hotovost | payment | `BanknoteIcon` | true | true | 20 |
| `seating_garden` | Zahrádka / terasa | Zahrádka | seating | `TreePineIcon` | true | true | 30 |
| `seating_barrier_free` | Bezbariérový přístup | Bezbariér | seating | `AccessibilityIcon` | true | true | 40 |
| `seating_kids_corner` | Dětský koutek | Děti | seating | `BabyIcon` | true | true | 50 |
| `game_darts` | Šipky | Šipky | games | `TargetIcon` | true | true | 60 |
| `game_billiards` | Kulečník | Kulečník | games | `DicesIcon` | true | true | 70 |
| `game_foosball` | Stolní fotbal | Fotbálek | games | `Gamepad2Icon` | true | true | 80 |
| `game_jukebox` | Jukebox | Jukebox | games | `RadioIcon` | false | true | 90 |
| `atmosphere_live_music` | Živá hudba | Živá hudba | atmosphere | `MicIcon` | false | true | 100 |
| `atmosphere_sports_tv` | Sport v televizi | Sport v TV | atmosphere | `TvIcon` | true | true | 110 |
| `atmosphere_dogs_welcome` | Psi vítáni | Psi | atmosphere | `DogIcon` | true | true | 120 |
| `atmosphere_smoking` | Kuřárna / kouření povoleno | Kouření | atmosphere | `CigaretteIcon` | true | true | 130 |
| `practical_wifi` | Wi-Fi | Wi-Fi | practical | `WifiIcon` | true | true | 140 |
| `practical_parking` | Parkování | Parkování | practical | `SquareParkingIcon` | true | true | 150 |
| `practical_food` | Kuchyně / dá se najíst | Kuchyně | practical | `UtensilsIcon` | true | true | 160 |
| `practical_outdoor_tap` | Venkovní výčep | Výčep | practical | *(none — assign before activation; NOT `BeerIcon`)* | false | **false** | 170 |
| `practical_tank_beer` | Tankové pivo | Tank | practical | `BeerIcon` | true | **false** | 180 |

The **active set = exactly the 16 rows with `active=True`**; the two `active=False` rows (`practical_outdoor_tap`, `practical_tank_beer`) are RESERVED: present in the seed/catalogue, excluded from `GET /kinds`, the sheet, and from BOTH the numerator and denominator of completeness. So **`total_kinds` (active) = 16** and per-pub completeness can reach 100%.

Notes locked from the taxonomy dimension: keys are **group-prefixed, lowercase snake_case** with exactly five group prefixes — `payment_`, `seating_`, `game_`, `atmosphere_`, `practical_`. Note the deliberate asymmetry: the prefix is `game_` (singular) but the `Group` value is `games` (plural). Smoking is ONE tri-state amenity (`atmosphere_smoking`: yes = lze kouřit/kuřárna, no = nekuřácká) — modeling `kuřárna` and `nekuřácká` as separate keys recreates the boolean-conflation trap. `payment_cash_only` is kept as a separate key for v1 (the sheet "suggests, doesn't force" the opposite of `payment_card`); the aggregate treats them as independent facts and a high-confidence yes/yes is a flagged data conflict, not a client bug. `practical_outdoor_tap` is a **reserved key, seeded with `active=False`** (assign a glyph and activate later in a taxonomy bump; it must NOT reuse `BeerIcon`). `IconGlyph.tsx` cross-repo dependency: ~16 lucide wraps to add (one import + one `wrap()` line each) — flagged for mobile, not a backend concern.

**Deactivation contract.** Deactivating an `AmenityKind` (set `active=False`): `GET /kinds` stops returning it; votes/aggregates for it are RETAINED but EXCLUDED from public reads (the dedicated GET filters `amenities[]` to active kinds) and from the completeness denominator AND numerator (both use the active set, clamped to [0,1]) so a pub never shows >100%.

## 4. Endpoint contract (authoritative wire — all additive)

All paths mounted under `/v1/` in `pubs/api/urls.py`. DRF `APIView`. snake_case wire. `cache_key` ALWAYS derived server-side via `geohash8(lat, lng)` — never sent by the client. Views never throw: wrapped in the same broad `try/except → 500` as `PubRatingView`, so the mobile three-state classifier behaves (`400/422` → permanent/drop, `5xx/429/network/dormant` → retry).

### 4.1 `GET /v1/pub-amenities/kinds` — taxonomy (public, cacheable)

- Auth: `AllowAny` (like `PubsNearView`). Throttle scope `amenity_kinds`.
- Response `200` (the serializer emits the canonical wire field names — exactly 8 fields per item: `key`, `group`, `label_cs`, `short_label_cs`, `icon`, `map_filterable`, `is_active`, `order`):
```json
{
  "kinds": [
    {"key": "payment_card", "group": "payment", "label_cs": "Platba kartou", "short_label_cs": "Karta", "icon": "CreditCardIcon", "map_filterable": true, "is_active": true, "order": 10},
    {"key": "seating_garden", "group": "seating", "label_cs": "Zahrádka / terasa", "short_label_cs": "Zahrádka", "icon": "TreePineIcon", "map_filterable": true, "is_active": true, "order": 30}
  ],
  "version": "2026-06-23T18:30:00.000Z"
}
```
- `version` = full ISO-8601 `max(updated_at)` across active kinds (NOT a date — two same-day edits must produce distinct versions so a newly-added amenity is not invisible until the next calendar day). Only `is_active=true` rows are returned, ordered by `(order, key)`.
- **Wire field naming:** the model may internally keep the columns named `label`/`short_label`/`filter_candidate`/`rank`/`active`, but the **serializer MUST emit the canonical wire names** `label_cs` / `short_label_cs` / `map_filterable` / `is_active` (newly exposed) / `order` (the integer render rank). The mobile `WireAmenityKind` type uses these identical wire names.

### 4.2 `PUT /v1/pub-amenities/votes` — upsert one vote (per-amenity LWW)

- Auth: `AccountTokenAuthentication` + `IsAuthenticated`. Throttle scope `pub_amenities` (per-IP via `ScopedRateThrottle`, like every other write view).
- **One amenity per request** (the merge unit is the single amenity — §5.2). The body is an **array wrapper** `{ "votes": [ ... ] }` with one row per amenity (the prior bare single-object body is replaced). The mobile queue dedups by `(pubKey, amenity_key)` and the payload it flushes is the current local vote for that one amenity.
- Request:
```json
{
  "votes": [
    {
      "cache_key": null,
      "name": "U Černého vola",
      "lat": 50.0885,
      "lng": 14.3984,
      "city": "Praha",
      "external_id": "mapy:12345",
      "amenity_key": "seating_garden",
      "value": "yes",
      "client_updated_at": "2026-06-23T18:30:00.000Z",
      "taxonomy_version": 1
    }
  ]
}
```
- `cache_key` is always server-derived via `geohash8(lat, lng)`; the client sends `lat`/`lng` (never `cache_key`). `lat`/`lng` are used server-side only and never logged/echoed. `name` is always sent (geohash-8 collision guard); `city`/`external_id` are optional.
- `amenity_key`: if not a known **active** `AmenityKind`, the write is IGNORED with `200 {"applied": false, "ignored_unknown_amenity": true}` — NOT a 400 (additive forward-compat: an old server tolerates a newer client's key without breaking the offline queue's success path). The future map FILTER param is the only place an unknown key is a 400.
- `value`: `"yes"` | `"no"` | `null`. `null` is an explicit **retraction** → deletes the user's row, guarded by the same LWW timestamp. (Absent `value` on a present row is treated as `null`/retraction; an absent amenity from the body = no change. The mobile client always sends an explicit value.)
- `taxonomy_version`: optional integer (mobile `CURRENT_TAXONOMY_VERSION`). Stored on the vote row as analytics-only metadata — which bundled amenity set the vote was captured under, for later "this pub was mapped under v1, nudge a re-check" flows. It is **never** validated and **never** gates the write (a missing or future version still 2xx's), so it cannot break a released or newer client.
- **LWW per amenity**: the conflict timestamp field is named **`client_updated_at`** on the wire (it replaces the prior `updated_at` request field). A PUT whose `client_updated_at` ≤ the stored row's `client_updated_at` is ignored → `applied: false`, returns the existing aggregate. Identical to `PubRatingView` but scoped to the single (account, cache_key, amenity_key) row, so a stale push of one amenity can NEVER clobber another amenity (the report-level-LWW data-loss path is avoided by design — there is no whole-report PUT).
- Response `200` (mirrors the request array shape: a `results[]` array plus ONE `mapper` snapshot at the envelope level):
```json
{
  "results": [
    {
      "applied": true,
      "ignored_unknown_amenity": false,
      "deleted": false,
      "was_first_map": false,
      "xp_awarded": 5,
      "vote": {
        "amenity_key": "seating_garden",
        "value": "yes",
        "client_updated_at": "2026-06-23T18:30:00.000Z"
      },
      "aggregate": {
        "amenity_key": "seating_garden",
        "yes_count": 4,
        "no_count": 1,
        "distinct_voter_count": 5,
        "status": "yes",
        "confidence": 0.61,
        "my_value": "yes"
      }
    }
  ],
  "mapper": { "...": "fresh snapshot, see §7.2" }
}
```
- Per-result booleans are ALWAYS present (not optional): `applied` (bool; `false` = stale write rejected by LWW OR ignored-unknown — still `200`), `ignored_unknown_amenity` (bool; `true` only when `amenity_key` was not a known active kind), `deleted` (bool; `true` on a `value:null` retraction that removed the row), `was_first_map` (bool; `true` only when this write created the very first vote for that (pub, amenity)), `xp_awarded` (int; the authoritative per-vote award, `0` on flip/re-vote/retract).
- `vote`: object `{ amenity_key, value, client_updated_at }` or `null` (null on retract/ignore). `lat`/`lng` are NOT echoed (privacy; the client already has them); `name`/`external_id` are NOT part of this minimal object.
- `aggregate`: the recomputed `<Aggregate>` (§4.4 shape, including `my_value` for the authenticated caller) so the meter/XP update in one round-trip.
- On a retraction the matching result is `{"applied": true, "deleted": true, "ignored_unknown_amenity": false, "was_first_map": false, "xp_awarded": 0, "vote": null, "aggregate": {...recomputed...}}`.
- `mapper`: the fresh Mapér snapshot (§7.2) is returned ONCE at the envelope level (NOT per result), so Profile updates without a second GET.

### 4.3 `GET /v1/pub-amenities/votes` — list the account's own votes (restore)

- Auth: `IsAuthenticated`. Throttle `pub_amenities`.
- Response `200` (wrapped object, NOT a bare array — matches the `{"ratings": [...]}` envelope). Each item carries `cache_key`, `amenity_key`, `value`, `client_updated_at` (the LWW key for cross-device restore); `lat`/`lng`/`name` omitted:
```json
{
  "votes": [
    {
      "cache_key": "u2fkbnhz",
      "amenity_key": "seating_garden",
      "value": "yes",
      "client_updated_at": "2026-06-23T18:30:00.000Z"
    }
  ]
}
```
Lets a fresh install restore the user's mapping contributions, exactly like `GET /v1/pub-ratings`.

### 4.4 `GET /v1/pub-amenities` — public aggregates (the sheet/read path) — dedicated, NOT bolted onto `/pubs/near`

**Ship a dedicated cheap read; do NOT embed into `/v1/pubs/near`.** `/v1/pubs/near` is the shared, UA-restricted, credit-saving Mapy proxy cache (geohash-6 + radius_bucket, 7-day TTL). Splicing live amenity aggregates into it would either serve 7-day-stale amenity data, or shorten/widen that cache and reignite the Mapy credit cost the proxy exists to avoid, or fragment the cache key. Amenity aggregates therefore have their OWN cheap endpoint served from `PubAmenity`, with its OWN short TTL independent of the Mapy cache.

- Path: `GET /v1/pub-amenities?cache_keys=<k1>,<k2>...&name=<pub name>`
- Auth: `AllowAny` (public truth, must work before account recovery, like `PubsNearView`). Throttle scope `amenity_reads` (DEDICATED — do NOT reuse `pubs_near`, which protects metered Mapy credits; this is local-DB-only).
- `cache_keys`: comma list, capped at env `AMENITY_READ_MAX_KEYS` (default 60, mirroring the `pub-hours` batch cap class). `name` (optional but recommended): the client's pub name, used for the `names_match` collision guard (§2.6) per cache_key.
- Response `200`:
```json
{
  "pubs": [
    {
      "cache_key": "u2fkbnhz",
      "mapper_count": 5,
      "completeness": {"mapped_count": 7, "total_kinds": 16, "pct": 0.44},
      "amenities": [
        {"amenity_key": "seating_garden", "yes_count": 4, "no_count": 1, "distinct_voter_count": 5, "status": "yes", "confidence": 0.61, "my_value": "yes"},
        {"amenity_key": "practical_wifi", "yes_count": 1, "no_count": 1, "distinct_voter_count": 2, "status": "disputed", "confidence": 0.33, "my_value": null}
      ]
    }
  ]
}
```
- `mapper_count` = distinct accounts who voted any amenity here (int).
- `completeness` is a **nested object** `{mapped_count, total_kinds, pct}` (the canonical shape — NOT a flat float with sibling fields): `mapped_count` = distinct ACTIVE amenity_keys with `status != "unknown"`; `total_kinds` = count of active `AmenityKind` = **16** (server-authoritative denominator, the client never hard-codes it); `pct` = `mapped_count / total_kinds`, float 0.0–1.0 clamped to [0,1], the per-pub meter ("zmapováno z N %").
- `amenities[]`: only active kinds, each a full `<Aggregate>` carrying both `distinct_voter_count` and `my_value` (the authenticated caller's own vote — `"yes" | "no" | null`, populated only when the request is authenticated; `null`/omitted for anonymous reads). No lat/lng/name in the payload (privacy).
- No `min_confidence` query param: the client renders the meter from returned `confidence` and filters client-side. Adding an unindexed float filter to a public cacheable endpoint buys little and risks boundary flapping; the FUTURE map filter (§6) does the confidence gate server-side, not this read.

### 4.5 URL additions (`pubs/api/urls.py`)

```python
path("pub-amenities/kinds", PubAmenityKindsView.as_view(), name="pub-amenity-kinds"),
path("pub-amenities/votes", PubAmenityVoteView.as_view(), name="pub-amenity-votes"),
# Retraction is the null-value PUT above; a dedicated DELETE is OPTIONAL convenience,
# kept consistent with the idempotent rating delete and filtering only by
# (account, cache_key, amenity_key) with NO AmenityKind existence check (so a vote
# for a since-deactivated kind can always be cleared). Both segments URL-encoded.
path("pub-amenities/votes/<str:cache_key>/<str:amenity_key>",
     PubAmenityVoteView.as_view(), name="pub-amenity-votes-delete"),
path("pub-amenities", PubAmenityReadView.as_view(), name="pub-amenities-read"),
```

## 5. Aggregation & confidence (synchronous, on every write — no Celery)

### 5.1 When it recomputes

`yes_count`/`no_count`/`distinct_voter_count`/`status`/`confidence` recompute on EVERY vote write (upsert, flip, retraction) for the affected (cache_key, amenity_key) only. No background job — there is no Celery; recompute is inline in the same transaction as the vote write.

### 5.2 Conflict resolution — per-amenity LWW (NOT per-report)

The merge unit is the single (account, cache_key, amenity_key) row. There is no whole-report PUT, so a stale push of one amenity cannot erase another. Retraction is an explicit `value: null` tombstone (LWW-guarded), distinct from "absent = no change." This deliberately diverges from the ratings "replace the whole object" semantics because an amenity report is many independent facts, not one scalar.

### 5.3 Concurrency — lock the aggregate row, not the (maybe nonexistent) vote row

`PubRatingView` is race-safe only because each row is unique per (account, cache_key) and concurrent voters touch different rows. The aggregate is a SHARED row recomputed from many users' votes, so the naive read-count-then-write lost-updates under concurrency, and `select_for_update` on a not-yet-existing first row locks nothing. The write therefore:

```python
with transaction.atomic():
    # 1. LWW-guard + upsert the user's OWN vote row (unique per account):
    existing_vote = (
        PubAmenityVote.objects.select_for_update()
        .filter(account=request.user, cache_key=cache_key, amenity_key=amenity_key)
        .first()
    )
    if existing_vote is not None and existing_vote.client_updated_at >= client_updated_at:
        ...  # stale → applied: false, return current aggregate
    # IntegrityError-safe first insert: get_or_create then update (two concurrent
    # first voters: one inserts, the other catches the unique violation and updates).

    # 2. get_or_create the aggregate row, THEN lock it, THEN recount while held:
    agg, created = PubAmenity.objects.get_or_create(
        cache_key=cache_key, amenity_key=amenity_key,
        defaults={... name/lat/lng/city/external_id ..., "first_mapper_id": account_id,
                  "first_mapped_at": timezone.now()},
    )
    agg = PubAmenity.objects.select_for_update().get(pk=agg.pk)  # serialize voters
    # recount the small slice (index-served by (cache_key, amenity_key)):
    agg.yes_count = votes.filter(value="yes").count()
    agg.no_count = votes.filter(value="no").count()
    agg.distinct_voter_count = agg.yes_count + agg.no_count  # one vote per account
    agg.status, agg.confidence = _amenity_status(agg.yes_count, agg.no_count)
    # first_mapper / first_mapped_at are set ONLY on `created` — NEVER reassigned.
    agg.save()
```

Full recount per write (two `COUNT(*)` over the tiny per-(pub,amenity) slice) is chosen over `F()` deltas because a vote can flip yes↔no or retract and a recount is correct under all transitions with no drift; the slice is index-served. The aggregate-row lock makes it atomic on both backends without relying on locking a phantom vote row. (Note for scale: this is a NEW pattern, not literally "mirrors PubBeerBrand"; if hot pubs ever demand it, switch to `F()` deltas under the same aggregate lock — no model change, since `yes_count`/`no_count` already exist.)

`first_mapper`/`first_mapped_at` are set once at row creation and **never reattributed** — a later retraction by the original first mapper does NOT promote the next-oldest voter (that would be a grind/loss vector and would desync client/server XP).

### 5.4 Status + confidence formula (`_amenity_status`, pure, env-tunable)

```python
AMENITY_MIN_VOTES     = int(os.environ.get("AMENITY_MIN_VOTES", "3"))      # below → unknown
AMENITY_DISPUTE_RATIO = float(os.environ.get("AMENITY_DISPUTE_RATIO", "0.34"))

def _amenity_status(yes, no):
    total = yes + no
    if total == 0:
        return ("unknown", 0.0)
    majority, minority = max(yes, no), min(yes, no)
    agreement = majority / total                 # 0.5..1.0
    volume = total / (total + 2)                  # diminishing-returns weight
    confidence = round(agreement * volume, 4)     # 0.0..1.0
    if total < AMENITY_MIN_VOTES:
        return ("unknown", confidence)            # 1–2 votes: meter ticks, not yet truth
    if minority / total >= AMENITY_DISPUTE_RATIO:
        return ("disputed", confidence)
    return (("yes" if yes >= no else "no"), confidence)
```

`AMENITY_MIN_VOTES` defaults to **3** (not 2): at 2 votes, a single disagreement is `1/2 = 0.5 ≥ 0.34 → disputed`, so 2 disagreeing voters is the pathological modal early state, AND two sock-puppet accounts could unilaterally set a status. Requiring 3 means a fresh first map stays `unknown` (the completeness meter still ticks via the moving `confidence`), and two accounts can't unilaterally flip the public truth. Confidence asymptotically approaches `agreement` as volume grows → **diminishing reward for confirming known facts** (the Nth confirming voter barely moves it, so XP for confirming is small). Vote-weighting by account trust / confirmed visit is a future hardening lever, not v1.

## 6. Map-filter forward-compat (FUTURE — NOT in scope now)

The future amenity map filter is a pure clone of the existing, owner-shipped `beer_brand` filter on `/v1/pubs/near` (`PubsNearView`, `_nearby_pub_beer_brand_items`). It is NOT built now; this section only proves the model doesn't block it and lists the guarantees the in-scope build must provide.

**Future shape (do NOT build):**
```
GET /v1/pubs/near?lat=..&lng=..&radius_km=..&amenities=game_darts,seating_garden&amenities_match=all
```
- `amenities` = comma list of registry slugs, capped by env `PUBS_NEAR_MAX_AMENITY_FILTERS`. Unknown key → 400 (a client bug, unlike the write path). `amenities_match` = `all` (AND, default) | `any`.
- The actual query, like `_nearby_pub_beer_brand_items`, is a **lat/lng bounding-box range scan** over `PubAmenity` (filtered `status=yes`, `confidence__gte=MAP_AMENITY_CONFIDENCE_FLOOR`, `amenity_key__in=keys`) ordered by a squared-distance annotation, bounded by `MAP_AMENITY_SCAN_LIMIT` (mirroring `_BEER_BRAND_SCAN_LIMIT=200`), then a Python set-intersection of per-amenity `cache_key` sets for AND. The `(amenity_key, status)` index serves the equality predicate; the bbox keeps the row count small. (Honest note: the index does not cover the lat/lng range — the bounded scan limit is the guard, exactly as `beer_brand` relies on it today.)

**Index usage.** The `Index(amenity_key, status)` + `Index(cache_key)` + denormalised `lat`/`lng` on `PubAmenity` are shipped now (free at table creation; a migration on a populated prod table later). This is the single most important forward-compat guarantee.

**Cache strategy.** Like `beer_brand`, the filter is applied AFTER the Mapy cache read by intersecting the unfiltered cached item list against a `cache_key` set (`_filter_items_by_cache_key`). The `amenities` param is NEVER part of the `PubSearchCache` (geohash-6 + radius_bucket) identity, so it triggers ZERO extra Mapy fetches and does NOT fragment the cache into per-filter rows. For mapped pubs absent from a cell's Mapy results, emit synthetic suggest items (sourced from the single-truth `PubCommunityData`/`PubHours` row for that cache_key, NOT from per-amenity denormalised names which drift), matching `_pub_beer_brand_item`.

**Confidence gating.** The map surfaces a pub only when `status=yes` AND `confidence >= MAP_AMENITY_CONFIDENCE_FLOOR` (env, suggested 0.5) — a single low-confidence vote must not put a pub under a hard filter.

**Paywall note.** Per the monetization direction, the amenity-filtered map can be a Na Pivo+ gate (`Account.subscription_tier`): contributing votes/XP stays free (the data flywheel), the `?amenities=` read branch can degrade to unfiltered for free users. One tier check on one query branch, fully reversible, no data-model change, no `(account, lat/lng)` correlation logged. Do NOT build now.

**Data guarantees the current design must provide:** (G1) votes ≠ aggregate, separate tables; (G2) aggregate carries `(cache_key, amenity_key, status, confidence, lat, lng, name)`; (G3) `Index(amenity_key, status)` + `Index(cache_key)` from day one; (G4) `cache_key` computed by the same `geohash8(lat, lng)` everywhere; (G5) amenity keys additive-only, namespaced, never reused; (G6) aggregate upserted on every vote so the map never recomputes from votes. If G1–G6 hold, the filter is a purely additive future change with no vote-data migration.

## 7. Mapér gamification backend (additive surface)

### 7.1 XP authority — SERVER-authoritative, with optimistic local preview

XP is computed **server-side** (the one deliberate break from the local-first `deriveStats` pattern) because first-mapper / diminishing-reward depend on the global aggregate the client can't see and must not be allowed to forge. The vote PUT returns `xp_awarded` for an optimistic toast; the durable total is read off `GET /v1/account/me`. The vote always carries a Bearer token (even anonymous accounts have one via `ensureAccount()`), so XP follows the account through `claim` on sign-in. With the backend dormant/unconfigured, durable XP is 0 and the mobile Mapér surface shows a "připoj se / přihlas se" empty state rather than an optimistic number that would be clawed back. XP determinacy is pinned to `client_updated_at` ordering so a late-synced queued vote that was genuinely first still earns first-fact XP.

### 7.2 Additive surface on existing models/responses

- **Store XP on `AccountUsageStats`, NOT on the hot `Account` row.** Add to `AccountUsageStats`:
  ```python
  mapper_xp           = models.PositiveIntegerField(default=0)
  amenity_votes_count = models.PositiveIntegerField(default=0)
  mapped_pubs_count   = models.PositiveIntegerField(default=0)
  first_mapper_count  = models.PositiveIntegerField(default=0)
  completed_pubs_count= models.PositiveIntegerField(default=0)
  ```
  Incremented with `F('mapper_xp') + amount` inside the vote transaction (matching the established `F("walked_distance_m")` pattern at `views.py:1268`), keeping the contended `Account` row out of the gamification write path. These are stored counters (NOT derived-on-read) so `GET /v1/account/me` does not grow O(votes) scans. `level`/`title`/`xp_into_level`/`xp_for_next_level` stay derived (pure function of stored `mapper_xp`). No `db_index` on `mapper_xp` yet — the leaderboard is future; index then (cheap additive migration).
- **New `mapper` block on `GET /v1/account/me`** (additive sibling of `stats`, built in the serializer):
  ```json
  "mapper": {
    "xp": 285,
    "level": 3,
    "title": "Štamgast",
    "xp_into_level": 135,
    "xp_for_next_level": 250,
    "amenity_votes_count": 41,
    "distinct_mapped_pubs": 9,
    "first_mapper_count": 3,
    "completed_pubs_count": 1,
    "levels": [
      {"level": 1, "title": "Nováček", "xp": 0},
      {"level": 2, "title": "Všímálek", "xp": 50},
      {"level": 3, "title": "Štamgast", "xp": 150},
      {"level": 4, "title": "Znalec", "xp": 400},
      {"level": 5, "title": "Hospodský mudrc", "xp": 900}
    ],
    "xp_rules": {
      "first_fact": 15,
      "first_mapper_bonus": 25,
      "confirm": 5,
      "pub_complete_bonus": 30
    }
  }
  ```
  `levels` (the threshold/title table — exactly 5 levels) is returned so the client can map an optimistic XP estimate to a level+title locally for the level-up toast; server `level`/`title`/`xp_into_level`/`xp_for_next_level` are derived from the stored `mapper_xp` and are truth on reconcile. `xp_rules` is a **required** object exposing the four env-default XP constants (`first_fact`/`first_mapper_bonus`/`confirm`/`pub_complete_bonus`) so the mobile optimistic-XP toast estimates from a shared source of truth instead of a hardcoded guess; the per-vote authoritative award is still returned separately as `xp_awarded` on the PUT response.
- **New additive booleans inside the existing `achievements` block** (5 Mapér badges):
  ```json
  "achievements": {
    "first_ten": true, "regular": false, "reviewer": true,
    "first_map": true, "explorer": false, "cartographer": false,
    "completionist": true, "fact_machine": false
  }
  ```
  The five canonical badges (wire key → Czech name → unlock rule, server-derived from the stored counters):

  | wire key | Czech name | unlock rule | glyph |
  |---|---|---|---|
  | `first_map` | Prvomapér | `first_mapper_count >= 1` | `SproutIcon` |
  | `explorer` | Objevitel | `distinct_mapped_pubs >= 10` | `MapPinnedIcon` |
  | `cartographer` | Kartograf | `distinct_mapped_pubs >= 25` | `MapPinnedIcon` |
  | `completionist` | Pořádkumil | `completed_pubs_count >= 1` | `BadgeCheckIcon` |
  | `fact_machine` | Pivní detektiv | `amenity_votes_count >= 100` | `ClipboardListIcon` |

  Disjointness is locked: no level title ({Nováček, Všímálek, Štamgast, Znalec, Hospodský mudrc}) reuses a badge name ({Prvomapér, Objevitel, Kartograf, Pořádkumil, Pivní detektiv}) — `Kartograf`/`Pivní detektiv` are badge titles only, NOT level titles. **Cross-repo note:** the mobile `parseAchievements` (`src/data/auth.ts`) currently hard-reads only `first_ten/regular/reviewer` — new badges require a coordinated mobile release extending the parser AND the offline fallback object, rendered with `unlocked={achievements.<key> ?? false}`. Released apps are unaffected (they ignore the unknown keys); the new badges are simply invisible until shipped. This is additive on the wire, NOT free on the client.
- **`ClientEvent.Event` — new additive enum members** (the column is `max_length=64` `TextChoices`; adding members is additive, existing rows unaffected, mirroring `0018/0021_alter_clientevent_event`):
  ```python
  AMENITY_VOTED       = "amenity_voted",       "Amenity voted"
  AMENITY_VOTE_SYNCED = "amenity_vote_synced", "Amenity vote synced"
  AMENITY_VOTE_FAILED = "amenity_vote_failed", "Amenity vote sync failed"
  ```
  The sheet fires `AMENITY_VOTED` on submit; the queue fires synced/failed like `DRINK_SYNCED`/`DRINK_SYNC_FAILED`. NO client-fired `maper_level_up` event — the server already knows level transitions authoritatively; a forgeable client event would just pollute the indexed `ClientEvent` table. Events carry operation/status only — never coordinates, pub name, or vote contents.

### 7.3 Anti-abuse / vote weighting

- **XP is idempotent per (account, cache_key, amenity_key)** via the `awarded_xp` field on `PubAmenityVote`. The base "answered this amenity" XP is paid at most once per row, ever. Flipping yes↔no or re-voting the same value updates `value`/`client_updated_at` (LWW) but pays **0** because `awarded_xp > 0`. Retract-then-re-vote does NOT re-pay (the row's prior `awarded_xp` is restored on re-creation within a short window, or first-mapper is keyed off the aggregate's immutable `first_mapper` so it can't be re-farmed). The only way to earn XP is to map facts you haven't mapped.
- **First-mapper bonus is globally one-time per pub**, decided server-authoritatively off the aggregate's IMMUTABLE `first_mapper` (set on row creation, never reassigned — §5.3). Concurrency-safe via the `get_or_create` race winner. Recommended (env-gated): require ≥3 amenities mapped in the first session before the first-mapper bonus mints, to kill drive-by single-vote pub-claiming on GPS-spoofed empty cells.
- **Per-account/IP throttle**: dedicated `pub_amenities` scope on the PUT (env-driven rate, default e.g. `120/min` matching `pub_ratings`). An env-var daily distinct-cache_key vote cap (`AMENITY_MAX_PUBS_PER_DAY`) blunts city-grid grinding.
- **`AMENITY_MIN_VOTES=3`** (§5.4) means two sock-puppets can't set public truth or fake confidence; the aggregate uses `distinct_voter_count` (one vote per account by the unique constraint) so stacking requires distinct accounts.
- **v1 XP is cosmetic/personal progress**, no rank language until the leaderboard slice ships; the future leaderboard MUST recompute/validate XP server-side before any ranking. Anomaly telemetry (if added) stays server-internal `severity=warning`, never in any public/leaderboard read.

## 8. Migrations list, serializer sketches, anti-abuse & rate limits

### 8.1 Migrations (in order, additive)

1. **`0036_amenitykind_pubamenityvote_pubamenity.py`** — `CreateModel` for `AmenityKind`, `PubAmenityVote`, `PubAmenity` with the constraints/indexes in §2. `DEFAULT_AUTO_FIELD=BigAutoField` (project default). Pure schema.
2. **`0037_seed_amenity_kinds.py`** — `RunPython` data migration, idempotent `update_or_create` over the §3 seed list, `reverse_code` deleting the seeded keys. Mirrors `0031_seed_beer_brands`. No vote backfill.
3. **`0038_accountusagestats_mapper_fields.py`** — `AddField` `mapper_xp` + the four mapper counters on `AccountUsageStats` (defaults, additive). `AlterField` `ClientEvent.event` to add the three new enum members (mirrors `0021`).
4. **(future, out of scope)** a release-note migration when the feature ships in a mobile version, per the `0016/0023/0029` convention.

### 8.2 `settings.py` additions (every limit is an env var)

```python
PUB_AMENITIES_THROTTLE_RATE = os.environ.get("PUB_AMENITIES_THROTTLE_RATE", "120/min")  # matches pub_ratings
AMENITY_KINDS_THROTTLE_RATE = os.environ.get("AMENITY_KINDS_THROTTLE_RATE", "120/min")
AMENITY_READS_THROTTLE_RATE = os.environ.get("AMENITY_READS_THROTTLE_RATE", "60/min")   # local DB only; NOT pubs_near
AMENITY_READ_MAX_KEYS       = int(os.environ.get("AMENITY_READ_MAX_KEYS", "60"))
AMENITY_MIN_VOTES           = int(os.environ.get("AMENITY_MIN_VOTES", "3"))
AMENITY_DISPUTE_RATIO       = float(os.environ.get("AMENITY_DISPUTE_RATIO", "0.34"))
AMENITY_MAX_PUBS_PER_DAY    = int(os.environ.get("AMENITY_MAX_PUBS_PER_DAY", "200"))
MAPER_XP_FIRST_FACT         = int(os.environ.get("MAPER_XP_FIRST_FACT", "15"))
MAPER_XP_FIRST_MAPPER_BONUS = int(os.environ.get("MAPER_XP_FIRST_MAPPER_BONUS", "25"))
MAPER_XP_CONFIRM            = int(os.environ.get("MAPER_XP_CONFIRM", "5"))
MAPER_XP_PUB_COMPLETE_BONUS = int(os.environ.get("MAPER_XP_PUB_COMPLETE_BONUS", "30"))
# register pub_amenities + amenity_kinds + amenity_reads in DEFAULT_THROTTLE_RATES
```

### 8.3 Serializer sketches (`pubs/api/serializers.py`)

```python
class PubAmenityVoteRequestSerializer(serializers.Serializer):
    """One row of the PUT /v1/pub-amenities/votes {"votes": [...]} array."""
    name = serializers.CharField(max_length=255, required=False, allow_null=True, allow_blank=True, default="")
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    city = serializers.CharField(max_length=128, required=False, allow_null=True, allow_blank=True, default="")
    external_id = serializers.CharField(max_length=128, required=False, allow_null=True, allow_blank=True)
    amenity_key = serializers.SlugField(max_length=40)          # active-kind check in the VIEW (ignore-not-400)
    value = serializers.ChoiceField(choices=PubAmenityVote.Value.choices, required=False, allow_null=True)  # null => retract
    client_updated_at = serializers.DateTimeField()             # wire field; the per-amenity LWW key
    taxonomy_version = serializers.IntegerField(required=False, allow_null=True, min_value=1)  # analytics-only; stored, never validated
    # NO validation that 'value' or 'amenity_key' is recognized → never 4xx an old/new client (regression-tested, §8.5)

class PubAmenityKindSerializer(serializers.Serializer):        # output only — emits canonical wire names
    key = serializers.CharField(source="key")
    group = serializers.CharField(source="group")
    label_cs = serializers.CharField(source="label")
    short_label_cs = serializers.CharField(source="short_label")
    icon = serializers.CharField(source="icon")
    map_filterable = serializers.BooleanField(source="filter_candidate")
    is_active = serializers.BooleanField(source="active")
    order = serializers.IntegerField(source="rank")

class PubAmenityReadQuerySerializer(serializers.Serializer):
    cache_keys = serializers.CharField()   # comma-split + cap to AMENITY_READ_MAX_KEYS in the view
    name = serializers.CharField(required=False, allow_blank=True, default="")  # names_match guard
```
Plus plain helper functions matching `_rating_item` style: `_amenity_vote_item(vote)`, `_amenity_aggregate_item(agg, my_value=None)` (the `<Aggregate>` superset — `amenity_key`/`yes_count`/`no_count`/`distinct_voter_count`/`status`/`confidence` rounded to 2 on the wire, PLUS `my_value` populated only when the request is authenticated; lat/lng/name never emitted). The PUT-response item builder MUST always include `ignored_unknown_amenity` (a bool, not optional) alongside the existing `applied`/`deleted`/`was_first_map`/`xp_awarded`/`vote`/`aggregate`. New `AccountMapperSerializer` (emitting `xp_rules` + the 5-level `levels` array) + `parseMapper` mirror on mobile.

### 8.4 Anti-abuse & rate limits — summary

Per-IP `ScopedRateThrottle` on every new view; per-account daily pub cap; XP idempotent per vote row; first-mapper immutable + globally one-time + optional ≥3-amenity gate; `AMENITY_MIN_VOTES=3`; `names_match` collision guard on reads; no PII/coords in telemetry or logs. (See §5.4, §7.3.)

### 8.5 Test plan (run on sqlite AND postgres)

Per-amenity LWW (stale push of one amenity does NOT clobber another); retraction (`value:null`) deletes + recomputes aggregate; concurrent first-voters (two simultaneous first votes → one row, no IntegrityError 500, counts correct, first_mapper set once); aggregate recount under flip yes→no→retract; `_amenity_status` boundaries for total ∈ {0,1,2,3,4} (unknown until 3, disputed ratio); unknown/inactive `amenity_key` PUT → `200 applied:false ignored_unknown_amenity` (NOT 400 — additive-compat regression test, asserts old/new clients never break); **future/unknown extra fields tolerated** (2xx); `names_match` read guard (neighbour business in same cell does NOT inherit votes); deactivated kind excluded from reads + completeness clamped ≤100%; XP idempotency (flip/re-vote pays 0; retract+re-vote does not re-farm; first-mapper not reattributed on retract); `mapper` block + new achievements booleans present on `GET /me`; `kinds` version is full ISO timestamp (two same-day edits differ); account deletion/export covers `PubAmenityVote` (location-adjacent per-user dataset).

## 9. Open questions & risks

1. **Geohash-8 collisions for distinct businesses in one cell.** Mitigated by the read-time `names_match` guard (§2.6), but v1 keeps one aggregate row per cell with the dominant (most-recent) name. If dense historic centres prove this lossy, a future refinement splits a cell by (cache_key, normalized name) — the keys are permanent so this must be acknowledged now. **Decision needed:** accept geohash-8 granularity as a product limitation for v1, or design name-bucketing into the aggregate identity before launch.
2. **First-mapper drive-by farming.** The ≥3-amenities-per-session gate is recommended-but-env-gated; the lat/lng is fully client-controlled (no proximity check). A confirmed-`PubVisit`-near-the-cell weighting is the stronger future lever. **Decision needed:** is the env gate enough for v1, or is a visit precondition required before any first-mapper XP?
3. **Seasonal facts** (`seating_garden` in winter, weekend-only `atmosphere_live_music`) look identical to "never answered" and can pollute year-round truth + the completeness meter. v1 treats amenities as stable/structural facts ("má prostor pro zahrádku", not "zahrádka je dnes otevřená"). **Decision needed:** ship flat yes/no over the seasonal handful, or add a "sezónně/občas" nuance for those keys.
4. **`payment_card` vs `payment_cash_only` contradictions.** Modeled as two independent keys (sheet suggests-not-forces the opposite). A meaningful share of users will tap both as "bere obojí," producing flagged yes/yes conflicts the aggregate must tolerate. **Decision needed:** keep two keys (and surface the conflict as data), or collapse to one tri-state `payment_card` (yes=karta, no=jen hotovost) the way smoking was collapsed.
5. **`atmosphere_smoking` filter semantics.** "Kde se nekouří" is the common Czech intent, which is the `no`-majority case. The future filter must express "filter FOR nonsmoking = `atmosphere_smoking` status `no` above confidence floor." Documented here so the filter isn't blocked; confirm before locking.
6. **Recompute cost at scale.** Synchronous full-recount under an aggregate-row lock serializes voters on a single very hot pub+amenity. Acceptable for early scale; the `F()`-delta path under the same lock is the committed escalation (no model change). **Risk, not a v1 blocker.**
7. **Completeness denominator drift.** Adding/removing an active `AmenityKind` changes `total_kinds`, so a pub's `completeness` shifts without user action and a previously "100% personal" pub can regress. The completion bonus is paid once and never clawed back, but the displayed ring can drop. **Decision needed:** freeze personal completion against the kind set at completion time, or accept the meter is live (computed from the current active set) and frame it as live progress.
8. **Cross-repo client work.** Mobile must add ~16 IconGlyph lucide wraps, a new `pubAmenitiesStore`/`Queue`/`Client`/`Sync` trio with `(pubKey, amenity_key)` dedup (the rating queue's `pubKey`-only dedup would silently drop sibling-amenity votes), extend `parseAchievements` + offline fallback for the new badges, and add the amenity store/queue keys to `clearLocalPrivateAccountData` (account-boundary wipe) so votes don't leak across accounts. Tracked in the mobile spec; called out here because the backend contract assumes it.
