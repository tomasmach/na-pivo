/**
 * DESIGN MOCK — the pub list.
 *
 * Every field is something the app already resolves today (`Pub` in
 * `src/data/pubs.ts`): distance, opening state, the tap list, a reference price,
 * a rating. Hard-coded here only so the row can be judged on density.
 *
 * `lastParty` is the one genuinely new field — "co se tu dělo" — and it comes
 * from PartyEvening + PubVisit once those are wired.
 */

export interface MockPub {
  id: string;
  name: string;
  /** Real coordinates — the row thumbnail is a map of the actual spot. */
  lat: number;
  lng: number;
  /** "180 m", "1,2 km" — already formatted and declined. */
  distance: string;
  /** Human street line, second row of the cell. */
  address: string;
  open: boolean;
  /** "do 23:00" / "otevře v 11:00" */
  hours: string;
  /** The beer people actually come for. */
  beer: string;
  /** Reference large-beer price in CZK, or null when nobody has reported one. */
  priceCzk: number | null;
  rating: number;
  /** "Byli jste tu 3× · naposled ve čtvrtek", or null. */
  lastParty: string | null;
}

/** What the compass is pointing at right now — the list's head cell. */
export const MOCK_COMPASS_TARGET = {
  name: 'U Fleků',
  /** Real coordinates so the needle points somewhere real on a device. */
  lat: 50.0785,
  lng: 14.42,
  distance: '180',
  unit: 'metrů',
  bearingLabel: 'na severovýchod',
  hours: 'Otevřeno do 23:00',
  beer: 'Flekovský ležák 13°',
};

/**
 * "340 m" / "1,2 km" → the numeral and a declined Czech unit, because the
 * compass cell sets the number large and the unit small beside it.
 */
export function splitDistance(distance: string): { value: string; unit: string } {
  const [value, unit = ''] = distance.split(' ');
  return { value, unit: unit === 'm' ? 'metrů' : unit };
}

/**
 * Deterministic shuffle. `Math.random()` inside a render would reorder the list
 * under your thumb on every re-render; the seed only changes when you pick
 * "Náhodně v okolí" again, so picking it twice genuinely reshuffles and
 * scrolling does not.
 */
export function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = (seed + 1) * 9301 + 49297;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 9301 + 49297) % 233280;
    const j = Math.floor((state / 233280) * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

export const MOCK_PUBS: MockPub[] = [
  {
    id: 'p1',
    lat: 50.0655,
    lng: 14.438,
    name: 'Zlý časy',
    distance: '340 m',
    address: 'Čestmírova 5, Nusle',
    open: true,
    hours: 'do 01:00',
    beer: 'Matuška Raptor',
    priceCzk: 69,
    rating: 4.6,
    lastParty: 'Byli jste tu 3× · naposled ve čtvrtek',
  },
  {
    id: 'p2',
    lat: 50.088,
    lng: 14.453,
    name: 'U Slovanské lípy',
    distance: '620 m',
    address: 'Tachovské náměstí 6, Žižkov',
    open: true,
    hours: 'do 23:00',
    beer: 'Kacíř 11°',
    priceCzk: 45,
    rating: 4.4,
    lastParty: 'Byli jste tu 1× · v úterý',
  },
  {
    id: 'p3',
    lat: 50.081,
    lng: 14.418,
    name: 'Vzorkovna',
    distance: '1,1 km',
    address: 'Národní 11, Nové Město',
    open: false,
    hours: 'otevře v 17:00',
    beer: 'Únětické 12°',
    priceCzk: 39,
    rating: 4.1,
    lastParty: null,
  },
  {
    id: 'p4',
    lat: 50.09,
    lng: 14.434,
    name: 'Bílá labuť',
    distance: '1,4 km',
    address: 'Biskupská 3, Petrská čtvrť',
    open: true,
    hours: 'do 22:00',
    beer: 'Pilsner Urquell',
    priceCzk: 59,
    rating: 4.0,
    lastParty: null,
  },
  {
    id: 'p5',
    lat: 50.093,
    lng: 14.449,
    name: 'Kulový blesk',
    distance: '1,9 km',
    address: 'Sokolovská 89, Karlín',
    open: true,
    hours: 'do 00:00',
    beer: 'Chotěboř Prémium',
    priceCzk: 52,
    rating: 4.3,
    lastParty: null,
  },
];
