/**
 * DESIGN MOCK — the profile's numbers.
 *
 * Every series here is derivable from data the app already keeps:
 *
 *   series     DrinkLog.drank_at, bucketed by week / month / year
 *   records    the max over PartyEvening + DrinkLog per evening
 *   streak     consecutive weeks with at least one logged evening
 *
 * Records are deliberately about VARIETY, RHYTHM and ENDURANCE, not volume —
 * except "nejvíc za večer", which is the one honest personal best a beer diary
 * has and which the product would look coy for hiding. It is stated flatly, with
 * no congratulation attached: a number, a date, no exclamation mark.
 *
 * Delete this file when the real stats client lands.
 */

export type StatPeriod = 'Týden' | 'Měsíc' | 'Rok';

export interface StatPoint {
  label: string;
  value: number;
  /** The four numbers for THIS bucket. Scrubbing the chart swaps the header to
   *  these, so the top of the screen always describes what your finger is on. */
  totals: { label: string; value: string }[];
}

export interface StatSeries {
  /** Bars, oldest first — the last one is where you are now. */
  points: StatPoint[];
  /** Totals for the selected window, shown under the chart. */
  totals: { label: string; value: string }[];
}

/** The four numbers, in one order, everywhere. A helper because writing the
 *  labels out thirty times is thirty chances to disagree with the header. */
const t = (beers: string, nights: string, pubs: string, longest: string) => [
  { label: 'Piv', value: beers },
  { label: 'Večerů', value: nights },
  { label: 'Hospod', value: pubs },
  { label: 'Nejdelší', value: longest },
];

export const SERIES: Record<StatPeriod, StatSeries> = {
  Týden: {
    points: [
      { label: 'po', value: 0, totals: t('0', '0', '0', '—') },
      { label: 'út', value: 2, totals: t('2', '1', '1', '1h 40m') },
      { label: 'st', value: 0, totals: t('0', '0', '0', '—') },
      { label: 'čt', value: 6, totals: t('6', '1', '3', '6h 42m') },
      { label: 'pá', value: 4, totals: t('4', '1', '1', '2h 15m') },
      { label: 'so', value: 3, totals: t('3', '1', '1', '1h 55m') },
      { label: 'ne', value: 0, totals: t('0', '0', '0', '—') },
    ],
    totals: [
      { label: 'Piv', value: '15' },
      { label: 'Večerů', value: '4' },
      { label: 'Hospod', value: '5' },
      { label: 'Nejdelší', value: '6h 42m' },
    ],
  },
  Měsíc: {
    points: [
      { label: '1.t', value: 11, totals: t('11', '3', '4', '4h 10m') },
      { label: '2.t', value: 8, totals: t('8', '3', '3', '3h 30m') },
      { label: '3.t', value: 14, totals: t('14', '3', '5', '5h 20m') },
      { label: '4.t', value: 15, totals: t('15', '4', '5', '7h 05m') },
    ],
    totals: [
      { label: 'Piv', value: '48' },
      { label: 'Večerů', value: '13' },
      { label: 'Hospod', value: '11' },
      { label: 'Nejdelší', value: '7h 05m' },
    ],
  },
  Rok: {
    points: [
      { label: 'led', value: 22, totals: t('22', '6', '7', '5h 40m') },
      { label: 'úno', value: 19, totals: t('19', '5', '6', '4h 50m') },
      { label: 'bře', value: 28, totals: t('28', '7', '9', '9h 12m') },
      { label: 'dub', value: 24, totals: t('24', '6', '8', '6h 15m') },
      { label: 'kvě', value: 33, totals: t('33', '8', '11', '7h 30m') },
      { label: 'čvn', value: 41, totals: t('41', '10', '13', '8h 05m') },
      { label: 'čvc', value: 48, totals: t('48', '12', '14', '7h 05m') },
    ],
    totals: [
      { label: 'Piv', value: '215' },
      { label: 'Večerů', value: '54' },
      { label: 'Hospod', value: '38' },
      { label: 'Nejdelší', value: '9h 12m' },
    ],
  },
};

export interface PersonalRecord {
  id: string;
  title: string;
  value: string;
  when: string;
}

export const RECORDS: PersonalRecord[] = [
  { id: 'r1', title: 'Nejdelší večer', value: '9h 12m', when: '14. 3. · U Fleků → Vzorkovna' },
  { id: 'r2', title: 'Nejvíc hospod za večer', value: '5', when: '20. 6. · pátek' },
  { id: 'r3', title: 'Nejvíc piv za večer', value: '11', when: '2. 7. · Po zápase' },
  { id: 'r4', title: 'Nejvíc nových hospod za měsíc', value: '7', when: 'červen' },
];

export interface StreakWeek {
  /** "12. 5." — the Monday of that week. */
  label: string;
  /** Evenings logged. Zero breaks the streak. */
  nights: number;
}

export interface Streak {
  /** Weeks in a row with at least one logged evening. */
  current: number;
  best: number;
  /** Oldest first, newest last. */
  weeks: StreakWeek[];
}

export const STREAK: Streak = {
  current: 3,
  best: 7,
  weeks: [
    { label: '12. 5.', nights: 2 },
    { label: '19. 5.', nights: 0 },
    { label: '26. 5.', nights: 1 },
    { label: '2. 6.', nights: 3 },
    { label: '9. 6.', nights: 2 },
    { label: '16. 6.', nights: 0 },
    { label: '23. 6.', nights: 1 },
    { label: '30. 6.', nights: 4 },
    { label: '7. 7.', nights: 2 },
    { label: '14. 7.', nights: 1 },
    { label: '21. 7.', nights: 3 },
    { label: '28. 7.', nights: 2 },
  ],
};
