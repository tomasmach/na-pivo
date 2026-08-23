import type { DrinkEntry } from './drinksClient';
import { enqueueDrink, removeQueuedDrink } from './drinksQueue';
import { syncVisit } from './visitsSync';
import type { TallySession } from '@/stores/tallyStore';

export type PrepareDrinkAdditionResult = 'queued' | 'storage-error';

/** Persist both halves of a drink action before its caller mutates local UI. */
export async function prepareDrinkAddition(
  entry: DrinkEntry,
  visit: TallySession,
  partyCode?: string | null,
): Promise<PrepareDrinkAdditionResult> {
  if ((await enqueueDrink(entry, { deliver: false })) === 'storage-error') {
    return 'storage-error';
  }
  if (
    (await syncVisit(visit, undefined, partyCode, { deliver: false })) === 'storage-error'
  ) {
    await removeQueuedDrink(entry.client_id);
    return 'storage-error';
  }
  return 'queued';
}
