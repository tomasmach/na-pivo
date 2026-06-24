/**
 * "Zmapuj hospodu" amenity catalogue — the client-bundled, authoritative source
 * for RENDERING the community pub-fact taxonomy (labels, chips, glyphs, sections,
 * order). It ships in the app so the sheet works offline / with the backend
 * dormant. The backend serves the same set via GET /v1/pub-amenities/kinds as a
 * forward-compat overlay; the client only renders amenities it has a bundled def
 * + glyph for and passes unknown keys through untouched on any round-trip.
 *
 * `amenity_key` is a stable, group-prefixed, lowercase snake_case slug. The five
 * group prefixes are exactly `payment_`, `seating_`, `game_`, `atmosphere_`,
 * `practical_`. NEVER renamed, NEVER reused — it is the wire value, the store key
 * and the future map-filter key. New amenities are appended (additive); deprecated
 * ones are deactivated (is_active=false), never repurposed.
 *
 * Note the deliberate, locked asymmetry: the prefix is `game_` (singular) but the
 * group value is `games` (plural). The catalogue keys / groups / icons / order MUST
 * match the backend seed exactly.
 */

/**
 * Stable, group-prefixed wire slug. NEVER rename — persisted, sent over the wire,
 * future map-filter key. Add only.
 *
 * The 11 active keys. The two reserved keys (`practical_outdoor_tap`,
 * `practical_tank_beer`) are intentionally NOT part of the active union — they are
 * defined in RESERVED_AMENITY_KEYS below with is_active=false and are never
 * rendered in v1.
 */
export type AmenityKey =
  | 'payment_card'
  | 'seating_garden'
  | 'seating_barrier_free'
  | 'game_darts'
  | 'game_billiards'
  | 'game_foosball'
  | 'game_jukebox'
  | 'atmosphere_live_music'
  | 'atmosphere_sports_tv'
  | 'practical_wifi'
  | 'practical_parking';

/** The five amenity groups, in sheet + GET /kinds display order. */
export type AmenityGroup = 'payment' | 'seating' | 'games' | 'atmosphere' | 'practical';

/** One amenity definition. Mirrors the canonical taxonomy table (spec §2). */
export interface AmenityDef {
  /** Stable wire slug; also the local store key + future map-filter key. */
  key: AmenityKey;
  /** Group value — note the locked asymmetry: prefix `game_` maps to group `games`. */
  group: AmenityGroup;
  /** Full Czech label (e.g. "Platba kartou"). */
  label: string;
  /** Short Czech chip label (e.g. "Karta"). */
  shortLabel: string;
  /** IconGlyph export name; the glyph must exist before the amenity ships. */
  icon: string;
  /** Planned map-filter facet (design signal only; the filter is future). */
  mapFilterable: boolean;
  /** Integer render rank (lower first). */
  order: number;
}

/**
 * A reserved (is_active=false) amenity. Present in the catalogue so activating it
 * later is a taxonomy bump rather than a key collision, but excluded from the
 * active union, the sheet, GET /kinds and both ends of the completeness meter.
 */
export interface ReservedAmenityDef {
  key: 'practical_outdoor_tap' | 'practical_tank_beer';
  group: AmenityGroup;
  label: string;
  shortLabel: string;
  /** undefined until a distinct glyph is added (outdoor tap must NOT reuse BeerIcon). */
  icon?: string;
  mapFilterable: boolean;
  order: number;
}

/**
 * The 11 ACTIVE amenities, ordered and grouped by section. The order values match
 * the backend seed (10, 30, ... 150). Section order: payment, seating, games,
 * atmosphere, practical.
 */
export const AMENITIES: readonly AmenityDef[] = [
  // — payment —
  { key: 'payment_card', group: 'payment', label: 'Platba kartou', shortLabel: 'Karta', icon: 'CreditCardIcon', mapFilterable: true, order: 10 },
  // — seating —
  { key: 'seating_garden', group: 'seating', label: 'Zahrádka / terasa', shortLabel: 'Zahrádka', icon: 'TreePineIcon', mapFilterable: true, order: 30 },
  { key: 'seating_barrier_free', group: 'seating', label: 'Bezbariérový přístup', shortLabel: 'Bezbariér', icon: 'AccessibilityIcon', mapFilterable: true, order: 40 },
  // — games —
  { key: 'game_darts', group: 'games', label: 'Šipky', shortLabel: 'Šipky', icon: 'TargetIcon', mapFilterable: true, order: 60 },
  { key: 'game_billiards', group: 'games', label: 'Kulečník', shortLabel: 'Kulečník', icon: 'CircleDotIcon', mapFilterable: true, order: 70 },
  { key: 'game_foosball', group: 'games', label: 'Stolní fotbal', shortLabel: 'Fotbálek', icon: 'SoccerBallIcon', mapFilterable: true, order: 80 },
  { key: 'game_jukebox', group: 'games', label: 'Jukebox', shortLabel: 'Jukebox', icon: 'RadioIcon', mapFilterable: false, order: 90 },
  // — atmosphere —
  { key: 'atmosphere_live_music', group: 'atmosphere', label: 'Živá hudba', shortLabel: 'Živá hudba', icon: 'MicIcon', mapFilterable: false, order: 100 },
  { key: 'atmosphere_sports_tv', group: 'atmosphere', label: 'Sport v televizi', shortLabel: 'Sport v TV', icon: 'TvIcon', mapFilterable: true, order: 110 },
  // — practical —
  { key: 'practical_wifi', group: 'practical', label: 'Wi-Fi', shortLabel: 'Wi-Fi', icon: 'WifiIcon', mapFilterable: true, order: 140 },
  { key: 'practical_parking', group: 'practical', label: 'Parkování', shortLabel: 'Parkování', icon: 'SquareParkingIcon', mapFilterable: true, order: 150 },
];

/**
 * Reserved (inactive) amenities — present in the catalogue so the keys can never
 * be reused, but excluded from rendering + completeness. `practical_outdoor_tap`
 * deliberately has no glyph yet (it must NOT reuse BeerIcon); `practical_tank_beer`
 * keeps BeerIcon for the day it is activated.
 */
export const RESERVED_AMENITIES: readonly ReservedAmenityDef[] = [
  { key: 'practical_outdoor_tap', group: 'practical', label: 'Venkovní výčep', shortLabel: 'Výčep', mapFilterable: false, order: 170 },
  { key: 'practical_tank_beer', group: 'practical', label: 'Tankové pivo', shortLabel: 'Tank', icon: 'BeerIcon', mapFilterable: true, order: 180 },
];

/** Group display order (GET /v1/pub-amenities/kinds + wire order). */
export const AMENITY_SECTIONS: readonly AmenityGroup[] = [
  'payment',
  'seating',
  'games',
  'atmosphere',
  'practical',
];

/**
 * Sheet DISPLAY sections — a UI-only grouping laid OVER the wire `group` field.
 * Several wire groups collapse into one section so the sheet never shows a header
 * for a single row (e.g. the lone `payment` amenity). This changes RENDERING only;
 * the wire `group` / `amenity_key` prefixes, store keys and completeness math are
 * untouched. `games` + `atmosphere` → "Zábava"; `payment` + `practical` → "Praktické".
 */
export type AmenitySection = 'seating' | 'fun' | 'practical';

/** Section render order in the sheet. */
export const AMENITY_DISPLAY_SECTIONS: readonly AmenitySection[] = ['fun', 'practical', 'seating'];

/** Which display section each wire group folds into. */
const GROUP_TO_SECTION: Record<AmenityGroup, AmenitySection> = {
  seating: 'seating',
  games: 'fun',
  atmosphere: 'fun',
  payment: 'practical',
  practical: 'practical',
};

/** Map a wire group to its sheet display section. */
export function sectionForGroup(group: AmenityGroup): AmenitySection {
  return GROUP_TO_SECTION[group];
}

/**
 * Bundled taxonomy version, sent as `taxonomy_version` metadata so votes record
 * which taxonomy they were captured against. It is NEVER a validation gate — the
 * backend must 2xx an unknown/future version.
 */
export const CURRENT_TAXONOMY_VERSION = 1;

/** All known active amenity keys, for the type guard below. */
const AMENITY_KEY_SET = new Set<string>(AMENITIES.map((a) => a.key));

/**
 * True when `v` is a known ACTIVE amenity key. Used to drop unknown keys from the
 * wire / persisted state (forward-compat: a newer backend key this build lacks),
 * and to narrow `string` to `AmenityKey`.
 */
export function isKnownAmenityKey(v: unknown): v is AmenityKey {
  return typeof v === 'string' && AMENITY_KEY_SET.has(v);
}

/** Look up an active amenity definition by key (undefined when unknown/reserved). */
export function getAmenityDef(key: string): AmenityDef | undefined {
  return AMENITIES.find((a) => a.key === key);
}
