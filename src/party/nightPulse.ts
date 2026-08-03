/**
 * What the night is doing RIGHT NOW, in one line.
 *
 * Strava's record screen has "Auto-paused" sitting over the numbers: a state,
 * named, that changes as you move. Our hub had four fixed labels, so it read
 * like a printed form — the numbers moved but nothing ever SAID anything.
 *
 * Every line here is derived from the beer list, the way `roast.ts` works:
 *
 *   - it compares this night's gaps to this night's own average, so it never
 *     needs a baseline from the server and never judges an evening against
 *     anyone else's;
 *   - it stays quiet until there is enough to compare (two beers), because one
 *     data point has no tempo;
 *   - it never comments on HOW MUCH anyone drank, only on rhythm. "Piješ moc"
 *     is the one sentence this product must never print.
 *
 * The fourth stat slot is chosen the same way: whatever is currently the most
 * interesting true thing, rather than a label that is sometimes a dash.
 */

export type PulseKind = 'idle' | 'first' | 'fast' | 'steady' | 'slow' | 'paused';

export interface Pulse {
  kind: PulseKind;
  /** The state, short and loud. Sits where Strava puts "Auto-paused". */
  headline: string;
  /** Why we say that. Always a fact you can check against the timeline. */
  basis: string;
}

export interface PulseInput {
  /** Minutes at which each beer was poured, in order. */
  beerTimes: number[];
  /** Minutes elapsed in the evening. */
  now: number;
}

/** Long enough that the evening has genuinely stopped, not just paused to eat. */
const PAUSE_MINUTES = 45;

export function buildPulse({ beerTimes, now }: PulseInput): Pulse {
  if (beerTimes.length === 0) {
    return { kind: 'idle', headline: 'Zatím sucho', basis: 'Večer začne prvním pivem.' };
  }

  const last = beerTimes[beerTimes.length - 1];
  const since = Math.max(0, now - last);

  if (beerTimes.length === 1) {
    return {
      kind: 'first',
      headline: 'Rozjezd',
      basis: since > 0 ? `První pivo před ${since} min` : 'První pivo právě teď',
    };
  }

  // A long silence outranks tempo: the interesting thing is that nothing is
  // happening, not how fast it was happening before.
  if (since >= PAUSE_MINUTES) {
    return {
      kind: 'paused',
      headline: 'Pauza',
      basis: `Bez piva už ${since} min`,
    };
  }

  // The night's own average gap — no external baseline, no comparison to anyone.
  const gaps = beerTimes.slice(1).map((time, index) => time - beerTimes[index]);
  const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const lastGap = gaps[gaps.length - 1];

  if (lastGap <= average * 0.65) {
    return {
      kind: 'fast',
      headline: 'Zrychlilo se to',
      basis: `Poslední pivo po ${lastGap} min, jinak po ${Math.round(average)}`,
    };
  }

  if (lastGap >= average * 1.6) {
    return {
      kind: 'slow',
      headline: 'Zvolnili jste',
      basis: `Poslední pivo po ${lastGap} min, jinak po ${Math.round(average)}`,
    };
  }

  return {
    kind: 'steady',
    headline: 'Drží se tempo',
    basis: `Zhruba pivo za ${Math.round(average)} min`,
  };
}

export interface PulseStat {
  label: string;
  value: string;
}

/**
 * The fourth stat, chosen by what is worth knowing at this moment rather than
 * being one fixed label that is a dash half the evening.
 */
export function fourthStat({ beerTimes, now }: PulseInput): PulseStat {
  // Under two beers there is no tempo, and "od prvního" would just be the
  // stopwatch again — the hub showed "26m" beside "26:43", the same fact twice
  // in two formats. A dash is honest; a duplicate is noise.
  if (beerTimes.length < 2) return { label: 'pivo po', value: '—' };

  const last = beerTimes[beerTimes.length - 1];
  const since = Math.max(0, now - last);

  const gaps = beerTimes.slice(1).map((time, index) => time - beerTimes[index]);
  const average = Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);

  // Once the silence is longer than the usual gap, THAT is the number you want.
  if (since > average) return { label: 'na jedno', value: `${since} min` };
  return { label: 'pivo po', value: `${average} min` };
}
