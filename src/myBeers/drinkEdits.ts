import { enqueueDelete, flushDeleteDrinksQueue } from '@/data/deleteDrinksQueue';
import { enqueueDrink, flushDrinksQueue, removeQueuedDrink, updateQueuedDrinkBeerName } from '@/data/drinksQueue';
import { buildHistoricalDrinkEntry } from '@/data/drinksHistorySync';
import { enqueueDrinkUpdate, removeQueuedDrinkUpdate } from '@/data/updateDrinksQueue';
import { deleteVisitByClientId, syncVisit } from '@/data/visitsSync';
import { useAccountStore } from '@/stores/accountStore';
import { findSessionByStart, rejectedFieldOf, useTallyStore, type DrinkFix, type TallyDrink } from '@/stores/tallyStore';

function syncSession(startedAt: string): void {
  const { current, history } = useTallyStore.getState();
  const session = findSessionByStart(current, history, startedAt);
  if (session) syncVisit(session, new Date().toISOString());
}

/** Renames already logged drinks of one evening; offline the change waits in the queue. */
export function renameSessionDrinks(startedAt: string, drinks: TallyDrink[], beerName: string): void {
  const changed = drinks.filter((drink) => drink.beerName !== beerName);
  if (changed.length === 0) return;
  for (const drink of changed) useTallyStore.getState().updateDrinkNameInSession(startedAt, drink.id, beerName);
  syncSession(startedAt);
  for (const drink of changed) {
    void updateQueuedDrinkBeerName(drink.id, beerName).then((state) => {
      if (state !== 'queued') void enqueueDrinkUpdate({ client_id: drink.id, beer_name: beerName });
    });
  }
}

/** Deletes one logged drink; the evening's visit goes too when it was the last one. */
export function deleteSessionDrink(startedAt: string, drinkId: string): boolean {
  const removed = useTallyStore.getState().removeDrinkFromSession(startedAt, drinkId);
  if (!removed) return false;
  if (removed.remainingDrinks > 0) syncSession(startedAt);
  else deleteVisitByClientId(removed.sessionClientId);
  void removeQueuedDrinkUpdate(removed.drinkId);
  void removeQueuedDrink(removed.drinkId).then((pulledFromQueue) => {
    // Persist a DELETE before waiting for an in-flight POST. The
    // server's removal tombstone also protects a restart in between.
    if (!pulledFromQueue) {
      useAccountStore.getState().forgetDiaryDrink(removed.drinkId);
      void enqueueDelete(removed.drinkId, { deliver: false })
        .then(() => flushDrinksQueue())
        .then(() => flushDeleteDrinksQueue())
        .catch(() => undefined);
    }
  });
  return true;
}

/** Corrects a drink the server refused and sends it again under its own client_id; offline it waits in the queue. */
export function fixSessionDrink(startedAt: string, drink: TallyDrink, fix: DrinkFix): boolean {
  const store = useTallyStore.getState();
  if (!store.fixDrinkInSession(startedAt, drink.id, fix)) return false;
  const { current, history } = useTallyStore.getState();
  const session = findSessionByStart(current, history, startedAt);
  if (!session) return false;
  syncVisit(session, new Date().toISOString());
  const fixed = session.drinks.find((candidate) => candidate.id === drink.id);
  const entry = fixed ? buildHistoricalDrinkEntry(session, fixed) : null;
  if (!entry) {
    store.markDrinkRejected(drink.id, rejectedFieldOf(drink));
    return false;
  }
  void enqueueDrink(entry).then((delivered) => {
    if (delivered) useTallyStore.getState().markDrinkSynced(drink.id);
  });
  return true;
}
