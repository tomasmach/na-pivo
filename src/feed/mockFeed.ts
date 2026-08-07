/**
 * DESIGN MOCK — the Feed home.
 *
 * A chronicle of parties, not of beers: one card per night, the way Strava
 * posts one card per activity. Everything here comes from models that exist
 * (PartyEvening, DrinkLog, PubVisit, BeerPhoto, FriendActivityReaction); it is
 * hard-coded only so the layout can be judged before the client is written.
 *
 * The canned data is gone; only the card shape survives for legacy renderers.
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
  | { kind: 'game'; game: string; winner: string; scores: { name: string; score: number }[] }
  | { kind: 'tempo'; hourly: { hour: string; beers: number }[]; peakLabel: string }
  | { kind: 'record'; title: string; detail: string }
  | { kind: 'map' };

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
