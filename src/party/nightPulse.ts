/**
 * What the night is doing RIGHT NOW, in one line.
 *
 * Every line here is derived from the beer list:
 *
 *   - no beers yet means idle;
 *   - one beer is the start;
 *   - a silence of 45 minutes or more is a pause;
 *   - otherwise the evening simply runs, and the line states how long ago the
 *     last beer was written.
 */

import { t } from '@/i18n';

/** Kept in full for compatibility with callers typed against older kinds. */
export type PulseKind = 'idle' | 'first' | 'fast' | 'steady' | 'slow' | 'paused';

export interface Pulse {
  kind: PulseKind;
  /** The state, short and loud. */
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
    return { kind: 'idle', headline: t.liveParty.pulseIdle, basis: t.liveParty.pulseIdleBasis };
  }

  const last = beerTimes[beerTimes.length - 1];
  const since = Math.max(0, now - last);

  if (beerTimes.length === 1) {
    return {
      kind: 'first',
      headline: t.liveParty.pulseFirst,
      basis: since > 0 ? t.liveParty.pulseFirstBasis(since) : t.liveParty.pulseFirstNow,
    };
  }

  // A long silence outranks everything else: the interesting thing is that
  // nothing is happening.
  if (since >= PAUSE_MINUTES) {
    return {
      kind: 'paused',
      headline: t.liveParty.pulsePaused,
      basis: t.liveParty.pulsePausedBasis(since),
    };
  }

  return {
    kind: 'steady',
    headline: t.liveParty.pulseSteady,
    basis: t.liveParty.pulseSteadyBasis(since),
  };
}

export interface PulseStat {
  label: string;
  value: string;
}

/**
 * The numbers beside the stopwatch.
 *
 * Yours always; the table total only when someone else is at the table — alone
 * it would repeat your own count in a second column.
 */
export function hubStats({
  mine,
  table,
  others,
}: PulseInput & { mine: number; table: number; others: number }): PulseStat[] {
  const stats: PulseStat[] = [
    { label: others > 0 ? t.liveParty.statMyBeers : t.liveParty.statBeers, value: String(mine) },
  ];
  if (others > 0) {
    stats.push({ label: t.counter.partyTotalBeersLabel, value: String(table) });
  }
  return stats;
}

/** How many beers are written down this evening. */
export function fourthStat({ beerTimes }: PulseInput): PulseStat {
  return { label: t.liveParty.statLoggedBeers, value: String(beerTimes.length) };
}
