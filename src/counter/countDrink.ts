/**
 * The counter's write path without a screen around it, for the new look.
 *
 * Same data rules as CounterScreen's countBeer/removeDrinkById: the tally is
 * written first (works offline), the /v1/drinks POST is persisted at once but
 * held back for the undo window so the payload stays retractable, a pub drink
 * refreshes the visit and merges its price into the local community menu, and
 * a live drink in a pub of the running tour checks that stop off.
 */

import { generateUuidV4 } from '@/data/account';
import { mergeBeerIntoMenu, type CommunityBeer } from '@/data/communityHours';
import { enqueueDelete, flushDeleteDrinksQueue } from '@/data/deleteDrinksQueue';
import { buildDrinkEntry } from '@/data/drinksClient';
import { enqueueDrink, flushDrinksQueue, isDrinkQueued, removeQueuedDrink } from '@/data/drinksQueue';
import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import { trackClientEvent } from '@/data/telemetryClient';
import { deleteVisitByClientId, syncVisit } from '@/data/visitsSync';
import { contextFromPubKey, contextPubKey, isContextPubKey, type DrinkType, type OutsidePlaceContext, type ServingType } from '@/drinks/drinkTypes';
import { MIN_PLAUSIBLE_BEER_GAP_MS } from '@/drinks/drinkTiming';
import { t } from '@/i18n';
import { refreshBeerCountReminderAfterBeer } from '@/notifications/beerCountReminder';
import { useAccountStore } from '@/stores/accountStore';
import { useCommunityStore } from '@/stores/communityStore';
import { isPastEveningBackdate, useTallyStore, type TallySession } from '@/stores/tallyStore';
import { useToursStore } from '@/stores/toursStore';
import { tourStopAtPub } from '@/tours/counterLink';
import type { TourStop } from '@/tours/model';

/** Mirrors CounterScreen.UNDO_WINDOW_MS. */
export const UNDO_WINDOW_MS = 6000;

export type CountPlace = { kind: 'pub'; pub: Pub } | { kind: 'outside'; context: OutsidePlaceContext };

export interface CountableDrink {
  name: string;
  priceCzk?: number;
  volumeMl?: number;
  drinkType?: DrinkType;
  servingType?: ServingType;
}

export interface CountResult {
  id: string;
  session: TallySession | null;
  tourStop: { stop: TourStop; number: number } | null;
}

export function placeKey(place: CountPlace): string {
  return place.kind === 'pub' ? geohash8(place.pub.lat, place.pub.lng) : contextPubKey(place.context);
}

export function placeLabel(place: CountPlace): string {
  return place.kind === 'pub' ? place.pub.name : t.counter.outsideLabel(place.context);
}

/** The outside place of the evening still being counted, if it has one. */
export function liveOutsideContext(): OutsidePlaceContext | null {
  const current = useTallyStore.getState().current;
  if (!current || current.drinks.length === 0) return null;
  return contextFromPubKey(current.pubKey);
}

/** True when a tap lands so soon after the last drink that it is likely a double tap. */
export function isRapidDrink(lastDrinkAt: string | undefined, nowMs = Date.now()): boolean {
  if (!lastDrinkAt) return false;
  const elapsed = nowMs - Date.parse(lastDrinkAt);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_PLAUSIBLE_BEER_GAP_MS;
}

const sendTimers = new Map<string, ReturnType<typeof setTimeout>>();
const tourMarks = new Map<string, { stopId: string; cell: string }>();

/** Count one drink at `place`. `at` backdates it; an earlier drinking day files it into history. */
export function countDrink(
  place: CountPlace,
  beer: CountableDrink,
  options: { at?: string; menu?: readonly CommunityBeer[] } = {},
): CountResult {
  const tally = useTallyStore.getState();
  const cell = placeKey(place);
  const pub = place.kind === 'pub' ? place.pub : null;
  const id = generateUuidV4();
  const at = options.at ?? new Date().toISOString();
  const drinkType = beer.drinkType ?? 'beer';
  const startsSession = tally.current?.pubKey !== cell || (tally.current?.drinks.length ?? 0) === 0;

  const tallyPlace = pub
    ? { pubKey: cell, pubName: pub.name, pubCity: pub.city, pubExternalId: pub.id }
    : { pubKey: cell, pubName: placeLabel(place), placeContext: (place as { context: OutsidePlaceContext }).context };
  const tallyBeer = {
    id,
    beerName: beer.name,
    drinkType,
    priceCzk: beer.priceCzk,
    volumeMl: beer.volumeMl,
    servingType: beer.servingType,
    at,
  };

  let session: TallySession | null;
  if (options.at && isPastEveningBackdate(at)) {
    session = tally.addBackdatedDrink(tallyPlace, tallyBeer);
  } else {
    tally.addDrink(tallyPlace, tallyBeer);
    session = useTallyStore.getState().current;
  }

  if (!options.at && drinkType === 'beer' && session) {
    void refreshBeerCountReminderAfterBeer(session.clientId);
  }
  const tourStop = pub && !options.at ? tourStopAtPub(useToursStore.getState().activeRun, cell, pub.id) : null;
  if (tourStop) {
    tourMarks.set(id, { stopId: tourStop.stop.id, cell });
    void useToursStore.getState().markStop(tourStop.stop.id, 'visited');
  }
  if (pub) syncVisit(session);
  if (!options.at && startsSession) void trackClientEvent({ event: 'counter_session_started' });
  void trackClientEvent({
    event: 'drink_added',
    context: {
      had_active_session: !startsSession,
      backdated: !!options.at,
      ...(drinkType === 'beer' ? {} : { drink_type: drinkType }),
      ...(place.kind === 'outside' ? { place_context: place.context } : {}),
    },
  });

  // Pub only: an outside beer must never enter community data.
  if (pub && drinkType === 'beer' && typeof beer.priceCzk === 'number') {
    const community = useCommunityStore.getState();
    const base = options.menu ?? community.overrides[cell]?.beers ?? pub.beers ?? [];
    const next = mergeBeerIntoMenu(base, { name: beer.name, priceCzk: beer.priceCzk, volumeMl: beer.volumeMl });
    if (next !== base) community.setOverride(cell, { beers: next });
  }

  const entry = buildDrinkEntry(
    {
      ...(pub
        ? { externalId: pub.id || null, name: pub.name, lat: pub.lat, lng: pub.lng, city: pub.city }
        : { placeContext: (place as { context: OutsidePlaceContext }).context }),
      drinkType,
      beer: { name: beer.name, priceCzk: beer.priceCzk, volumeMl: beer.volumeMl, servingType: beer.servingType },
      drankAt: at,
    },
    id,
  );
  void enqueueDrink(entry, { deliver: false });
  sendTimers.set(
    id,
    setTimeout(() => {
      sendTimers.delete(id);
      void flushDrinksQueue()
        .then(() => isDrinkQueued(id))
        .then((stillQueued) => {
          if (!stillQueued) useTallyStore.getState().markDrinkSynced(id);
        });
    }, UNDO_WINDOW_MS),
  );

  return { id, session, tourStop };
}

/** Undo the tour check-off a drink made, while no other drink keeps the group there. */
function undoTourMark(id: string): void {
  const mark = tourMarks.get(id);
  if (!mark) return;
  tourMarks.delete(id);
  const live = useTallyStore.getState().current;
  const stillThere = live?.pubKey === mark.cell && live.drinks.length > 0;
  if (!stillThere && useToursStore.getState().activeRun?.statuses[mark.stopId] === 'visited') {
    void useToursStore.getState().markStop(mark.stopId, null);
  }
}

/** Retract a delivered or still-queued drink from the backend. */
function retractDrink(id: string): void {
  void removeQueuedDrink(id).then((pulledFromQueue) => {
    void trackClientEvent({
      event: 'drink_removed',
      context: { delivery_state: pulledFromQueue ? 'queued' : 'delivered' },
    });
    if (pulledFromQueue) return;
    useAccountStore.getState().forgetDiaryDrink(id);
    void enqueueDelete(id, { deliver: false })
      .then(() => flushDrinksQueue())
      .then(() => flushDeleteDrinksQueue())
      .catch(() => undefined);
  });
}

/** Drop one drink of the live evening and reconcile its visit and delivery. */
export function removeCountedDrink(id: string): boolean {
  const timer = sendTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    sendTimers.delete(id);
  }
  const before = useTallyStore.getState().current;
  if (!useTallyStore.getState().removeDrink(id)) return false;
  undoTourMark(id);
  if (before && !isContextPubKey(before.pubKey)) {
    const next = useTallyStore.getState().current;
    if (next && next.drinks.length > 0) syncVisit(next, new Date().toISOString());
    else deleteVisitByClientId(before.clientId);
  }
  retractDrink(id);
  return true;
}

/** Drop one drink of any evening (diary edits). */
export function removeDrinkFromEvening(session: TallySession, id: string): boolean {
  const timer = sendTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    sendTimers.delete(id);
  }
  const removed = useTallyStore.getState().removeDrinkFromSession(session.startedAt, id);
  if (!removed) return false;
  if (!isContextPubKey(session.pubKey)) {
    const state = useTallyStore.getState();
    const next = [state.current, ...state.history].find((s) => s?.clientId === session.clientId) ?? null;
    if (next && next.drinks.length > 0) syncVisit(next, new Date().toISOString());
    else deleteVisitByClientId(session.clientId);
  }
  retractDrink(id);
  return true;
}
