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

export const MOCK_PUBS: MockPub[] = [
  {
    id: 'p1',
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
