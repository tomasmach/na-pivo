/**
 * DESIGN MOCK — the roast, as rules rather than a list of jokes.
 *
 * A hard-coded set of lines is funny twice and then it is wallpaper. So this
 * derives the line FROM the night's numbers: every roast is a true observation,
 * delivered flat. That is what makes it land and what keeps it defensible —
 * nobody can argue with "tři hospody a ani jedna fotka" because it happened.
 *
 * ── When it must NOT fire ──────────────────────────────────────────────────
 *
 * The positioning is meme-ish and a bit rude, but rude at the wrong moment is
 * just unpleasant, and this is an app about alcohol. Hard stops:
 *
 *  - **Nothing happened.** One beer, or a night under ~20 minutes. There is no
 *    joke in "you had a beer"; a roast here reads as nagging someone for
 *    existing.
 *  - **First night ever.** Meeting a new user with a jab is a bad first
 *    impression and there is no baseline to be funny about anyway.
 *  - **Alone.** The voice is the table talking back. A joke about drinking by
 *    yourself, told to someone drinking by themselves, is not the same joke.
 *  - **Volume.** Never roast someone for drinking a LOT. Punching at quantity
 *    is where a beer app stops being a memory app and starts being a dare —
 *    and it is exactly what an App Store reviewer reads as encouragement.
 *
 * What it CAN be rude about: pace vs. your own normal, pubs visited, photos not
 * taken, games lost, how long it took, who left first, repeating the same pub.
 * Facts about the SHAPE of the night, never about how much anyone drank being
 * impressive.
 *
 * Every rule is guarded and the highest-priority match wins; when nothing
 * matches, there is no roast and the card falls back to the night's own title.
 * Silence is a valid outcome — a forced joke is worse than none.
 */

import { beerCountLabel, gameCountLabel, pubCountLabel, t } from '@/i18n';

export interface RoastInput {
  beers: number;
  /** Minutes. */
  duration: number;
  pubs: number;
  people: number;
  photos: number;
  /** Games played tonight, and whether you won any. */
  games: number;
  gamesWon: number;
  /** Your usual beers-per-hour, for pace comparisons. Null on a first night. */
  usualPerHour: number | null;
  /** How many times you have been to tonight's pub before. */
  visitsToSamePub: number;
}

export interface Roast {
  line: string;
  basis: string;
}

/** Below these, a night has not produced enough to be funny about. */
const MIN_BEERS = 2;
const MIN_MINUTES = 20;

export function buildRoast(input: RoastInput): Roast | null {
  // ── Hard stops, in order of how badly they would land ──
  if (input.people < 2) return null;
  if (input.usualPerHour === null) return null;
  if (input.beers < MIN_BEERS || input.duration < MIN_MINUTES) return null;

  const hours = input.duration / 60;
  const perHour = hours > 0 ? input.beers / hours : 0;
  const ratio = input.usualPerHour > 0 ? perHour / input.usualPerHour : 1;

  // ── Rules, highest priority first ──

  if (input.pubs >= 3 && input.photos === 0) {
    return {
      line: t.roast.noPhotos(pubCountLabel(input.pubs)),
      basis: t.roast.noPhotosBasis,
    };
  }

  if (input.games > 0 && input.gamesWon === 0) {
    return {
      line: t.roast.noWins(gameCountLabel(input.games)),
      basis: t.roast.noWinsBasis,
    };
  }

  if (input.visitsToSamePub >= 5 && input.pubs === 1) {
    return {
      line: t.roast.samePub,
      basis: t.roast.samePubBasis(input.visitsToSamePub),
    };
  }

  if (ratio <= 0.5 && input.duration >= 180) {
    return {
      line: t.roast.slowPace(formatDuration(input.duration), beerCountLabel(input.beers)),
      basis: t.roast.slowPaceBasis,
    };
  }

  // Nothing worth saying. The card uses the night's own title.
  return null;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return t.roast.durationMinutes(minutes);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? t.roast.durationHours(h) : t.roast.durationHoursMinutes(h, m);
}
