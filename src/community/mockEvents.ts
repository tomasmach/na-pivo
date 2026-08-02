/**
 * DESIGN MOCK — what is on near you.
 *
 * Shared by the Komunita list and the detail, so the card you tap and the screen
 * you land on cannot disagree — the same arrangement the challenges use.
 *
 * `cover` is a two-stop gradient, not artwork. Same call as the games
 * (`gameCatalog`): a picture per event is a content pipeline nobody has built,
 * and a warm gradient with the date on it reads as a poster today and can be
 * swapped for a real photo when events come from the server.
 *
 * Real ones come from `PubEvent`, which already exists — see
 * `docs/decisions/pub-events-source-and-freshness.md` for where they are
 * sourced and how stale they are allowed to get.
 */

export interface CommunityEvent {
  id: string;
  title: string;
  /** "so 2. 8." — already formatted and declined. */
  when: string;
  time: string;
  where: string;
  /** One line of what it actually is. */
  blurb: string;
  /** Poster gradient, top-left → bottom-right. */
  cover: readonly [string, string];
  /** How many said they are coming. Aggregate only — never who. */
  going: number;
  /** Are you one of them. */
  mine?: boolean;
}

export const EVENTS: CommunityEvent[] = [
  {
    id: 'e1',
    title: 'Pivní slavnosti Žižkov',
    when: 'so 2. 8.',
    time: 'od 14:00',
    where: 'Parukářka',
    blurb: 'Dvacet pivovarů na kopci, kapela a stánky do noci.',
    cover: ['#8A5A18', '#2E1D0E'],
    going: 34,
  },
  {
    id: 'e2',
    title: 'Tankové pivo u Fleků',
    when: 'pá 8. 8.',
    time: 'od 18:00',
    where: 'U Fleků',
    blurb: 'Jeden den v roce točí tankovou třináctku. Chodí se brzo.',
    cover: ['#7A4E18', '#2A1A0C'],
    going: 12,
    mine: true,
  },
  {
    id: 'e3',
    title: 'Pub kvíz',
    when: 'čt 14. 8.',
    time: 'od 19:30',
    where: 'Zlý časy',
    blurb: 'Týmy po čtyřech, osm kol, vítěz bere sud.',
    cover: ['#3F4A2E', '#171C10'],
    going: 26,
  },
];

export function findEvent(id: string | undefined): CommunityEvent | undefined {
  return EVENTS.find((event) => event.id === id);
}
