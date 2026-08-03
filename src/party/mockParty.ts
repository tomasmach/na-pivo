/**
 * DESIGN MOCK — hard-coded party recap data.
 *
 * This file exists to pin down the SHAPE of a party recap before any of it is
 * wired to the backend, so the screen can be judged on its own terms. Every
 * field here is derivable from models that already exist:
 *
 *   beers          DrinkLog
 *   duration       PartyEvening.started_at / ended_at
 *   stops          PubVisit (ordered by arrival)
 *   hourly         DrinkLog.drank_at, bucketed
 *   people         PartyEveningMember + DrinkLog per account
 *   cheers         FriendActivityReaction
 *   photos         BeerPhoto
 *   records        derived from the account's own history
 *
 * Deliberately absent: price, spend, per-mille, BAC. The product does not do
 * accounting and does not estimate how drunk anyone is
 * (`docs/decisions/no-bac-or-driving-estimates.md`).
 *
 * Delete this file the moment the real client lands.
 */

const AVATARS = 'https://i.pravatar.cc/160?img=';

export interface PartyPerson {
  id: string;
  name: string;
  /** Same placeholder faces the feed uses, so a night looks identical wherever
   *  you meet it. MUST NOT ship — real ones come from `Account.avatar`. */
  avatar?: string;
  beers: number;
  /** Highest tally of the night. Exactly one person carries it. */
  mvp?: boolean;
  /** Colour seed for the initials avatar until real avatars are wired. */
  tint: string;
}

export interface PartyStop {
  id: string;
  pubName: string;
  /** "20:15" — already formatted; the mock does no date maths. */
  arrivedAt: string;
  beers: number;
  /** Where it is, so the stops can be drawn as the walk they were. */
  lat: number;
  lng: number;
}

export interface PartyRecord {
  id: string;
  /** Short, loud, one line. "Osobní rekord" not "Gratulujeme, dosáhl jsi…". */
  title: string;
  detail: string;
  /**
   * Whose record it is. At a table of five, "tvůj nový rekord" on a shared post
   * is ambiguous for four of the readers — a record needs a name on it. Matches
   * a `PartyPerson.name`; "Ty" when it is yours.
   */
  by: string;
}

export interface PartyRecap {
  title: string;
  /** "čtvrtek 30. července" */
  dateLabel: string;
  beers: number;
  /** "6h 42m" */
  duration: string;
  stops: PartyStop[];
  people: PartyPerson[];
  /** Beers per hour of the night, in order, for the tempo bars. */
  hourly: { hour: string; beers: number }[];
  /** What was actually drunk, per tap — the chart's second question. */
  byBeer: { beer: string; count: number }[];
  records: PartyRecord[];
  cheers: number;
  photos: number;
  photoUrls: string[];
}

export const MOCK_PARTY: PartyRecap = {
  title: 'Čtvrteční jízda',
  dateLabel: 'čtvrtek 30. července',
  beers: 27,
  duration: '6h 42m',
  stops: [
    { id: 's1', pubName: 'U Fleků', arrivedAt: '20:15', beers: 9, lat: 50.0785, lng: 14.42 },
    { id: 's2', pubName: 'Zlý časy', arrivedAt: '22:00', beers: 11, lat: 50.0655, lng: 14.438 },
    { id: 's3', pubName: 'Vzorkovna', arrivedAt: '00:30', beers: 7, lat: 50.081, lng: 14.418 },
  ],
  people: [
    { id: 'p1', name: 'Honza', beers: 7, mvp: true, tint: '#E8A317', avatar: `${AVATARS}57` },
    { id: 'p2', name: 'Petr', beers: 6, tint: '#7DD66B', avatar: `${AVATARS}41` },
    { id: 'p3', name: 'Tomáš', beers: 5, tint: '#F0BE5C', avatar: `${AVATARS}50` },
    { id: 'p4', name: 'Klára', beers: 5, tint: '#A8896A', avatar: `${AVATARS}64` },
    { id: 'p5', name: 'Míša', beers: 4, tint: '#FBF3E0', avatar: `${AVATARS}26` },
  ],
  byBeer: [
    { beer: 'Pilsner Urquell', count: 11 },
    { beer: 'Matuška Raptor', count: 8 },
    { beer: 'Únětická 12°', count: 5 },
    { beer: 'Nealko', count: 3 },
  ],
  hourly: [
    { hour: '20', beers: 4 },
    { hour: '21', beers: 5 },
    { hour: '22', beers: 6 },
    { hour: '23', beers: 5 },
    { hour: '00', beers: 4 },
    { hour: '01', beers: 3 },
  ],
  records: [
    { id: 'r1', title: 'Nejvíc štací za večer', detail: 'Tři hospody, nový rekord.', by: 'Ty' },
    {
      id: 'r2',
      title: 'Nejdelší večer měsíce',
      detail: '6h 42m — o hodinu víc než minule.',
      by: 'Honza',
    },
  ],
  cheers: 12,
  photos: 18,
  /** Placeholder shots. `picsum.photos` MUST NOT ship — the real ones are
   *  `BeerPhoto` rows. */
  photoUrls: [
    'https://picsum.photos/seed/napivo-1/400/400',
    'https://picsum.photos/seed/napivo-2/400/400',
    'https://picsum.photos/seed/napivo-3/400/400',
    'https://picsum.photos/seed/napivo-4/400/400',
    'https://picsum.photos/seed/napivo-5/400/400',
  ],
};
