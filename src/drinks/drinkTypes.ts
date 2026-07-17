export const DRINK_TYPES = ['beer', 'soft_drink', 'shot', 'wine'] as const;

export type DrinkType = (typeof DRINK_TYPES)[number];

export function isDrinkType(value: unknown): value is DrinkType {
  return typeof value === 'string' && DRINK_TYPES.includes(value as DrinkType);
}

export function normalizeDrinkType(value: unknown): DrinkType {
  return isDrinkType(value) ? value : 'beer';
}

/** WHERE the evening happens. `private` covers home / cottage / a friend's
 *  place without recording which address it was. Anything except `pub` never
 *  carries coordinates or a pub identity. */
export const PLACE_CONTEXTS = ['pub', 'private', 'outdoors', 'other'] as const;

export type PlaceContext = (typeof PLACE_CONTEXTS)[number];

/** The non-pub contexts, i.e. the "Mimo hospodu" choices. */
export type OutsidePlaceContext = Exclude<PlaceContext, 'pub'>;

export const OUTSIDE_PLACE_CONTEXTS = ['private', 'outdoors', 'other'] as const satisfies readonly OutsidePlaceContext[];

export function isOutsidePlaceContext(value: unknown): value is OutsidePlaceContext {
  return typeof value === 'string' && (OUTSIDE_PLACE_CONTEXTS as readonly string[]).includes(value);
}

/** Missing/unknown context means pub — every record predating this field is one. */
export function normalizePlaceContext(value: unknown): PlaceContext {
  return isOutsidePlaceContext(value) ? value : 'pub';
}

/**
 * Synthetic session key for an outside evening. Sessions are keyed by the pub's
 * geohash-8 cell; outside evenings have no place, so the context itself is the
 * key — the same context on the same drinking day is one evening, and switching
 * context rolls the session over exactly like switching pubs.
 */
export function contextPubKey(context: OutsidePlaceContext): string {
  return `ctx:${context}`;
}

/** True for the synthetic `ctx:*` keys of outside sessions (never a geohash). */
export function isContextPubKey(key: string): boolean {
  return key.startsWith('ctx:');
}

/** The context encoded in a `ctx:*` session key, or null for real pub keys. */
export function contextFromPubKey(key: string): OutsidePlaceContext | null {
  if (!isContextPubKey(key)) return null;
  const context = key.slice(4);
  return isOutsidePlaceContext(context) ? context : 'other';
}

/** HOW a beer was served. Only surfaced outside a pub for now; in a pub the
 *  serving stays `unknown` (the form doesn't ask). */
export const SERVING_TYPES = ['unknown', 'draft', 'bottle', 'can', 'plastic_bottle', 'other'] as const;

export type ServingType = (typeof SERVING_TYPES)[number];

export function isServingType(value: unknown): value is ServingType {
  return typeof value === 'string' && SERVING_TYPES.includes(value as ServingType);
}
