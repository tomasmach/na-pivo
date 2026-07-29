/**
 * Turning a sitting into one Czech line: "6 piv Pilsner Urquell".
 *
 * Two decisions worth knowing before you touch this file.
 *
 * **No verb.** The obvious phrasing — "Jarek vypil 6 piv" — needs a past
 * participle, and Czech past participles carry gender. We do not know anybody's
 * gender and we are not going to ask, so a verb would misgender roughly half the
 * party on every row. The nominal form says the same thing, is shorter, and
 * scans better in a feed where the avatar already names the person.
 *
 * **The serving type is the noun.** "3 lahváče Staropramen" reads like a person
 * talking; "3 piva (lahev) Staropramen" reads like a database. Draft is the
 * unmarked case and stays plain "pivo", because in a Czech pub it is what you
 * get unless you say otherwise.
 *
 * Pure functions only — every branch here is unit-tested.
 */

import type { PartaFeedDrink, PartaFeedSitting } from '@/data/partaFeedClient';

/** Czech counts split at 1 / 2–4 / 5+ (and 0 takes the 5+ form). */
export interface CzechPlural {
  one: string;
  few: string;
  many: string;
}

export function pluralize(count: number, forms: CzechPlural): string {
  const n = Math.abs(Math.floor(count));
  if (n === 1) return forms.one;
  if (n >= 2 && n <= 4) return forms.few;
  return forms.many;
}

const BEER_PLAIN: CzechPlural = { one: 'pivo', few: 'piva', many: 'piv' };

/**
 * Beer nouns by how it was served. Draft is deliberately absent: it is the
 * default in a Czech pub, so naming it would be noise on almost every row.
 */
const BEER_BY_SERVING: Record<string, CzechPlural> = {
  bottle: { one: 'lahváč', few: 'lahváče', many: 'lahváčů' },
  can: { one: 'plechovka', few: 'plechovky', many: 'plechovek' },
  plastic_bottle: { one: 'petka', few: 'petky', many: 'petek' },
};

const SHOT: CzechPlural = { one: 'panák', few: 'panáky', many: 'panáků' };
const WINE: CzechPlural = { one: 'sklenka vína', few: 'sklenky vína', many: 'sklenek vína' };

/**
 * The counted noun for one drink line, or null when the drink has no natural
 * Czech noun and the row should fall back to "3× Kofola". Soft drinks land here
 * on purpose — "3 nealka" is not a thing anyone says.
 */
export function drinkNoun(drink: PartaFeedDrink): CzechPlural | null {
  if (drink.drinkType === 'beer') {
    return BEER_BY_SERVING[drink.servingType] ?? BEER_PLAIN;
  }
  if (drink.drinkType === 'shot') return SHOT;
  if (drink.drinkType === 'wine') return WINE;
  return null;
}

/** "6 piv Pilsner Urquell" / "3 lahváče Staropramen 10°" / "2× Kofola". */
export function describeDrink(drink: PartaFeedDrink): string {
  const noun = drinkNoun(drink);
  const name = drink.name.trim();
  if (!noun) {
    const counted = drink.count > 1 ? `${drink.count}× ` : '';
    return name ? `${counted}${name}` : `${counted}nápoj`.trim();
  }
  const head = `${drink.count} ${pluralize(drink.count, noun)}`;
  return name ? `${head} ${name}` : head;
}

/**
 * The loud line of a sitting: its biggest drink, plus how much else there was.
 * The server already sorts `items` by count, but a feed row must not depend on
 * a server's sort staying put, so we pick the max here too.
 */
export function sittingHeadline(sitting: PartaFeedSitting): string {
  const [first, ...rest] = [...sitting.items].sort((a, b) => b.count - a.count);
  if (!first) {
    // No breakdown survived, but the total did — say the honest thing.
    return `${sitting.total} ${pluralize(sitting.total, BEER_PLAIN)}`;
  }
  if (rest.length === 0) return describeDrink(first);
  const others = rest.reduce((sum, item) => sum + item.count, 0);
  // `total` counts drinks the server truncated out of `items`, so trust it over
  // the visible sum whenever it is larger.
  const remainder = Math.max(others, sitting.total - first.count);
  return remainder > 0 ? `${describeDrink(first)} + ${remainder} dalších` : describeDrink(first);
}

/** The quiet second line: everything that was not the headline. */
export function sittingDetail(sitting: PartaFeedSitting): string {
  const [, ...rest] = [...sitting.items].sort((a, b) => b.count - a.count);
  return rest.map(describeDrink).join(' · ');
}

const PLACE_LABELS: Record<string, string> = {
  private: 'U někoho doma',
  outdoors: 'Venku',
  other: 'Mimo hospodu',
};

/** Where it happened: the pub's name, or an honest label when it was not one. */
export function sittingPlace(sitting: PartaFeedSitting): string {
  const name = sitting.pubName.trim();
  if (name) return name;
  return PLACE_LABELS[sitting.placeContext] ?? 'Mimo hospodu';
}

const DAY_MS = 86_400_000;
/** Evenings roll over at 04:00, same as the counter's drinking day. */
const DAY_CUTOFF_HOURS = 4;

function drinkingDayStart(at: number): number {
  const shifted = new Date(at - DAY_CUTOFF_HOURS * 3_600_000);
  shifted.setHours(0, 0, 0, 0);
  return shifted.getTime();
}

/**
 * "dneska" / "včera" / "před 4 dny" / "12. 7.".
 *
 * Counted in drinking days, not in elapsed hours: a beer logged at 01:30 was
 * last night's, and telling someone it was "dneska" would be a lie they can
 * feel. Past a week the relative form stops helping and a date is kinder.
 */
export function dayLabel(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const days = Math.round((drinkingDayStart(now) - drinkingDayStart(at)) / DAY_MS);
  if (days <= 0) return 'dneska';
  if (days === 1) return 'včera';
  if (days === 2) return 'předevčírem';
  if (days <= 6) return `před ${days} dny`;
  return new Date(at).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
}
