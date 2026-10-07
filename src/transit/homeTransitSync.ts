import { decodeGeohash8 } from '@/data/geohash';
import { fetchLastDirectDeparture, loadTransitStops } from '@/data/transitClient';
import { isContextPubKey } from '@/drinks/drinkTypes';
import { useHomeTransitStore, waitForHomeTransitHydration } from '@/stores/homeTransitStore';
import {
  useSettingsStore,
  waitForSettingsHydration,
  type HomePoint,
} from '@/stores/settingsStore';
import { useTallyStore, whenTallyHydrated, type TallySession } from '@/stores/tallyStore';
import { stopIdsNearHome, type HomeTransitDeparture } from '@/transit/homeTransit';

// The timetable does not change during an evening; ask again only now and then.
const REFRESH_AFTER_MS = 20 * 60 * 1000;
// After a failed request the next foreground waits a little before trying again.
const RETRY_AFTER_MS = 2 * 60 * 1000;

interface Lookup {
  key: string;
  from: { lat: number; lng: number };
  home: HomePoint;
}

let installed = false;
let inFlight: Promise<void> | null = null;
let queued: { force: boolean } | null = null;
let lastAttemptAt = 0;
let departureTimer: ReturnType<typeof setTimeout> | null = null;

/** Only a real pub has a place to leave from; home must be set. */
function lookupFor(session: TallySession | null, home: HomePoint | null): Lookup | null {
  if (!session || !home || isContextPubKey(session.pubKey)) return null;
  return {
    key: `${session.clientId}|${session.pubKey}|${home.lat.toFixed(5)},${home.lng.toFixed(5)}`,
    from: decodeGeohash8(session.pubKey),
    home,
  };
}

function currentLookup(): Lookup | null {
  return lookupFor(useTallyStore.getState().current, useSettingsStore.getState().homePoint);
}

function storesHydrated(): boolean {
  return (
    useTallyStore.persist.hasHydrated() &&
    useSettingsStore.persist.hasHydrated() &&
    useHomeTransitStore.persist.hasHydrated()
  );
}

/** The stored connection only while it still belongs to this evening, pub and home. */
export function homeTransitForCurrentEvening(): HomeTransitDeparture | null {
  const { lookupKey, departure } = useHomeTransitStore.getState();
  return lookupKey && lookupKey === currentLookup()?.key ? departure : null;
}

/** Drop an answer for another evening, pub or home right away, not after a request. */
function dropStaleAnswer(): void {
  if (!storesHydrated()) return;
  const state = useHomeTransitStore.getState();
  const lookup = currentLookup();
  if (!state.lookupKey || state.lookupKey === lookup?.key) return;
  if (lookup) state.setResult(lookup.key, null, 0);
  else state.clear();
}

/** When the connection leaves, drop it and ask whether anything later is left. */
function armDepartureTimer(): void {
  if (departureTimer) clearTimeout(departureTimer);
  departureTimer = null;
  const departure = useHomeTransitStore.getState().departure;
  if (!departure) return;
  const delay = departure.departsAtMs - Date.now() + 1000;
  // setTimeout cannot hold more than ~24 days; a departure is always tonight.
  if (delay > 24 * 60 * 60 * 1000) return;
  departureTimer = setTimeout(() => {
    departureTimer = null;
    const state = useHomeTransitStore.getState();
    if (state.lookupKey) state.setResult(state.lookupKey, null, 0);
    void refreshHomeTransit({ force: true });
  }, Math.max(delay, 0));
}

async function refreshInternal(force: boolean): Promise<void> {
  // An empty store before hydration would look like a finished evening.
  await Promise.all([whenTallyHydrated(), waitForSettingsHydration(), waitForHomeTransitHydration()]);
  const lookup = currentLookup();
  const state = useHomeTransitStore.getState();
  if (!lookup) {
    if (state.lookupKey) state.clear();
    return;
  }
  if (state.lookupKey !== lookup.key) {
    // Another pub's or another evening's connection must never show here.
    state.setResult(lookup.key, null, 0);
  } else if (!force) {
    const now = Date.now();
    if (state.checkedAt > 0 && now - state.checkedAt < REFRESH_AFTER_MS) return;
    if (now - lastAttemptAt < RETRY_AFTER_MS) return;
  }
  lastAttemptAt = Date.now();

  const stops = await loadTransitStops();
  if (!stops) return;
  const toStopIds = stopIdsNearHome(stops, lookup.home);
  const result =
    toStopIds.length === 0
      ? ({ ok: true, departure: null } as const)
      : await fetchLastDirectDeparture({
          fromLat: lookup.from.lat,
          fromLng: lookup.from.lng,
          toStopIds,
        });
  // The evening, pub or home may have changed while the request was out.
  if (!result.ok || currentLookup()?.key !== lookup.key) return;
  useHomeTransitStore.getState().setResult(lookup.key, result.departure, Date.now());
}

/** Ask for tonight's last connection home when it is missing or getting old. */
export function refreshHomeTransit(options: { force?: boolean } = {}): Promise<void> {
  const force = options.force === true;
  dropStaleAnswer();
  if (inFlight) {
    // A change during a request (new pub, new home) gets its own pass after it.
    queued = { force: (queued?.force ?? false) || force };
    return inFlight;
  }
  inFlight = refreshInternal(force)
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
      armDepartureTimer();
      const next = queued;
      queued = null;
      if (next) void refreshHomeTransit(next);
    });
  return inFlight;
}

/** Follow the evening and the home point. Safe to call more than once. */
export function initializeHomeTransit(): void {
  if (installed) return;
  installed = true;
  useTallyStore.subscribe((state, previous) => {
    if (
      state.current?.clientId !== previous.current?.clientId ||
      state.current?.pubKey !== previous.current?.pubKey
    ) {
      void refreshHomeTransit();
    }
  });
  useSettingsStore.subscribe((state, previous) => {
    if (state.homePoint !== previous.homePoint) void refreshHomeTransit({ force: true });
  });
  void refreshHomeTransit();
}

/** Test hook. */
export function resetHomeTransitSync(): void {
  if (departureTimer) clearTimeout(departureTimer);
  departureTimer = null;
  inFlight = null;
  queued = null;
  lastAttemptAt = 0;
  installed = false;
}
