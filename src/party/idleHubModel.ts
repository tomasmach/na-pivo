/**
 * What the hub says before the first beer — pure functions over data the
 * phone already has, so the idle screen works with no signal at all.
 */

import type { PartyTap } from '@/mocks/livePartyStore';
import { drinkingDayKey, sessionCount, type TallySession } from '@/stores/tallyStore';

/** What one press of the hub's amber button does. */
export type PrimaryTap = 'first' | 'repeat' | 'pick';

/**
 * The one rule behind that button.
 *
 * "Start the night" is only ever the answer when no night is running. It used
 * to be the fallthrough for a running evening with nothing to repeat — which
 * happens the moment you move to another pub or sit down at somebody's table —
 * and one tap there threw away the stopwatch, the stops and the games. A
 * running hub with nothing to repeat asks instead.
 */
export function primaryTapAction(active: boolean, repeatableDrink: boolean): PrimaryTap {
  if (!active) return 'first';
  return repeatableDrink ? 'repeat' : 'pick';
}

/**
 * The beer the first-beer button pours, and names.
 *
 * The pub's mapped tap wins — `partyTapOptions` has already put the pub's own
 * list in front — because that is what the house pours and what the button
 * promises. The stored house beer is only a fallback: it is set when the pub is
 * chosen, so at a pub whose tap list arrives a second later it is still the
 * generic "Pivo" while the real tap sits right there. Nothing here invents a
 * beer the pub does not serve.
 */
export function firstDrinkTap(taps: readonly PartyTap[], houseBeer: string): PartyTap {
  return taps[0] ?? { name: houseBeer, priceCzk: null };
}

/**
 * The big number before the night runs: beers this phone logged tonight.
 *
 * Tonight is the drinking day (04:00 to 04:00). Counting only the open session
 * made the hub read "0" directly above "Naposledy · Dnes · 1 pivo", and an
 * offline queue flush flipped it from 0 to 14 with nothing pressed. Yesterday
 * is not tonight.
 *
 * It is deliberately NOT the same number the running hub shows. This one is the
 * day; the running one is THIS evening, because that is what its stopwatch, its
 * thread and its recap are about. Starting a second night in one day therefore
 * goes 17 → 1, and that is the honest reading of both: seventeen today, one at
 * this table.
 */
export function idleBeerCount(
  current: TallySession | null,
  history: readonly TallySession[],
  now: Date,
): number {
  return tonight(current, history, now).reduce((sum, session) => sum + sessionCount(session), 0);
}

function tonight(
  current: TallySession | null,
  history: readonly TallySession[],
  now: Date,
): TallySession[] {
  const today = drinkingDayKey(now);
  return [current, ...history].filter(
    (session): session is TallySession =>
      session !== null && drinkingDayKey(new Date(session.startedAt)) === today,
  );
}

/**
 * The most recent evening with something in it that is NOT tonight.
 *
 * Tonight is already the big number above this row; printing it again as
 * "Naposledy · Dnes · 1 pivo" made the hub argue with itself. This row is the
 * tab's memory, and memory starts yesterday.
 */
export function lastArchivedSession(
  history: readonly TallySession[],
  now: Date,
): TallySession | null {
  const today = drinkingDayKey(now);
  return (
    history.find(
      (session) =>
        session.drinks.length > 0 && drinkingDayKey(new Date(session.startedAt)) !== today,
    ) ?? null
  );
}
