# Zmapuj hospodu — MOBILE contract (design only)

Public, community-voted pub amenities ("Zmapuj hospodu"): each user votes **ano/ne** per amenity, the backend aggregates votes into a confidence-weighted public truth shown to everyone, and the **Mapér** layer turns mapping into the app's first XP game. Backend wire mirror at `na-pivo-backend/docs/pub-amenities-spec.md`. **This is a DESIGN spec — no source files are written.** The data layer is shaped so the FUTURE pub map+filter drops in additively; the filter is NOT built now.

The wire contract below is byte-identical to the canonical cross-repo contract that both this doc and the backend mirror conform to: same slugs, wire field sets, level ladder, badges and icon names. Where this doc and the backend doc must agree, the canonical contract is the single source of truth.

## 1. Overview & product rationale

**The feature.** A bottom sheet, launched from the evening card / pub context, lets the user answer yes/no to a curated set of objective pub facts ("platba kartou?", "šipky?", "zahrádka?"). Each answer is a public vote. The backend folds every user's votes into a per-pub, per-amenity aggregate (`yes_count`/`no_count` → `status` + `confidence`) that is shown to everyone and powers a future map filter ("ukaž hospody se šipkami a zahrádkou").

**Why public community truth, not private rating.** The existing `PubRating` (like/dislike) is a private memory — yours, never shown to others, absence = no opinion. Amenities are the opposite: they are **objective facts about a place** that only become valuable when aggregated across people. So they get their own store, queue, client, and sync (mirroring the proven `pubRatings` trio) but with a fundamentally different read model: the truth the sheet shows is a server-owned aggregate, while the user's own pending votes overlay it optimistically. The two are kept in physically separate stores so a stale aggregate snapshot can never clobber a fresh local tap.

**The Mapér loop in one paragraph.** You open a pub, the sheet shows what the crowd already knows and how complete the pub is ("zmapováno z 60 %"); you tap a few honest answers; a toast fires instant XP ("+10 XP — díky, mapére!"), the per-pub completeness ring ticks up, and your Profile **MAPÉR** section climbs toward the next level (Nováček → Štamgast → Hospodský mudrc). First-mapper bonuses pull you toward unmapped pubs (the data we lack); confirming an already-known fact pays little (diminishing reward), so the rational way to earn XP is to honestly map pubs you actually visit — exactly the data the map needs.

**Privacy stance.** Per-pub data is keyed by coarse **geohash-8** (~38 m), identical to `PubRating`/`PubCommunityData`/`PubBeerBrand`. `lat`/`lng` ride only in the user-triggered PUT body the user themselves caused, are used solely server-side to re-derive `cache_key`, and are **never logged**. The public aggregate carries no per-user identity; the user's own votes are per-account (Bearer) but their *meaning* is a public contribution, not a private trail. New telemetry events log operation only (mirroring `RATING_SYNCED`) — no coordinates, names, vote contents, tokens, or PII. The per-user vote set is a location-adjacent dataset and MUST be wired into account export + deletion + the local account-wipe seam (§4.7).

**Future monetization note.** The amenity-filtered **map** is a plausible Na Pivo+ boundary: *contributing* votes + earning Mapér XP/badges stays free for everyone (the gamification flywheel is what makes the map worth paying for; gating contribution would starve it), while *consuming* the future `?amenities=` filtered map can be a `subscription_tier == 'plus'` gate on one query branch (degrade silently to the unfiltered map for free users). Do not build the gate now; the data model just leaves it cheap to add.

## 2. Amenity taxonomy

The taxonomy is **client-bundled and authoritative for rendering** (labels, chips, glyphs, sections, order all ship in the app so the sheet works offline / with the backend dormant). The backend serves the same set via `GET /v1/pub-amenities/kinds` as a forward-compat overlay: the client renders only amenities it has a bundled definition + glyph for, and **passes unknown keys through untouched** on any round-trip (an old app never destroys a newer app's data — JSONField-style tolerance). Icons can never be server-driven (no-emoji rule + we don't ship arbitrary SVG), so a brand-new amenity always lands with its lucide wrap in an app release.

`amenity_key` is a **stable, group-prefixed, lowercase snake_case slug**. The five group prefixes are exactly `payment_`, `seating_`, `game_`, `atmosphere_`, `practical_`. Never renamed, never reused — it is the wire value, the store key, and the future map-filter key. New amenities are appended (additive); deprecated ones are deactivated (`is_active=false`), never repurposed. Each amenity's `group` field = its key prefix mapped to the group name: `payment_`→`payment`, `seating_`→`seating`, `game_`→`games`, `atmosphere_`→`atmosphere`, `practical_`→`practical`. Note the deliberate, locked asymmetry: the prefix is `game_` (singular) but the group value is `games` (plural). Group display order (sheet + `GET /v1/pub-amenities/kinds`): `payment`, `seating`, `games`, `atmosphere`, `practical`.

> **`value` semantics.** Each amenity is a per-user **tri-state**: `'yes'` (je tu to), `'no'` (není tu to), or **unknown = no vote** (the key is simply absent — never a stored third enum). Unknown is the absence of an answer, so the wire stays tiny, "nezmapováno" is the natural default, and a released app forward-compatibly omits keys it doesn't know. This mirrors `PubRating` (verdict absent = no opinion). Booleans were rejected: a boolean conflates "no" with "not answered", which would manufacture phantom "no" votes, poison the public aggregate, and make the completeness meter (which counts *answered* amenities) meaningless. To **retract** a vote across devices, the wire sends `value: null` (an explicit tombstone) — distinct from an absent key (which always means "no change / unknown"). Absent never means "clear" (§4.1).

Section headers are uppercase, matching the existing `statsHeader = 'TVOJE ČÍSLA'` convention. v1 ships **16 active amenities** (≤20, scannable at a pub table) across five groups. `practical_outdoor_tap` and `practical_tank_beer` are **reserved keys, not rendered in v1** (`is_active=false`): present in the seed/catalogue, excluded from `GET /kinds`, the sheet, and both numerator and denominator of completeness — reserving the keys now means activating them later is a taxonomy bump, never a collision. `nekuřácká` + `kuřárna` collapse into the single tri-state `atmosphere_smoking` (§ note below).

The canonical taxonomy table below is the locked single source. Columns: `key | group | label (cs) | chip (cs) | IconGlyph / NEW glyph | map-filter candidate | is_active | order`. `order` is the integer render rank (lower first). Only `is_active=true` rows are returned by `GET /kinds`, rendered in the sheet, and counted in `total_kinds`.

### Section `payment` — "PLATBA"

| amenity_key | label (cs) | chip (cs) | IconGlyph / NEW glyph | map-filter candidate | is_active | order |
|---|---|---|---|---|---|---|
| `payment_card` | Platba kartou | Karta | **NEW** `CreditCardIcon` (lucide `CreditCard`) | yes | true | 10 |
| `payment_cash_only` | Jen hotovost | Hotovost | **NEW** `BanknoteIcon` (lucide `Banknote`) | yes | true | 20 |

### Section `seating` — "POSEZENÍ"

| amenity_key | label (cs) | chip (cs) | IconGlyph / NEW glyph | map-filter candidate | is_active | order |
|---|---|---|---|---|---|---|
| `seating_garden` | Zahrádka / terasa | Zahrádka | `TreePineIcon` (exists) | yes | true | 30 |
| `seating_barrier_free` | Bezbariérový přístup | Bezbariér | **NEW** `AccessibilityIcon` (lucide `Accessibility`) | yes | true | 40 |
| `seating_kids_corner` | Dětský koutek | Děti | **NEW** `BabyIcon` (lucide `Baby`) | yes | true | 50 |

### Section `games` — "ZÁBAVA"

| amenity_key | label (cs) | chip (cs) | IconGlyph / NEW glyph | map-filter candidate | is_active | order |
|---|---|---|---|---|---|---|
| `game_darts` | Šipky | Šipky | **NEW** `TargetIcon` (lucide `Target`) | yes | true | 60 |
| `game_billiards` | Kulečník | Kulečník | **NEW** `DicesIcon` (lucide `Dices`) | yes | true | 70 |
| `game_foosball` | Stolní fotbal | Fotbálek | **NEW** `Gamepad2Icon` (lucide `Gamepad2`) | yes | true | 80 |
| `game_jukebox` | Jukebox | Jukebox | **NEW** `RadioIcon` (lucide `Radio`) | no | true | 90 |

### Section `atmosphere` — "ATMOSFÉRA"

| amenity_key | label (cs) | chip (cs) | IconGlyph / NEW glyph | map-filter candidate | is_active | order |
|---|---|---|---|---|---|---|
| `atmosphere_live_music` | Živá hudba | Živá hudba | **NEW** `MicIcon` (lucide `Mic`) | no | true | 100 |
| `atmosphere_sports_tv` | Sport v televizi | Sport v TV | **NEW** `TvIcon` (lucide `Tv`) | yes | true | 110 |
| `atmosphere_dogs_welcome` | Psi vítáni | Psi | **NEW** `DogIcon` (lucide `Dog`) | yes | true | 120 |
| `atmosphere_smoking` | Kuřárna / kouření povoleno | Kouření | **NEW** `CigaretteIcon` (lucide `Cigarette`) | yes | true | 130 |

### Section `practical` — "PRAKTICKÉ"

| amenity_key | label (cs) | chip (cs) | IconGlyph / NEW glyph | map-filter candidate | is_active | order |
|---|---|---|---|---|---|---|
| `practical_wifi` | Wi-Fi | Wi-Fi | `WifiIcon` (exists) | yes | true | 140 |
| `practical_parking` | Parkování | Parkování | **NEW** `SquareParkingIcon` (lucide `SquareParking`) | yes | true | 150 |
| `practical_food` | Kuchyně / dá se najíst | Kuchyně | **NEW** `UtensilsIcon` (lucide `Utensils`) | yes | true | 160 |
| `practical_outdoor_tap` *(reserved, not rendered v1)* | Venkovní výčep | Výčep | **NEW glyph required before activation** (NOT `BeerIcon` reuse) | no | **false** | 170 |
| `practical_tank_beer` *(reserved, not rendered v1)* | Tankové pivo | Tank | `BeerIcon` (exists) | yes | **false** | 180 |

**Active set = exactly the 16 rows with `is_active=true`.** The two `is_active=false` rows (`practical_outdoor_tap`, `practical_tank_beer`) are RESERVED. => `total_kinds` (active) = **16**, so per-pub completeness can reach 100%.

> **Smoking is ONE tri-state amenity (`atmosphere_smoking`).** `yes` = lze kouřit / je kuřárna; `no` = nekuřácká; unknown = nezmapováno. Modeling `kuřárna` and `nekuřácká` as two keys recreates the boolean trap (both could read "yes" → contradictory public truth). Czech indoor-smoking law makes granularity low-value. If "dedicated smoking room" granularity is ever needed, it is an additive `atmosphere_smoking_room` in a later version, never a v1 second key.

> **`payment_card` vs `payment_cash_only` — soft mutual exclusion, not auto-toggle.** Reality is messy ("karta od 200 Kč"), so they are two independent tri-state votes. The sheet *suggests* the opposite (pre-highlights `payment_cash_only = no` when you set `payment_card = yes`, one tap to confirm) but never forces it. The aggregate treats them as two facts; a venue high-confidence "yes" on both is a flagged conflict for the backend to resolve, not a client bug. **Open risk (§8):** the labels invite "bere obojí" double-taps; if conflicts pollute the aggregate, the fallback is to collapse to a single `payment_card` tri-state where `no` = jen hotovost.

> **`seating_garden` vs the existing `hasGarden`.** `Pub.hasGarden` is the firmy.cz-derived server fact powering the existing `gardenBadge = 'Zahrádka'`. The `seating_garden` amenity is the **community-voted** version. They coexist; **neither overwrites the other on the wire** (API compat). The backend may *seed* the `seating_garden` aggregate's prior from `has_garden`. The badge precedence rule (community overrides firmy only above a confidence threshold; otherwise "podle Firmy.cz") is a backend read-path decision — the mobile client just renders whichever the aggregate/Pub exposes and never writes votes into `hasGarden` (§4.6).

> **Taxonomy version.** A bundled `CURRENT_TAXONOMY_VERSION = 1` is sent as `taxonomy_version` metadata — it records which taxonomy the votes were captured against, for analytics and possible future re-check nudges. It is **never** a validation gate; the backend must 2xx an unknown/future version (a released app must never be 4xx'd for sending one). Section size (Σ amenities) is server-authoritative for the completeness denominator — the client must read `total_kinds` from the backend (§5.2), never hard-code it, so a future amenity addition doesn't make the client and server meters disagree.

## 3. "Zmapuj hospodu" sheet UX

A near-clone of `src/components/compass/BeerBrandFilterSheet.tsx`: `Modal transparent animationType="fade"`, a `progress` shared value spring `withSpring(1, { damping: 18, stiffness: 180, mass: 0.9 })`, scrim `Pressable` backdrop at `withAlpha(Colors.black, 0.6)`, drag handle (40×4, `Radius.pill`, `Colors.border`), `KeyboardAvoidingView`, safe-area bottom pad `Math.max(insets.bottom, Spacing.md)`. Reuse that file as the scaffold.

### 3.1 Layout

The sheet is one `Animated.View` card: bg `Colors.stout2` `#2B1A0E`, `borderTopLeftRadius/RightRadius: Radius.cardLarge` (28), `1px Colors.border` `#5A3A20`, `softDrop()`, `paddingTop: Spacing.sm`, `paddingHorizontal: Spacing.lg` (20). Top → bottom:

1. **Drag handle** (shared style, `marginBottom: Spacing.md`).
2. **Header** — title block `flex:1` (pub name, `Fonts.display` extrabold 22, `Colors.foam`; sub-line `Colors.mutedText` 13/18); a **completeness ring** (§3.4) in the top-right; an `XIcon` close (44×44, `Colors.foamMuted`) absolute at `top: Spacing.sm, right: Spacing.sm` so it never competes with the ring. Scrim tap + drag-down also close.
3. **Body** — a single `ScrollView` (`keyboardShouldPersistTaps="handled"`, `showsVerticalScrollIndicator={false}`, `maxHeight` ~60% screen) of grouped amenity rows under uppercase section labels (`Fonts.ui.semibold` 12, `letterSpacing: 1`, `Colors.mutedText`, `marginTop: Spacing.lg`).
4. **No bottom "Uložit" CTA.** Each tap is its own optimistic commit (like `pubRatingsStore.setRating`). The single primary affordance is each row's control. A footer micro-hint explains auto-save: *"Každá odpověď se uloží sama. Díky!"* (`Fonts.ui.regular` 12, `Colors.mutedText`).

### 3.2 Three-state tap interaction

Each amenity is **one full-width row** (`minHeight: 56`, `flexDirection: row`, `alignItems: center`, `gap: Spacing.md` 14, `borderBottomWidth: 1`, `borderBottomColor: withAlpha(Colors.border, 0.5)`):

```
[icon]  Label                          8× ano · 1× ne   [ ANO | NE ]
```

- **Leading icon** (24): `Colors.mutedText` untapped; turns `Colors.amber` once you've voted *ano*; stays muted on *ne* — a fast at-a-glance "what's here" scan.
- **Label** `Fonts.ui.semibold` 15, `Colors.foam`, `flex:1`, `numberOfLines={1}` (at large Dynamic Type the community signal stacks below the label and the row grows past 56 — §3.6).
- **Community signal** (§3.3), right-aligned, before the control.
- **Control = a segmented two-button pill `ano` / `ne`** — NOT a single cycling tap target (a blind cycle is undiscoverable and a11y-hostile). Each half is its own ≥44pt target inside the pill.
  - Untapped: both halves `Colors.stout3` `#3A2515` fill, `Colors.foamMuted` text, `1px Colors.border`.
  - **Ano selected**: left half `Colors.amber` fill, `Colors.stout` text, leading `CheckIcon size={14} Colors.stout`; right half muted.
  - **Ne selected**: right half `withAlpha(Colors.mutedText, 0.25)` fill, `Colors.foam` text, leading `XIcon size={14}`; left half muted. "Ne" is deliberately *calm*, never red.
  - **Tapping the already-selected half clears the vote** (→ untapped) — this is the retract path: ano→ano = set then clear; ano→ne = flip. Clearing emits a `value: null` tombstone (§4).

Press feedback: tapped half scales `0.95 → 1.05 → 1.0` via `withSequence(withTiming(0.95,{duration:60}), withSpring(1,{damping:12,stiffness:260}))`, **gated by reduce-motion**; color flips immediately (<100ms). The vote is written to `pubAmenitiesStore.setVote(pubKey, key, next)` → store mutation → selector → instant re-render (§4).

### 3.3 Live community signal (with explicit states)

Three distinct per-row states — never collapse "loading" into "unknown":

- **Loading / offline** (aggregate snapshot not yet resolved, backend dormant): no count badge, just the yes/no control. The sheet is fully usable for voting before the GET resolves (optimistic-first). The sheet header shows a subtle muted note when the backend is dormant.
- **Known**: `"{yes}× ano · {no}× ne"` (`Fonts.ui.medium` 12, `Colors.mutedText`). When `effectiveVerdict === 'disputed'` the copy reads *"lidi se neshodnou"*.
- **Genuinely unmapped** (successful GET confirmed zero votes): `nezmapováno` in muted italic-weight. Never render `0× ano` from an unresolved/failed fetch — that would misrepresent a mapped pub as empty and discourage voting.
- **First mapper**: when both counts were 0 before your tap, after tapping show `prvně zmapováno!` in `Colors.amberLight`.

The displayed counts show the **server's numbers for other users' votes**; the user's own contribution is reflected by the pill state, not by mutating the community tally (no ±1 arithmetic that drifts offline). On snapshot refresh the count is replaced wholesale. The backend returning `my_value` per amenity in the aggregate read makes "your answer wins for you" exact, with no flicker (§4.5).

### 3.4 Completeness ring

A 56×56 circular progress ring in the header, built with `react-native-svg` (already a dep). Track circle `Colors.stout3`, progress arc `Colors.amber` + `amberGlow(8)` when >0, stroke 5, rounded caps. Center `{pct}%` in `Fonts.display.bold` 15, `Colors.foam`; caption `zmapováno` below. The headline ring shows the **community completeness** (the nested `completeness: { mapped_count, total_kinds, pct }` from the aggregate read — §5.2), which is the honest "is this place known" number that the future map cares about. A secondary sub-line shows personal progress: *"ty jsi zmapoval/a {n} z {total}"*. Keeping the two numbers visually distinct prevents conflation.

Ring fill animates `withTiming(pct, { duration: 280 })`, **gated by reduce-motion** (set the arc directly when `AccessibilityInfo.isReduceMotionEnabled`). Center number uses `maxFontSizeMultiplier={FontScaleCap.display}`.

### 3.5 Instant XP feedback

On every *new or changed* vote that the optimistic estimator thinks earns points, fire the existing `Toast` + `toastStore`. The Mapér toast must be **emoji-free** (the current `Toast.tsx` renders a literal 🍺 at the leading slot): add an optional leading-`IconGlyph` slot to `toastStore.show`/`Toast` that defaults to the existing 🍺 (so the existing beer toast stays byte-identical — this is a required *additive* refactor of a globally-mounted component, not a silent cleanup), and pass `CompassIcon`/`SproutIcon` in `Colors.amber` for Mapér events.

XP is **estimated locally for the instant toast and reconciled from the server** (the server is the truth — it knows global state the client can't, like "were you truly first"). The toast is a transient feel-good estimate, never a ledger; the durable number on Profile only ever comes from `GET /v1/account/me` (§5). To avoid slot-machine spam when a user taps 5–16 rows in one session, **coalesce XP into one summary toast** (debounced ~600ms after the last tap, or fired on sheet close): *"Zmapováno 6 věcí · +24 XP"*. A first-mapper hit and a level-up still warrant their own stronger toast (*"Prvomapér! +40 XP"*, *"Level up — teď jsi Štamgast!"*) — the level name comes from the bundled threshold table so an optimistic level-up can be named locally, with server `level`/`title` as truth on reconcile.

### 3.6 Entry points, accessibility, reduced-motion, Dynamic Type

**Entry point.** The sheet launches from the **pub context** — primary host is the evening card (the locked decision's "evening card / pub context"). Extract a single `MapPubButton` component (icon + label + %-nudge dot + a11y) so a future second host (compass/discovery pub rows) is a one-line mount and the partial-% logic never drifts. The trigger is a pill (`Radius.pill`, `minHeight: 44`, `Colors.stout3` fill, `1px Colors.border`, `MapPinnedIcon size={16} Colors.amber` + `Colors.foamMuted` label), styled like `GlowButton secondary` (glow `none`):

- Not mapped at all → `Zmapuj hospodu`.
- Partially mapped → `Doplň mapu hospody` + trailing `· {pct} %` in `Colors.amber` + a 6×6 amber dot.
- Fully mapped → `Hospoda je zmapovaná`, dot hidden, pin → `BadgeCheckIcon` `Colors.success`.

`accessibilityRole="button"`, label `"Zmapuj hospodu {pubName}, zmapováno z {pct} procent"`.

**Accessibility.** The ternary control is two independent `accessibilityRole="button"` halves with `accessibilityState={{ selected }}`, labels `"{amenity}: ano"` / `"{amenity}: ne"`, and `accessibilityHint="Ťukni znovu pro zrušení"` (NOT a `switch` — switch is binary, this is ternary-with-retract). The chip text in the *sheet* always reflects the **user's own vote**, never the aggregate verdict, so VoiceOver can't read a label that contradicts the user's tap (aggregate-driven label flipping like "Nekuřácká" belongs only to the read-only pub card). The ring is `accessibilityRole="progressbar"`, `accessibilityValue={{ now: pct, min: 0, max: 100 }}`, label `"Zmapováno z {pct} procent"`. The Mapér level card → `accessibilityLabel "Mapér úroveň {n}, {title}, {xp} z {next} XP"`.

**Reduced motion.** One shared `useReduceMotion` flag gates (a) the SVG arc tween, (b) the Reanimated pill press-scale, (c) the XP-bar width tween, and (d) the Mapér toast spring (the reused `Toast` does NOT gate its spring today — fix on reuse).

**Dynamic Type.** Every `<Text>` sets `maxFontSizeMultiplier` per `FontScaleCap` (display 1.1 / heading 1.2 / body 1.3) — including the count line ("{yes}× ano · {no}× ne"). At max body=1.3 on a narrow device (SE), the community signal stacks **below** the label (two-line row, row grows past 56) instead of truncating the label to "...".

### 3.7 ASCII mockups

**Mockup 1 — Sheet default (fresh pub, nothing voted yet)**

```
                                              ┌─[X]─┐
╭───────────────────────────────────────────────────╮
│                      ▬▬▬▬                           │  handle 40×4 Colors.border
│                                                     │
│  U Zlatého tygra                       ╭───────╮    │  title 22 extrabold foam
│  pomoz ostatním — co tady je?          │  0%   │    │  ring 56, arc empty
│                                        ╰───────╯    │  sub 13 mutedText
│                                        zmapováno    │
│                                                     │
│  PLATBA                                            │  sectionLabel 12 caps muted
│  [card] Platba kartou        nezmapováno [ ANO|NE ] │  icon mutedText, control stout3
│  [cash] Jen hotovost         nezmapováno [ ANO|NE ] │
│                                                     │
│  POSEZENÍ                                           │
│  [tree] Zahrádka / terasa    nezmapováno [ ANO|NE ] │
│  [♿]   Bezbariérový přístup nezmapováno [ ANO|NE ] │
│  [baby] Dětský koutek        nezmapováno [ ANO|NE ] │
│                                                     │
│  ZÁBAVA                                             │
│  [tgt]  Šipky                nezmapováno [ ANO|NE ] │
│  [dice] Kulečník             nezmapováno [ ANO|NE ] │
│  ...                                                │
│                                                     │
│  Každá odpověď se uloží sama. Díky!                 │  footer hint 12 muted
╰───────────────────────────────────────────────────╯
        (scrim withAlpha(Colors.black, 0.6) behind)
```

**Mockup 2 — Mid-mapping (votes cast, community counts, coalesced XP toast, ring partial)**

```
   ┌─────────────────────────────────────────────┐
   │ (compass)  Zmapováno 5 věcí · +24 XP         │  TOAST top, emoji-free,
   └─────────────────────────────────────────────┘  CompassIcon amber, stout2 pill,
                                                      border withAlpha(amber,0.45)
                                              ┌─[X]─┐
╭───────────────────────────────────────────────────╮
│                      ▬▬▬▬                           │
│  U Zlatého tygra                       ╭───────╮    │
│  jdeš ti to, mapére                    │ 38%   │    │  ring arc amber + amberGlow(8)
│  ty jsi zmapoval 5 z 16                ╰───────╯    │  personal sub-line muted
│                                        zmapováno    │
│                                                     │
│  PLATBA                                            │
│  [card] Platba kartou    8× ano · 1× ne [⬛ANO| ne ]│  ANO half amber, stout text,
│  [cash] Jen hotovost     0× ano · 6× ne [ ano |⬛NE ]│  CheckIcon. icon → amber
│                                                     │
│  POSEZENÍ                                           │
│  [tree] Zahrádka…        5× ano · 0× ne [⬛ANO| ne ]│  NE half = muted fill (calm)
│  [♿]   Bezbariérový…    2× ano · 0× ne [⬛ANO| ne ]│
│                                                     │
│  PRAKTICKÉ                                          │
│  [P]    Parkování        nezmapováno    [ ano | ne ]│
│  [wifi] Wi-Fi          prvně zmapováno! [⬛ANO| ne ]│  first-mapper amberLight
│                                                     │
│  ZÁBAVA                                             │
│  [tgt]  Šipky            4× ano · 0× ne [⬛ANO| ne ]│
│  [dice] Kulečník        lidi se neshodnou[ ano |⬛NE]│  disputed verdict copy
│                                                     │
│  Každá odpověď se uloží sama. Díky!                 │
╰───────────────────────────────────────────────────╯
```

`⬛ANO` = `Colors.amber` fill / `Colors.stout` text / `CheckIcon 14`; `⬛NE` = `withAlpha(Colors.mutedText,0.25)` fill / `Colors.foam` text / `XIcon 14`. Count line `Fonts.ui.medium 12 Colors.mutedText`; `prvně zmapováno!` in `Colors.amberLight`.

**Mockup 3 — Profile MAPÉR section (between TVOJE ČÍSLA and ODZNAKY)**

```
  MAPÉR                                              ← sectionHeader (existing style)

  ╭─────────────────────────────────────────────╮
  │  [sprout]   Úroveň 3 · Štamgast              │   level card, stout3, Radius.card,
  │                                              │   border withAlpha(amber,0.25)
  │  ███████████████░░░░░░░░░  285 / 400 XP      │   XP bar: amber fill, stout track
  │  ještě 115 XP do dalšího levelu              │   caption 12 mutedText
  ╰─────────────────────────────────────────────╯

  ┌───────────────┐  ┌───────────────┐
  │  [mappin]     │  │  [compass]    │              2×2 StatTile grid (existing)
  │      12       │  │      47       │
  │  zmapovaných  │  │   odpovědí    │
  │   hospod      │  │   celkem      │
  └───────────────┘  └───────────────┘
  ┌───────────────┐  ┌───────────────┐
  │  [sprout]     │  │  [star]       │
  │       4       │  │      3        │
  │  prvně        │  │  hospod       │
  │  zmapováno    │  │  hotových     │
  └───────────────┘  └───────────────┘

  ODZNAKY                                            ← existing achievements header
  ┌────────┐  ┌────────┐  ┌────────┐
  │ ◉ amber│  │ 🔒lock │  │ 🔒lock │              Badge medallions (existing pattern)
  │Kartograf│ │Pivní   │  │Pořádku-│
  │25 hospod│ │detektiv│  │  mil   │
  └────────┘  └────────┘  └────────┘
```

Level card `Colors.stout3`, `Radius.card` (22), `Spacing.lg` pad, leading `SproutIcon size=22 Colors.amber` in a 40×40 well. XP bar height 10, `Radius.pill`, track `Colors.stout`, fill `Colors.amber` + `amberGlow(6)`, animated width (reduce-motion gated). Tiles reuse `StatTile` verbatim. Badges reuse the `Badge` medallion (`LockKeyholeIcon` when locked).

## 4. Mobile data layer

Mirrors the `pubRatings` trio (store + queue + client + sync) but with a **per-amenity** merge unit and a **two-stores-of-truth** read model (user's own votes vs server aggregate). All new files are additive.

### 4.1 The critical merge decision — per-key LWW, NOT report-level

A `PubRating` is one scalar; an amenity report is a **map of up to 16 independent facts**. Report-level LWW would be data loss: device A maps darts=yes at 19:00; device B (offline, stale) maps wifi=yes at 19:05 and pushes a full map *without* darts → B's newer timestamp clobbers darts. So the merge unit is the **individual amenity vote**, with `updatedAt` stored **per amenity**, and both the client store and the server upsert do per-`(pubKey, amenityKey)` LWW. **PUT is a partial merge of one vote, not a replace of the whole report** — this diverges from the ratings "replace the whole object" semantics on purpose. **Absent key always = "unknown / no change"; retraction is the explicit `value: null` tombstone** — never overload absence as both.

### 4.2 Catalogue — `src/data/amenities.ts` (new)

```ts
/** Stable, group-prefixed wire slug. NEVER rename — persisted, sent over the wire, future map-filter key. Add only. */
export type AmenityKey =
  | 'payment_card' | 'payment_cash_only'
  | 'seating_garden' | 'seating_barrier_free' | 'seating_kids_corner'
  | 'game_darts' | 'game_billiards' | 'game_foosball' | 'game_jukebox'
  | 'atmosphere_live_music' | 'atmosphere_sports_tv' | 'atmosphere_dogs_welcome' | 'atmosphere_smoking'
  | 'practical_wifi' | 'practical_parking' | 'practical_food';
// 'practical_outdoor_tap' + 'practical_tank_beer' reserved (is_active=false), not in the active union.

export interface AmenityDef {
  key: AmenityKey;
  /** Group value: note the locked asymmetry — prefix `game_` maps to group `games`. */
  section: 'payment' | 'seating' | 'games' | 'atmosphere' | 'practical';
  /** i18n key under cs.mapPub.amenities.* — resolved at render, never stored. */
  labelKey: string;
  chipKey: string;
  /** IconGlyph export name; new ones must be added before the amenity ships. */
  icon: string;
  /** Planned map-filter facet (design signal only; filter is future). */
  filterCandidate: boolean;
}

export const AMENITIES: readonly AmenityDef[] = [ /* ordered, grouped by section */ ];
export const AMENITY_SECTIONS = ['payment', 'seating', 'games', 'atmosphere', 'practical'] as const;
export const CURRENT_TAXONOMY_VERSION = 1;

/** Soft UX hints only — never auto-write the implied vote, only suggest it. */
export const AMENITY_RULES = { softExclusive: [['payment_card', 'payment_cash_only']] } as const;

const AMENITY_KEY_SET = new Set<string>(AMENITIES.map((a) => a.key));
/** Drop unknown keys from wire/persist (forward-compat: a newer backend key this build lacks). */
export function isKnownAmenityKey(v: unknown): v is AmenityKey {
  return typeof v === 'string' && AMENITY_KEY_SET.has(v);
}
```

### 4.3 Store — `src/stores/pubAmenitiesStore.ts` (new)

Holds **only the user's own votes** (pending + already-synced), keyed `pubKey → amenityKey → entry`. It does NOT hold the aggregate (that rides on the `Pub` type / a dedicated snapshot, §4.6). Mirrors `pubRatingsStore`: zustand + persist, key `'na-pivo-pub-amenities'`.

```ts
export type AmenityVote = 'yes' | 'no';                 // never 'unknown' on store/wire
export interface AmenityVoteEntry { vote: AmenityVote; updatedAt: string; } // per-key LWW ts
export type PubAmenityVotes = Partial<Record<AmenityKey, AmenityVoteEntry>>;

interface PubAmenitiesState {
  votes: Record<string, PubAmenityVotes>;               // votes[pubKey][amenityKey]
  /** 'yes'|'no' → upsert with fresh updatedAt; null → retract (delete entry, prune empty pub). */
  setVote: (pubKey: string, amenityKey: AmenityKey, vote: AmenityVote | null) => void;
  clearPub: (pubKey: string) => void;                   // undo-all / account wipe
  /** PULL merge, per-(pubKey,amenityKey) LWW by updatedAt; entry=null = retraction won LWW. */
  hydrateVotes: (rows: { pubKey: string; amenityKey: AmenityKey; entry: AmenityVoteEntry | null }[]) => void;
}
```

A synced vote **stays in the store** (unlike a drink, which is a done event) — it is durable state the user owns: survives reinstall, re-renders as "tvoje odpověď: ano", and lets LWW resolve cross-device edits, exactly like `PubRating`. Persist `version: 1` ships a real `migrate` (not an empty slot): it filters persisted votes through `isKnownAmenityKey` and prunes empty pubs, so a future catalogue change has a defined, testable entry point and unknown persisted keys can't crash rehydrate.

### 4.4 Queue — `src/data/pubAmenitiesQueue.ts` (new)

Identical contract to `pubRatingsQueue` with the **dedup key changed to `(pubKey, amenityKey)`** (NOT `pubKey` alone — the ratings queue dedups by pub and would silently collapse a user's darts and wifi votes into one delivery; reusing it as-is causes vote loss). Key `'na-pivo-pub-amenities-queue'`.

```ts
export type AmenityQueueItem =
  | { op: 'upsert'; pubKey: string; amenityKey: string; payload: WireAmenityVote }
  | { op: 'delete'; pubKey: string; amenityKey: string; payload: WireAmenityVote }; // value:null tombstone
function dedupKey(i: AmenityQueueItem): string { return `${i.pubKey} ${i.amenityKey}`; }
```

Reuse verbatim: `runLocked` mutex, `loadQueue`/`saveQueue`, `enqueueAmenityOp` (filter-by-`dedupKey`, push, `slice(-MAX)`), `flushLocked` (keep on `'retry'`, drop on `'ok'`/`'permanent-error'`, mid-flush content-signature preservation), `getQueuedAmenityDeletes()` (set of `dedupKey`s with a pending delete, so restore doesn't re-hydrate a not-yet-applied retraction), `flushPubAmenitiesQueue`/`clearPubAmenitiesQueue`. **The queued payload is the FULL current local entry for that `(pubKey, amenityKey)` at flush time (snapshot, not diff)** so coalescing is safe. **Do not flush per enqueue** — debounce a single `flushPubAmenitiesQueue()` (~250ms microtask) after the subscriber settles, so mapping one pub doesn't fire 16 serial 8s-timeout attempts and block the mutex. `MAX_QUEUE_LENGTH` is effectively unreachable for a realistic offline crawl (~10 pubs × 16 ≈ 160 ≪ 500); keep the ratings cap of 500 and the silent `slice(-MAX)` oldest-drop — the concern is theoretical.

### 4.5 Client — `src/data/pubAmenitiesClient.ts` (new)

Same shape as `pubRatingsClient`: best-effort Bearer, 8s `AbortController` timeout layered with the caller signal, **never throws**, three-state result `'ok' | 'permanent-error' | 'retry'`, snake_case wire types, identical HTTP classification (`401` → clear anonymous account + `'retry'`; `400/422` → `'permanent-error'`; `5xx/429/network/timeout/dormant` → `'retry'`; dormant/missing-account → `'retry'` for writes, `null` for reads).

**Wire types & endpoints reproduce the backend contract exactly** (paths/methods/field names are the backend spec's; do not diverge):

```ts
/** Taxonomy item from GET /v1/pub-amenities/kinds (canonical wire names). */
export interface WireAmenityKind {
  key: string;
  group: string;                         // payment | seating | games | atmosphere | practical
  label_cs: string;                      // not bare `label`
  short_label_cs: string;                // not `short_label`
  icon: string;                          // IconGlyph export name
  map_filterable: boolean;               // not `filter_candidate`
  is_active: boolean;                    // newly exposed
  order: number;                         // not `rank`
}

/** One PUT body row (the whole body is wrapped: { votes: [ WireAmenityVote, ... ] }).
 *  cache_key is re-derived server-side from lat/lng (never sent). One amenity per row. */
export interface WireAmenityVote {
  name?: string; lat: number; lng: number; city?: string;
  external_id?: string | null;
  amenity_key: string;
  value: 'yes' | 'no' | null;            // null = clear/tombstone
  taxonomy_version?: number;
  client_updated_at: string;             // ISO-8601, server-side per-amenity LWW key
}

/** One PUT response item (the whole response is { results: [...], mapper }). */
export interface WireAmenityVoteResponse {
  applied: boolean;                      // false = stale write rejected by server LWW OR ignored-unknown (still 'ok' for queue)
  ignored_unknown_amenity: boolean;      // true only when amenity_key was not a known active kind
  deleted: boolean;                      // true on a retraction (value:null) that removed the user's row
  was_first_map: boolean;                // true only when this write created the very first vote for (pub, amenity)
  xp_awarded: number;                    // authoritative per-vote award (0 on flip/re-vote/retract)
  vote: { amenity_key: string; value: 'yes' | 'no'; client_updated_at: string } | null;  // null on retract/ignore; lat/lng never echoed
  aggregate: WireAmenityAggregate;       // recomputed, lets the meter/XP update in one round-trip
}

/** One amenity's public truth for one pub (backend §3e amenities[] item). */
export interface WireAmenityAggregate {
  amenity_key: string;
  status: 'yes' | 'no' | 'disputed' | 'unknown';   // the aggregated verdict
  confidence: number;                              // 0..1 (wire-rounded to 2 dp)
  yes_count: number; no_count: number;
  distinct_voter_count: number;                    // distinct accounts with a live vote here
  my_value?: 'yes' | 'no' | null;                  // caller's own vote, exact overlay (no +1 heuristic); null/omitted when anon
}

/** Full mapped-state of one pub (backend §3e pubs[] item). */
export interface WirePubAmenities {
  cache_key: string;
  mapper_count: number;                  // distinct accounts who voted any amenity at this pub
  completeness: {                        // nested object (canonical shape)
    mapped_count: number;                // distinct ACTIVE amenities with status != 'unknown'
    total_kinds: number;                 // active amenity count = 16 (server-authoritative denominator)
    pct: number;                         // mapped_count / total_kinds, 0..1, clamped
  };
  amenities: WireAmenityAggregate[];
}

/** The account's own votes, for cross-device restore (backend §3c {votes:[...]}). */
export interface WireMyAmenityVote { cache_key: string; amenity_key: string; value: 'yes' | 'no'; client_updated_at: string; }
```

The PUT response envelope is `{ results: WireAmenityVoteResponse[], mapper: WireMapper }` — the fresh Mapér snapshot is returned ONCE at the envelope level (not per result), so Profile updates without a second GET.

```
PUT    /v1/pub-amenities/votes                            // {votes:[...]} wrapper, one row per amenity (Bearer, IsAuthenticated)
GET    /v1/pub-amenities/votes                            // this account's own votes → PULL ({votes:[...]})
DELETE /v1/pub-amenities/votes/<cache_key>/<amenity_key>  // idempotent clear ({deleted:bool}); URL-encode both segments
GET    /v1/pub-amenities?cache_keys=<k>,<k>...            // public aggregates batch ({pubs:[...]}, AllowAny)
GET    /v1/pub-amenities/kinds                            // taxonomy overlay (AllowAny, cacheable)
```

> **Envelope discipline.** The PUT body is `{ votes: [...] }` (array wrapper, one row per amenity); GET own-votes returns `{ votes: [...] }`, aggregates return `{ pubs: [...] }`, the PUT returns `{ results: [...], mapper }` — parse the wrapper, not a bare array (mirrors `fetchRatings` parsing `data.ratings`). `submitAmenityVote` treating `applied: false` as `'ok'` (drop from queue) is correct because the queue is latest-wins; but `restorePubAmenities`' final "push local newer than server" step compares `client_updated_at` (like `restorePubRatings`) so a server-rejected stale vote isn't endlessly re-pushed. **Aggregate reads do NOT bolt onto the Mapy-cached `/v1/pubs/near`** (that endpoint is a credit-saving 7-day geohash-6 cache; widening/shortening it reignites Mapy cost or fragments the cache) — they are a separate cheap read with its own short TTL.

Telemetry mirrors ratings: `amenity_synced` on 2xx, `amenity_sync_failed` (severity warning) with `{ operation, status, reason, sync_result, retryable }`. No raw GPS, no PII, no vote contents.

### 4.6 Aggregate display merge + attaching to `Pub`

The sheet shows *"12 lidí: kartou ano"* (aggregate) **and** the user's own just-tapped answer optimistically. The merge is a **pure render-time function**, never persisted, never sent — `src/data/pubAmenitiesView.ts` `buildAmenityRows(aggregates, myVotes) → AmenityRow[]`, where `myVote` (from the store selector) wins as the row's emphasis and the count line shows the crowd. Because the aggregate carries `my_value`, the user's contribution is reflected **exactly** (no drift-prone ±1 heuristic): show the server counts verbatim, render your own answer via the pill state. The sheet wiring is purely reactive:

```ts
const myVotes = usePubAmenitiesStore(selectPubVotes(pubKey));   // reactive, user's own
const aggregates = pub.amenities;                                // cached server snapshot
const rows = useMemo(() => buildAmenityRows(aggregates, myVotes), [aggregates, myVotes]);
const onTap = (k: AmenityKey, next: AmenityVote | null) => usePubAmenitiesStore.getState().setVote(pubKey, k, next);
```

**Additive `Pub` fields** (`src/data/pubs.ts`, alongside `hasGarden`), server-owned + cached, never written by the client:

```ts
export type Pub = {
  // ...existing... hasGarden?: boolean | null;
  amenities?: WireAmenityAggregate[];      // public confidence-weighted truth; undefined = unresolved/dormant
  amenityCompleteness?: number;            // 0..1 community meter
  amenityMappedCount?: number;
  amenityTotalKinds?: number;
};
```

`seating_garden` is both `Pub.hasGarden` (firmy-derived, keeps powering `gardenBadge`) and a `seating_garden` amenity (community-voted). The client **never writes votes into `hasGarden`**; precedence/seed reconciliation is a backend read-path decision (§2 garden note).

**Caching — ONE source per aggregate (no double cache).** Do NOT serialize `Pub.amenities`/`amenityCompleteness`/`amenityMappedCount`/`amenityTotalKinds` into the 24h `na-pivo-pubs-snapshot` (that would create a second, longer-TTL copy that disagrees with the sheet). Strip those fields before `saveSnapshot`; rehydrate them only from a dedicated **`na-pivo-pub-amenities-snapshot`** keyed `cache_key → { aggregate, savedAt }` with a **~6h TTL**. On sheet open, read the cached aggregate immediately (instant render) then fire a single-pub `fetchPubAmenities([pubKey])` to refresh in the background. Nearby reads piggyback the existing enrichment path (like `fetchPubHours`) so no per-amenity calls.

> **Geohash-8 collision (carry through, do not leave implicit).** Two distinct businesses can share one ~38 m cell (common in dense Czech centers). The codebase already guards this for the drinks merge via `names_match`. The mobile client carries `name` in every PUT (it already does) and keys the local store entry by `pubKey` **plus** a name discriminator: when the resolved pub name doesn't match the stored entry's name for that cell, treat it as unmapped (don't show another pub's votes / a wrong "Hospoda je zmapovaná"). The authoritative collision bucketing (votes folded per `(cache_key, normalized name)`) is a backend aggregate concern — the mobile contract just guarantees `name` is always sent and the display never blindly trusts bare `cache_key` identity.

### 4.7 Sync — `src/data/pubAmenitiesSync.ts` (new) + account-wipe seam

Copies `pubRatingsSync` with `(pubKey, amenityKey)` granularity.

- **PUSH** `installPubAmenitiesSync()` subscribes to the store, diffs prev vs next **one level deeper** (per amenity entry, not per pub): appeared/changed → `enqueueAmenityOp({op:'upsert'})`; removed → `enqueueAmenityOp({op:'delete'})` (timestamped tombstone). Guarded by a module-level `suppressSync` flag held **strictly synchronously around the `hydrateVotes` call only** (never across an `await`). Export `runWithoutPubAmenitiesSync(task)`.
- **PULL** `restorePubAmenities(signal)` on launch/foreground: `await flushPubAmenitiesQueue()`; read `getQueuedAmenityDeletes()`; `fetchMyAmenityVotes()` (null → return); map wire → entries, **skip any `dedupKey` with a pending local delete**, drop unknown keys via `isKnownAmenityKey`; `suppressSync = true` → `hydrateVotes(merged)` → `suppressSync = false`; push local votes the server is missing/older (LWW by `updatedAt`) → `flushPubAmenitiesQueue()`. Aggregates are NOT pulled here (they refresh via the `Pub` enrichment path).
- **Wiring**: `installPubAmenitiesSync()` once at app root; `void restorePubAmenities()` on launch and on AppState foreground (mirror `installPubRatingsSync`/`restorePubRatings`).

**Account-wipe seam (required, not an afterthought).** `src/data/privateAccountData.ts` wipes a hardcoded set on logout/delete/account-rotation. This MUST be extended or the previous user's votes leak across accounts (shown as "tvoje odpověď" and re-delivered under the new account's token):
- add `'na-pivo-pub-amenities'` to `PRIVATE_STORAGE_KEYS`;
- add `clearPubAmenitiesQueue()` to the `Promise.all`;
- wrap the reset in `runWithoutPubAmenitiesSync(() => usePubAmenitiesStore.setState({ votes: {} }))`;
- regression test: `clearLocalPrivateAccountData()` empties the amenities store + queue.

The per-user vote dataset is also location-adjacent, so it must be covered by **account export and account deletion** (server-side; the codebase already exports/deletes per-account data).

### 4.8 File plan (all new unless marked edit)

| File | Role | Modeled on |
|---|---|---|
| `src/data/amenities.ts` | `AmenityKey` union, `AMENITIES`, sections, rules, `CURRENT_TAXONOMY_VERSION`, `isKnownAmenityKey` | new shared constant |
| `src/stores/pubAmenitiesStore.ts` | `votes[pubKey][amenityKey]`, `setVote`/`clearPub`/`hydrateVotes`, key `na-pivo-pub-amenities`, real `migrate` | `pubRatingsStore.ts` |
| `src/data/pubAmenitiesQueue.ts` | dedup-by-`(pubKey,amenityKey)` retry queue, debounced flush, key `na-pivo-pub-amenities-queue` | `pubRatingsQueue.ts` |
| `src/data/pubAmenitiesClient.ts` | `submitAmenityVote` (PUT), `fetchPubAmenities` (aggregates), `fetchMyAmenityVotes`, `fetchAmenityKinds`, wire types | `pubRatingsClient.ts` + `hoursClient.ts` |
| `src/data/pubAmenitiesView.ts` | pure `buildAmenityRows(aggregates, myVotes)` overlay | new |
| `src/data/pubAmenitiesSync.ts` | PUSH subscribe-diff + `restorePubAmenities` PULL, `suppressSync`, `runWithoutPubAmenitiesSync` | `pubRatingsSync.ts` |
| `src/components/compass/ZmapujHospoduSheet.tsx` | the sheet | `BeerBrandFilterSheet.tsx` |
| `src/components/compass/MapPubButton.tsx` | trigger pill (label/%-dot/a11y) | `GlowButton secondary` |
| `src/data/pubs.ts` *(edit)* | add `amenities?`/`amenityCompleteness?`/`amenityMappedCount?`/`amenityTotalKinds?`; strip them before `saveSnapshot` | existing |
| `src/data/privateAccountData.ts` *(edit)* | add amenities store + queue to the wipe seam | existing |
| `src/components/shared/IconGlyph.tsx` *(edit)* | add the lucide wraps in §7 | existing |
| `src/components/shared/Toast.tsx` + `src/stores/toastStore.ts` *(edit)* | optional leading-`IconGlyph` slot, default 🍺 | existing |
| `src/data/auth.ts` *(edit)* | `AccountMapper` + `parseMapper`; extend `AccountAchievements` + `parseAchievements` with the new booleans | existing |
| `src/profile/ProfileScreen.tsx` *(edit)* | MAPÉR section + new badges + offline fallback defaults | existing |
| `src/i18n/cs.ts` *(edit)* | `mapPub.*` copy | existing |

**Testable seams** (Jest): `setVote`/`hydrateVotes` per-key LWW + pruning + tombstone; queue dedup-by-pair + mid-flush signature preservation + debounce; `buildAmenityRows` overlay (own vote wins, `my_value` exact, disputed/unknown); `restorePubAmenities` pending-delete suppression + unknown-key drop; `clearLocalPrivateAccountData` wipes amenities; `migrate` drops unknown persisted keys.

## 5. Mapér gamification surface (mobile)

**XP is server-authoritative with an optimistic local preview.** This is the one deliberate break from the local-first `deriveStats(sessions)` pattern, because XP depends on global state the client cannot see ("first answer on a fresh amenity", "first mapper of this pub", agreement with the crowd) — minted where the truth lives, gated server-side against forging and flip-flop farming. The vote itself still goes through the offline queue (you can map with no signal); the toast shows a best-effort local estimate; the durable number reconciles from `GET /v1/account/me`. Never show an optimistic *durable* total on Profile — only the transient toast is estimated; if the estimate was generous, the Profile number is simply the smaller server truth on next fetch (no jarring decrement).

### 5.1 XP, levels, titles

The award shape (server-defined, env-tunable, exposed via the wire as `xp_rules` — exact numbers are the backend's): first answer on a fresh amenity ≫ confirming a known fact (diminishing reward); a globally one-time first-mapper-of-a-pub bonus; flips/re-votes pay 0. The per-vote authoritative award is returned as `xp_awarded` on the PUT response (§4.5); the four env-default constants are exposed as `xp_rules` on the `mapper` block (§5.4) so the optimistic toast estimates from a shared source of truth, not a hardcoded guess. The Profile reads the `mapper` block; the bundled threshold/title table lets the client name an optimistic level-up locally (server `level`/`title` are truth on reconcile).

Exactly **5 levels**, server-authoritative, with a byte-identical mobile-bundled fallback table. Thresholds are env-tunable defaults; the level→title mapping is locked:

| level | title | min XP (cumulative) |
|---|---|---|
| 1 | Nováček | 0 |
| 2 | Všímálek | 50 |
| 3 | Štamgast | 150 |
| 4 | Znalec | 400 |
| 5 | Hospodský mudrc | 900 |

Level titles {Nováček, Všímálek, Štamgast, Znalec, Hospodský mudrc} and badge names {Prvomapér, Objevitel, Kartograf, Pořádkumil, Pivní detektiv} are deliberately disjoint — no level reuses a badge name (`Kartograf`/`Pivní detektiv` are badge titles only, NOT level titles). The canonical ladder + thresholds live server-side so re-balancing never needs an app release; the bundled copy is a render fallback.

### 5.2 Completeness

The sheet ring shows **community** completeness from the nested `completeness: { mapped_count, total_kinds, pct }` object on the aggregate read — `total_kinds` is server-authoritative (= **16** active kinds) so the meter survives amenity additions and per-pub completeness can reach 100%; a personal sub-line shows "ty jsi zmapoval/a {n} z {total}". Do not hard-code the denominator client-side.

### 5.3 New badges (extending the `Badge` pattern)

`Badge({icon,title,subtitle,unlocked})` medallions render in the existing `badgeRow` alongside `firstTen`/`regular`/`reviewer`. New additive booleans on `AccountAchievements`:

| key (wire) | title | locked subtitle | unlock (server-derived) | glyph |
|---|---|---|---|---|
| `first_map` | Prvomapér | Buď první, kdo hospodu zmapuje | first-mapper of ≥1 pub (`first_mapper_count >= 1`) | `SproutIcon` (NEW) |
| `explorer` | Objevitel | Zmapuj 10 hospod | ≥10 distinct mapped pubs (`distinct_mapped_pubs >= 10`) | `MapPinnedIcon` (NEW) |
| `cartographer` | Kartograf | Zmapuj 25 hospod | ≥25 distinct mapped pubs (`distinct_mapped_pubs >= 25`) | `MapPinnedIcon` (NEW) |
| `completionist` | Pořádkumil | Zmapuj jednu hospodu naplno | bring ≥1 pub to 100% (`completed_pubs_count >= 1`) | `BadgeCheckIcon` (exists) |
| `fact_machine` | Pivní detektiv | Zaznamenej 100 faktů | cast ≥100 amenity votes (`amenity_votes_count >= 100`) | `ClipboardListIcon` (NEW) |

> **Compatibility reality (correct the corpus).** `parseAchievements` in `src/data/auth.ts` reads EXACTLY `first_ten`/`regular`/`reviewer` — it does NOT auto-default unknown keys. New badges require a coordinated mobile release that: extends `AccountAchievements` + `parseAchievements` with the new keys; adds them to the signed-out/offline fallback default object in `ProfileScreen.tsx`; renders them in `badgeRow` with `unlocked={achievements.first_map ?? false}`. Released apps are unaffected (they ignore unknown server fields) but the new badges are **invisible until that release ships** — they are not "free additive."

### 5.4 Where surfaced + local-vs-server note

- **Profile** — a new "MAPÉR" section between TVOJE ČÍSLA and ODZNAKY (Mockup 3): a `HeroStat`-style level card with an XP bar, a 2×2 `StatTile` grid (zmapovaných hospod / odpovědí celkem / prvně zmapováno / hospod hotových), and the new badges in the existing row. Signed-out/offline: the section stays visible with a subtle "synchronizuje se…" hint when the queue is non-empty (a reason to claim an account); **with the backend dormant for the whole install lifetime, Mapér XP is 0** — show a "přihlas se / připoj se" empty state rather than an optimistic durable number that would be clawed back.
- **Sheet** — the instant XP toast (§3.5).

The `mapper` block is read off `GET /v1/account/me` (additive sibling of `stats`): `auth.ts` gains an `AccountMapper` interface + `parseMapper(data)`, attached to `AccountProfile` only when present (`if (mapper) profile.mapper = mapper`), exactly like `stats`/`usage`. Level/title/XP-into-level are derived from the stored XP server-side; the mobile side never persists XP as truth.

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

`levels` is the server's copy of the locked ladder, so the client can map an optimistic XP estimate to a level+title locally. `xp_rules` is a **required** object exposing the four env-default XP constants (`first_fact`, `first_mapper_bonus`, `confirm`, `pub_complete_bonus`) so the mobile optimistic-XP toast (§3.5) reads a shared source of truth instead of a hardcoded guess; `parseMapper` reads it. The per-vote authoritative award is still returned separately as `xp_awarded` on the PUT response (§4.5).

## 6. Czech UI copy block (hospodský, tykání)

```
// Trigger (MapPubButton)
trigger.default      = "Zmapuj hospodu"
trigger.partial      = "Doplň mapu hospody"          // + " · {pct} %"
trigger.done         = "Hospoda je zmapovaná"
trigger.a11y         = "Zmapuj hospodu {pub}, zmapováno z {pct} procent"

// Sheet header
sheet.subtitleEmpty  = "pomoz ostatním — co tady je?"
sheet.subtitleSome   = "jdeš ti to, mapére"
sheet.subtitleDone   = "paráda, máš to celé!"
sheet.ringCaption    = "zmapováno"
sheet.personal       = "ty jsi zmapoval/a {n} z {total}"
sheet.footerHint     = "Každá odpověď se uloží sama. Díky!"
sheet.close.a11y     = "Zavřít mapování hospody"
sheet.offline        = "Teď jsi offline — odpovědi se uloží a pošlou později."

// Sections
section.payment      = "PLATBA"
section.seating      = "POSEZENÍ"
section.games        = "ZÁBAVA"
section.atmosphere   = "ATMOSFÉRA"
section.practical    = "PRAKTICKÉ"

// Row controls
row.yes              = "Ano"
row.no               = "Ne"
row.unmapped         = "nezmapováno"
row.firstMapped      = "prvně zmapováno!"
row.signal           = "{yes}× ano · {no}× ne"
row.disputed         = "lidi se neshodnou"
row.yes.a11y         = "{amenity}: ano"
row.no.a11y          = "{amenity}: ne"
row.clear.hint       = "Ťukni znovu pro zrušení"
row.cashSuggest      = "Bereš že tu platí jen hotovost? Klepni na Ne u karty."   // soft nudge

// Amenity labels / chips (see §2 tables): payment_card="Platba kartou"/"Karta", etc.

// XP toasts
xp.firstMapper       = "Prvomapér! +{xp} XP"
xp.session           = "Zmapováno {n} věcí · +{xp} XP"
xp.levelUp           = "Level up — teď jsi {title}!"

// Profile — MAPÉR
mapper.header        = "MAPÉR"
mapper.level         = "Úroveň {n} · {title}"
mapper.xpProgress    = "{cur} / {next} XP"
mapper.xpToNext      = "ještě {n} XP do dalšího levelu"
mapper.xpMaxed       = "máš všechno — jsi legenda"
mapper.statMappedPubs= "zmapovaných hospod"
mapper.statAnswers   = "odpovědí celkem"
mapper.statFirstMaps = "prvně zmapováno"
mapper.statCompleted = "hospod hotových"
mapper.empty         = "Ještě jsi nic nezmapoval. Najdi hospodu a řekni, co v ní je."
mapper.signedOut     = "Přihlas se a tvoje mapování se ti uloží napříč zařízeními."

// Badges
badge.firstMap.title        = "Prvomapér"
badge.firstMap.locked       = "Buď první, kdo hospodu zmapuje"
badge.explorer.title        = "Objevitel"
badge.explorer.locked       = "Zmapuj 10 hospod"
badge.cartographer.title    = "Kartograf"
badge.cartographer.locked   = "Zmapuj 25 hospod"
badge.completionist.title   = "Pořádkumil"
badge.completionist.locked  = "Zmapuj jednu hospodu naplno"
badge.factMachine.title     = "Pivní detektiv"
badge.factMachine.locked    = "Zaznamenej 100 faktů"

// Level titles (5 locked): Nováček / Všímálek / Štamgast / Znalec / Hospodský mudrc
```

## 7. New IconGlyphs needed

All are one-line `lucide-react-native` adds (one `import` + one `wrap(...)` line each, matching `export const TreePineIcon = wrap(TreePine, 'TreePineIcon');`). **No SVG authoring, no emoji.** Already present and reused: `BeerIcon`, `TreePineIcon`, `WifiIcon`, `CheckIcon`, `XIcon`, `CompassIcon`, `BadgeCheckIcon`, `MapPinIcon`, `CrownIcon`, `StarIcon`, `CoinsIcon`, `LockKeyholeIcon`.

| lucide source | new export | used for |
|---|---|---|
| `CreditCard` | `CreditCardIcon` | payment_card |
| `Banknote` | `BanknoteIcon` | payment_cash_only |
| `Accessibility` | `AccessibilityIcon` | seating_barrier_free |
| `Baby` | `BabyIcon` | seating_kids_corner |
| `Target` | `TargetIcon` | game_darts |
| `Dices` | `DicesIcon` | game_billiards |
| `Gamepad2` | `Gamepad2Icon` | game_foosball |
| `Radio` | `RadioIcon` | game_jukebox |
| `Mic` | `MicIcon` | atmosphere_live_music |
| `Tv` | `TvIcon` | atmosphere_sports_tv |
| `Dog` | `DogIcon` | atmosphere_dogs_welcome |
| `Cigarette` | `CigaretteIcon` | atmosphere_smoking |
| `SquareParking` | `SquareParkingIcon` | practical_parking |
| `Utensils` | `UtensilsIcon` | practical_food |
| `MapPinned` | `MapPinnedIcon` | trigger button + Objevitel/Kartograf badges + Profile stat |
| `Sprout` | `SproutIcon` | Mapér level card + Prvomapér badge + toast |
| `ClipboardList` | `ClipboardListIcon` | Pivní detektiv (fact_machine) badge |

> **Icon clash resolution (locked).** Four prior clashes are resolved by choosing the clearer, non-ambiguous lucide glyph (no ambiguous bare discs): `game_billiards`→`DicesIcon` (reads as a game instantly, not another disc next to darts' `Target`); `game_jukebox`→`RadioIcon` (a boxy radio shape, not a disc); `atmosphere_live_music`→`MicIcon` (a mic reads "live performance" better than a generic note); `practical_parking`→`SquareParkingIcon` (the literal "P" sign is unambiguous). Dropped: `Disc3Icon`, `DiscIcon`, `MusicIcon`. `practical_tank_beer` keeps `BeerIcon` (reserved, inactive). `practical_outdoor_tap` must NOT reuse `BeerIcon` — reserve the key without a glyph until a distinct one is added. Validate `Target` (darts) vs `Dices` (billiards) on a real device before shipping; if they don't read, that's a design-dimension blocker (possible custom SVG, which the no-emoji rule makes more expensive), not a footnote.

## 8. Open questions & risks

- **Geohash-8 collisions on PUBLIC truth.** Two pubs in one ~38 m cell merge into one aggregate shown to everyone + fed to the future filter — worse than the private-ratings case. Mobile mitigation: always send `name`, key the local entry by `pubKey` + name, don't trust bare `cache_key` for "is this the same pub". Authoritative bucketing (votes per `(cache_key, normalized name)` via the existing `names_match`) is a backend aggregate decision that must land before the map filter ships. (§4.6)
- **Anti-abuse is a HARD precondition for XP, not deferred.** Anonymous device accounts + client-supplied lat/lng make first-mapper/flip-flop/sock-puppet farming trivial. Mobile contributes: per-`(pubKey,amenityKey)` idempotent votes, queue dedup so flip-flop collapses, no brand-new `client_updated_at` on a no-op re-vote. The real guards are server-side and MUST exist before any leaderboard: first-mapper keyed off the existence of ANY prior `(account, cache_key)` row (one-time, concurrency-safe), XP idempotent per `(account, cache_key, amenity_key)`, a per-account `pub_amenities` throttle, and a soft proximity/visit weighting (PubVisit already exists). v1 XP is cosmetic/non-competitive; the first žebříček must recompute XP server-side. (§5)
- **`payment_card` ↔ `payment_cash_only` contradictions.** "Suggest don't force" still invites "bere obojí" double-yes that pollute the aggregate. If real-world conflict rate is high, fall back to a single `payment_card` tri-state (`no` = jen hotovost). Decide after measuring. (§2)
- **`seating_garden` double truth.** A pub can show the firmy `gardenBadge` while the community amenity disagrees. Backend must define the precedence/seed-origin rule (community overrides firmy only above a confidence threshold; mark seeded aggregates as `podle Firmy.cz`, not a fake crowd verdict, and don't let the seed count toward "answered" before a human votes). (§2, §4.6)
- **Seasonal facts** (zahrádka v zimě, živá hudba o víkendu) look identical to "nezmapováno" and pollute the year-round truth + completeness meter. v1 scopes amenities to **structural** facts ("má prostor pro zahrádku" yes/no, not "je dnes otevřená"); revisit a "sezónně" nuance only if demand appears.
- **Toast refactor touches a globally-mounted component.** Adding the leading-icon slot is a real (if small) change with a regression surface across every existing toast caller; default to 🍺 to keep existing toasts identical. (§3.5)
- **Completeness denominator drift.** Hard-coding `total_kinds` client-side makes the client and server meters disagree when an amenity is added/deactivated, and can show a "100% complete" pub dropping below 100%. The client reads `total_kinds` from the backend and frames the personal ring as progress, not a permanent score; the backend must clamp `completeness` to [0,1] and use the same active-kind set for numerator and denominator. (§5.2)
- **Glyph recognizability** (Target darts vs Dices billiards, adjacent in `games`) — on-device validation blocker before ship. (§7)
- **Shared-cache read placement.** The aggregate read must stay off the Mapy-cached `/v1/pubs/near`; the dedicated batch GET needs its own throttle scope (not `pubs_near`) and its own short TTL so amenity scraping can't eat the Mapy budget. (§4.5)
```
