/**
 * DESIGN MOCK — the Feed home.
 *
 * A chronicle of parties, not of beers: one card per night, the way Strava
 * posts one card per activity. Everything here comes from models that exist
 * (PartyEvening, DrinkLog, PubVisit, BeerPhoto, FriendActivityReaction); it is
 * hard-coded only so the layout can be judged before the client is written.
 *
 * Delete alongside the other mocks once the real feed lands.
 */

export interface FeedEntry {
  id: string;
  /** Who posted the night. */
  author: string;
  authorTint: string;
  /** "dnes 23:40", "včera", "út 28. 7." — already humanised. */
  when: string;
  title: string;
  /** The pub chain, in order — with coordinates, so the card can show a map. */
  stops: { name: string; lat: number; lng: number }[];
  beers: number;
  duration: string;
  /** Everyone at the table, author included. */
  people: { name: string; tint: string }[];
  photos: number;
  cheers: number;
  comments: number;
  /** True while the night is still running — the card gets a live pill. */
  live?: boolean;
  /** Whether I already cheered this one. */
  cheered?: boolean;
}

export const MOCK_FEED: FeedEntry[] = [
  {
    id: 'f1',
    author: 'Honza',
    authorTint: '#E8A317',
    when: 'právě teď',
    title: 'Rychlovka po práci',
    stops: [{ name: 'Zlý časy', lat: 50.0655, lng: 14.438 }],
    beers: 4,
    duration: '48m',
    people: [
      { name: 'Honza', tint: '#E8A317' },
      { name: 'Petr', tint: '#7DD66B' },
    ],
    photos: 2,
    cheers: 3,
    comments: 1,
    live: true,
  },
  {
    id: 'f2',
    author: 'Ty',
    authorTint: '#F0BE5C',
    when: 'včera 02:12',
    title: 'Čtvrteční jízda',
    stops: [
      { name: 'U Fleků', lat: 50.0785, lng: 14.42 },
      { name: 'Zlý časy', lat: 50.0655, lng: 14.438 },
      { name: 'Vzorkovna', lat: 50.081, lng: 14.418 },
    ],
    beers: 27,
    duration: '6h 42m',
    people: [
      { name: 'Honza', tint: '#E8A317' },
      { name: 'Petr', tint: '#7DD66B' },
      { name: 'Tomáš', tint: '#F0BE5C' },
      { name: 'Klára', tint: '#A8896A' },
      { name: 'Míša', tint: '#FBF3E0' },
    ],
    photos: 18,
    cheers: 12,
    comments: 4,
    cheered: true,
  },
  {
    id: 'f3',
    author: 'Klára',
    authorTint: '#A8896A',
    when: 'út 28. 7.',
    title: 'Objevovačka na Žižkově',
    stops: [
      { name: 'U Slovanské lípy', lat: 50.088, lng: 14.453 },
      { name: 'Bílá labuť', lat: 50.09, lng: 14.434 },
    ],
    beers: 9,
    duration: '3h 05m',
    people: [
      { name: 'Klára', tint: '#A8896A' },
      { name: 'Míša', tint: '#FBF3E0' },
      { name: 'Tomáš', tint: '#F0BE5C' },
    ],
    photos: 6,
    cheers: 7,
    comments: 2,
  },
];

/** The facilitator nudge that opens the feed: a reason to go, not a statistic.
 *  Points at people and places, never at how much anyone should drink. */
export const MOCK_NUDGE = {
  title: 'S Petrem jste nebyli od června',
  body: 'Zlý časy máte 400 m od sebe.',
  cta: 'Napiš mu',
};
