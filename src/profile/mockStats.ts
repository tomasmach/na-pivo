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

export interface StatSeries {
  /** Bars, oldest first — the last one is where you are now. */
  points: { label: string; value: number }[];
  /** Totals for the selected window, shown under the chart. */
  totals: { label: string; value: string }[];
}

export const SERIES: Record<StatPeriod, StatSeries> = {
  Týden: {
    points: [
      { label: 'po', value: 0 },
      { label: 'út', value: 2 },
      { label: 'st', value: 0 },
      { label: 'čt', value: 6 },
      { label: 'pá', value: 4 },
      { label: 'so', value: 3 },
      { label: 'ne', value: 0 },
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
      { label: '1.t', value: 11 },
      { label: '2.t', value: 8 },
      { label: '3.t', value: 14 },
      { label: '4.t', value: 15 },
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
      { label: 'led', value: 22 },
      { label: 'úno', value: 19 },
      { label: 'bře', value: 28 },
      { label: 'dub', value: 24 },
      { label: 'kvě', value: 33 },
      { label: 'čvn', value: 41 },
      { label: 'čvc', value: 48 },
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

export interface Streak {
  /** Weeks in a row with at least one logged evening. */
  current: number;
  best: number;
  /** One dot per week, newest last. */
  weeks: boolean[];
}

export const STREAK: Streak = {
  current: 3,
  best: 7,
  weeks: [true, false, true, true, true, false, true, true, true, true, true, true],
};
