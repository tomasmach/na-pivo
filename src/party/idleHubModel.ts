/**
 * What the hub says before the first beer — pure functions over data the
 * phone already has, so the idle screen works with no signal at all.
 */

import { t } from '@/i18n';
import type { GameDef } from '@/party/gameCatalog';
import type { TallySession } from '@/stores/tallyStore';

/** "Pub kvíz, Kostky a 7 dalších" — two names, the rest counted. */
export function gamesLine(catalog: readonly Pick<GameDef, 'name'>[]): string {
  const names = catalog.slice(0, 2).map((game) => game.name).join(', ');
  const rest = catalog.length - 2;
  return rest > 0 ? `${names} ${t.liveParty.idleGamesMore(rest)}` : names;
}

/** The most recent archived evening with something in it, or null. */
export function lastArchivedSession(history: readonly TallySession[]): TallySession | null {
  return history.find((session) => session.drinks.length > 0) ?? null;
}
