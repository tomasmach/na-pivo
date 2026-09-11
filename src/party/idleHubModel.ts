/**
 * What the hub says before the first beer — pure functions over data the
 * phone already has, so the idle screen works with no signal at all.
 */

import type { PartyTap } from '@/mocks/livePartyStore';
import { drinkingDayKey, sessionCount, type TallySession } from '@/stores/tallyStore';

/**
 * The beer the first-beer button pours, and names.
 *
 * The pub's own tap wins, because that is what the house pours and what the
 * button promises; with several taps mapped it is the one the evening was
 * opened with, and with none at all it stays the pub-less fallback the store
 * already holds. Nothing here guesses a beer the pub does not serve.
 */
export function firstDrinkTap(taps: readonly PartyTap[], houseBeer: string): PartyTap {
  return (
    taps.find((tap) => tap.name === houseBeer) ??
    taps[0] ?? { name: houseBeer, priceCzk: null }
  );
}

/**
 * The big number before the night runs.
 *
 * Usually zero, and zero is the right answer once an evening has been finished:
 * that one is in "Naposledy" now, and repeating its count as the headline over
 * a button that starts a new one would be the same number twice.
 *
 * It is NOT zero while the counter's own session is still open without the
 * party chrome around it — the app was relaunched, the shared table was lost,
 * the evening was never restored. Those beers are tonight's, they are in the
 * diary, and a hub reading "0" over them would be lying about the only number
 * on the screen. A session from an earlier drinking day is not tonight.
 */
export function idleBeerCount(current: TallySession | null, now: Date): number {
  if (!current) return 0;
  if (drinkingDayKey(new Date(current.startedAt)) !== drinkingDayKey(now)) return 0;
  return sessionCount(current);
}

/** The most recent archived evening with something in it, or null. */
export function lastArchivedSession(history: readonly TallySession[]): TallySession | null {
  return history.find((session) => session.drinks.length > 0) ?? null;
}
