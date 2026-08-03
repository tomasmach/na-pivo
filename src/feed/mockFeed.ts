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

/**
 * What a party can produce, richest first. The feed card shows the BEST thing a
 * given night has, and only falls back down the list — the route map is last
 * because it is the one output that says nothing about what the evening was
 * like. A card is worth sharing when it carries a story, not coordinates.
 *
 *   photos   the night, as pictures — faces, the pub, the mess
 *   game     a pub quiz or game scoreboard: who won, by how much
 *   tempo    beers per hour — the shape of how far it went
 *   record   a personal best that fell, or a streak that held
 *   map      the pubs, joined. Plan B.
 *
 * The roast is NOT in this list. It is a different slot: the highlight is what
 * the night produced, the roast is what the app says about it — a headline
 * generated from the numbers, which can sit over any of the above.
 */
export type PartyHighlight =
  | { kind: 'photos'; count: number; caption: string }
  | { kind: 'game'; game: string; winner: string; scores: { name: string; score: number }[] }
  | { kind: 'tempo'; hourly: { hour: string; beers: number }[]; peakLabel: string }
  | { kind: 'record'; title: string; detail: string }
  | { kind: 'map' };

/**
 * Placeholder faces for the mock only. `pravatar.cc` is a stock-photo service —
 * it must not survive into anything shipped; real avatars come from
 * `Account.avatar`, which the app already serves.
 */
const AVATARS = 'https://i.pravatar.cc/160?img=';

export interface FeedEntry {
  id: string;
  /** Who posted the night. */
  author: string;
  authorTint: string;
  /** "dnes 23:40", "včera", "út 28. 7." — already humanised. */
  when: string;
  title: string;
  /** What the table wrote about the night. Shown under the headline when the
   *  app has no roast of its own to print. */
  note?: string;
  /** The pub chain, in order — with coordinates, so the card can show a map. */
  stops: { name: string; lat: number; lng: number }[];
  beers: number;
  duration: string;
  /** Everyone at the table, author included. Handles, not legal names — this
   *  is a pub app, and nobody is "Jan Novák" at the table. */
  people: { name: string; tint: string; avatar: string }[];
  photos: number;
  cheers: number;
  comments: number;
  /** True while the night is still running — the card gets a live pill. */
  live?: boolean;
  /** Whether I already cheered this one. */
  cheered?: boolean;
  /** The best thing this night produced. Drives the card's hero. */
  highlight: PartyHighlight;
  /** Minutes, for the roast rules — `duration` above is already humanised. */
  durationMinutes: number;
  /** Games played tonight and how many you won, for the roast rules. */
  games: number;
  gamesWon: number;
  /** Your usual beers-per-hour. Null on a first night, which mutes the roast. */
  usualPerHour: number | null;
  /** Times you have been to tonight's pub before. */
  visitsToSamePub: number;
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
      { name: '@sudík', tint: '#E8A317', avatar: `${AVATARS}57` },
      { name: '@pěna', tint: '#7DD66B', avatar: `${AVATARS}41` },
    ],
    photos: 2,
    cheers: 3,
    comments: 1,
    live: true,
    // Still running, so the numbers are all there is — and that is enough to
    // be rude about. No nested quotes in the line: the card renders it as the
    // headline, unquoted.
    highlight: { kind: 'map' },
    durationMinutes: 48,
    games: 0,
    gamesWon: 0,
    usualPerHour: 1,
    visitsToSamePub: 2,
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
      { name: '@sudík', tint: '#E8A317', avatar: `${AVATARS}57` },
      { name: '@pěna', tint: '#7DD66B', avatar: `${AVATARS}41` },
      { name: '@chmelák', tint: '#F0BE5C', avatar: `${AVATARS}50` },
      { name: '@klárka', tint: '#A8896A', avatar: `${AVATARS}64` },
      { name: '@mišák', tint: '#FBF3E0', avatar: `${AVATARS}26` },
    ],
    photos: 18,
    cheers: 12,
    comments: 4,
    cheered: true,
    durationMinutes: 402,
    games: 1,
    gamesWon: 0,
    usualPerHour: 2,
    visitsToSamePub: 1,
    highlight: {
      kind: 'game',
      game: 'Pub kvíz',
      winner: 'Klára',
      scores: [
        { name: 'Klára', score: 18 },
        { name: 'Honza', score: 15 },
        { name: 'Ty', score: 14 },
        { name: 'Petr', score: 11 },
      ],
    },
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
      { name: '@klárka', tint: '#A8896A', avatar: `${AVATARS}64` },
      { name: '@mišák', tint: '#FBF3E0', avatar: `${AVATARS}26` },
      { name: '@chmelák', tint: '#F0BE5C', avatar: `${AVATARS}50` },
    ],
    photos: 6,
    cheers: 7,
    comments: 2,
    durationMinutes: 185,
    games: 0,
    gamesWon: 0,
    usualPerHour: 2,
    visitsToSamePub: 1,
    highlight: {
      kind: 'tempo',
      hourly: [
        { hour: '19', beers: 1 },
        { hour: '20', beers: 3 },
        { hour: '21', beers: 4 },
        { hour: '22', beers: 1 },
      ],
      peakLabel: 'Nejvíc mezi devátou a desátou',
    },
  },
];

/** The facilitator nudge that opens the feed: a reason to go, not a statistic.
 *  Points at people and places, never at how much anyone should drink. */
export const MOCK_NUDGE = {
  title: 'S Petrem jste nebyli od června',
  body: 'Zlý časy máte 400 m od sebe.',
  cta: 'Napiš mu',
};
