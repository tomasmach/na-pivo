import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildDrinkEntry } from '@/data/drinksClient';
import {
  ensureDrinkQueued,
  flushDrinksQueue,
  isDrinkQueued,
} from '@/data/drinksQueue';
import { decodeGeohash8 } from '@/data/geohash';
import { trackClientEvent } from '@/data/telemetryClient';
import { syncVisit } from '@/data/visitsSync';
import { isContextPubKey, isServingType, normalizeDrinkType } from '@/drinks/drinkTypes';
import {
  ensureNotificationPermissionForBeerFeatures,
  refreshBeerCountReminderAfterBeer,
} from '@/notifications/beerCountReminder';
import { waitForSettingsHydration, useSettingsStore } from '@/stores/settingsStore';
import {
  sessionPlaceContext,
  useTallyStore,
  type TallyDrink,
  type TallySession,
} from '@/stores/tallyStore';
import { ensureLiveActivityIconUri } from '@/liveActivity/liveActivityIcon';
import {
  buildBeerEveningLiveActivityProps,
  shouldRequestAndroidNotificationPermission,
  type BeerEveningLiveActivityProps,
} from '@/liveActivity/liveBeerActivityModel';
import {
  ackPendingAdds,
  end as endAndroidActivity,
  getPendingAdds,
  startOrUpdate as startOrUpdateAndroidActivity,
  type BeerLiveActivityPendingAdd,
} from '../../modules/beer-live-activity';

type IosLiveActivityInstance = {
  update(props: BeerEveningLiveActivityProps): Promise<void>;
  end(
    dismissalPolicy?: 'default' | 'immediate',
    props?: BeerEveningLiveActivityProps,
    contentDate?: Date,
  ): Promise<void>;
};

interface IosLiveActivityFactory {
  start(props: BeerEveningLiveActivityProps, url?: string): IosLiveActivityInstance;
  getInstances(): IosLiveActivityInstance[];
}

const COUNTER_DEEP_LINK = 'napivo://beer';
const TALLY_STORAGE_KEY = 'na-pivo-tally';
const MAX_PENDING_ADDS_PER_PASS = 50;

let installed = false;
let operationQueue: Promise<void> = Promise.resolve();
let pendingReconciliationQueue: Promise<void> = Promise.resolve();
let lastPayloadSignature: string | null | undefined;
let lastPayload: BeerEveningLiveActivityProps | null | undefined;

function serialize(operation: () => Promise<void>): void {
  operationQueue = operationQueue.then(operation, operation).catch(() => undefined);
}

function loadIosFactory(): IosLiveActivityFactory | null {
  try {
    // expo-widgets requires a native development/production build. Keeping the
    // import lazy lets Expo Go and unit-test harnesses degrade to a no-op.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('@/liveActivity/BeerEveningLiveActivity') as {
      default?: IosLiveActivityFactory;
    };
    return module.default ?? null;
  } catch {
    return null;
  }
}

async function syncIos(props: BeerEveningLiveActivityProps | null): Promise<void> {
  const factory = loadIosFactory();
  if (!factory) return;

  if (props) {
    const iosMajorVersion = Number.parseInt(String(Platform.Version).split('.')[0] ?? '', 10);
    props = {
      ...props,
      supportsInteractiveAdd: Number.isFinite(iosMajorVersion) && iosMajorVersion >= 17,
    };
    const iconUri = await ensureLiveActivityIconUri();
    if (iconUri) props = { ...props, iconUri };
  }

  const instances = factory.getInstances();
  if (!props) {
    await Promise.all(instances.map((instance) => instance.end('immediate')));
    return;
  }

  if (instances.length === 0) {
    factory.start(props, COUNTER_DEEP_LINK);
    return;
  }

  // There should only ever be one beer evening. Recover defensively from a
  // previous start race by keeping the first instance and removing duplicates.
  await instances[0].update(props);
  await Promise.all(instances.slice(1).map((instance) => instance.end('immediate')));
}

async function syncAndroid(
  props: BeerEveningLiveActivityProps | null,
  allowPermissionPrompt: boolean,
): Promise<void> {
  if (!props) {
    await endAndroidActivity();
    return;
  }

  const status = await startOrUpdateAndroidActivity(props);
  if (!status.notificationsEnabled && allowPermissionPrompt) {
    const permission = await ensureNotificationPermissionForBeerFeatures();
    if (permission.ok) await startOrUpdateAndroidActivity(props);
  }
}

async function syncPlatformActivity(
  props: BeerEveningLiveActivityProps | null,
  allowAndroidPermissionPrompt: boolean,
): Promise<void> {
  if (Platform.OS === 'ios') await syncIos(props);
  else if (Platform.OS === 'android') {
    await syncAndroid(props, allowAndroidPermissionPrompt);
  }
}

function currentPayload(): BeerEveningLiveActivityProps | null {
  const settings = useSettingsStore.getState();
  return buildBeerEveningLiveActivityProps(useTallyStore.getState().current, {
    hidePubNames: settings.hidePubNames,
    priceCurrency: settings.priceCurrency,
  });
}

function requestSync(): void {
  const payload = currentPayload();
  const signature = payload ? JSON.stringify(payload) : null;
  if (signature === lastPayloadSignature) return;
  // A cold restore must stay silent. Once initialization has observed the
  // current state, a newly started evening or a foreground beer increment may
  // ask for Android notification permission if it is still missing.
  const allowAndroidPermissionPrompt = shouldRequestAndroidNotificationPermission(
    lastPayload,
    payload,
  );
  lastPayloadSignature = signature;
  lastPayload = payload;
  serialize(() => syncPlatformActivity(payload, allowAndroidPermissionPrompt));
}

async function waitForTallyHydration(): Promise<void> {
  const persist = useTallyStore.persist;
  if (persist.hasHydrated()) return;

  await new Promise<void>((resolve) => {
    const unsubscribe = persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });

    if (persist.hasHydrated()) {
      unsubscribe();
      resolve();
    } else {
      void persist.rehydrate();
    }
  });
}

function eventTimestamp(event: BeerLiveActivityPendingAdd): string {
  const value = Number(event.createdAt);
  const now = Date.now();
  // Native events use epoch milliseconds. Fall back to reconciliation time for
  // malformed/future values instead of letting a corrupted tap roll sessions.
  const safe = Number.isFinite(value) && value > 0 && value <= now + 5 * 60_000 ? value : now;
  return new Date(safe).toISOString();
}

function latestBeer(session: TallySession): TallyDrink | null {
  return (
    [...session.drinks]
      .reverse()
      .find((drink) => normalizeDrinkType(drink.drinkType) === 'beer') ?? null
  );
}

function repeatedBeer(event: BeerLiveActivityPendingAdd, fallback: TallyDrink): TallyDrink {
  const beerName =
    typeof event.beerName === 'string' && event.beerName.trim() && event.beerName.length <= 120
      ? event.beerName.trim()
      : fallback.beerName;
  return {
    id: event.id,
    beerName,
    at: eventTimestamp(event),
    ...(typeof event.priceCzk === 'number' && Number.isFinite(event.priceCzk)
      ? { priceCzk: event.priceCzk }
      : typeof fallback.priceCzk === 'number'
        ? { priceCzk: fallback.priceCzk }
        : {}),
    ...(typeof event.volumeMl === 'number' && Number.isFinite(event.volumeMl)
      ? { volumeMl: event.volumeMl }
      : typeof fallback.volumeMl === 'number'
        ? { volumeMl: fallback.volumeMl }
        : {}),
    ...(isServingType(event.servingType)
      ? { servingType: event.servingType }
      : fallback.servingType
        ? { servingType: fallback.servingType }
        : {}),
  };
}

function buildRepeatedDrinkEntry(
  session: TallySession,
  beer: TallyDrink,
  event: BeerLiveActivityPendingAdd,
) {
  const drankAt = eventTimestamp(event);
  if (isContextPubKey(session.pubKey)) {
    return buildDrinkEntry(
      {
        placeContext: sessionPlaceContext(session),
        drinkType: 'beer',
        beer: {
          name: beer.beerName,
          priceCzk: beer.priceCzk,
          volumeMl: beer.volumeMl,
          servingType: beer.servingType,
        },
        drankAt,
      },
      event.id,
    );
  }

  // Pub drinks are price-backed by design. If an old/corrupt row has no price,
  // keep the new tally local instead of constructing an invalid backend event.
  if (typeof beer.priceCzk !== 'number') return null;
  const { lat, lng } = decodeGeohash8(session.pubKey);
  return buildDrinkEntry(
    {
      externalId: session.pubExternalId ?? null,
      name: session.pubName,
      lat,
      lng,
      city: session.pubCity,
      drinkType: 'beer',
      beer: {
        name: beer.beerName,
        priceCzk: beer.priceCzk,
        volumeMl: beer.volumeMl,
        servingType: beer.servingType,
      },
      drankAt,
    },
    event.id,
  );
}

async function isDrinkPersisted(drinkId: string): Promise<boolean> {
  // Zustand's AsyncStorage persist write finishes shortly after the synchronous
  // store mutation. Confirm it before acknowledging the native event so a
  // process kill between the two cannot lose the beer.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await AsyncStorage.getItem(TALLY_STORAGE_KEY);
      if (raw) {
        const persisted = JSON.parse(raw) as {
          state?: {
            current?: { drinks?: { id?: unknown }[] } | null;
            history?: { drinks?: { id?: unknown }[] }[];
          };
        };
        const sessions = [
          ...(persisted.state?.current ? [persisted.state.current] : []),
          ...(persisted.state?.history ?? []),
        ];
        if (sessions.some((session) => session.drinks?.some((drink) => drink.id === drinkId))) {
          return true;
        }
      }
    } catch {
      return false;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return false;
}

/**
 * Commits lock-screen `+ pivo` taps into the same local tally and retry queue as
 * the in-app counter. Native events are only acknowledged after the local
 * persisted store contains their UUID, making replay after a crash idempotent.
 */
async function reconcilePendingLiveBeerAddsInternal(): Promise<void> {
  let pending: BeerLiveActivityPendingAdd[];
  try {
    pending = await getPendingAdds();
  } catch {
    return;
  }
  if (pending.length === 0) return;

  const unique = new Map<string, BeerLiveActivityPendingAdd>();
  for (const event of pending) {
    if (
      typeof event.id === 'string' &&
      event.id.length <= 64 &&
      typeof event.sessionId === 'string' &&
      event.sessionId.length <= 128 &&
      !unique.has(event.id)
    ) {
      unique.set(event.id, event);
    }
    if (unique.size >= MAX_PENDING_ADDS_PER_PASS) break;
  }

  const acknowledge = new Set<string>();
  const committedIds: string[] = [];

  for (const event of [...unique.values()].sort((a, b) => a.createdAt - b.createdAt)) {
    const current = useTallyStore.getState().current;
    if (!current || current.clientId !== event.sessionId) {
      // The user already ended/replaced this evening. Never resurrect a stale
      // Live Activity action into an unrelated session.
      acknowledge.add(event.id);
      continue;
    }

    const latest = latestBeer(current);
    if (!latest) {
      acknowledge.add(event.id);
      continue;
    }
    const sourceBeer = repeatedBeer(event, latest);

    try {
      const entry = buildRepeatedDrinkEntry(current, sourceBeer, event);
      if (entry) await ensureDrinkQueued(entry);

      if (!current.drinks.some((drink) => drink.id === event.id)) {
        useTallyStore.getState().addDrinkToSession(current.clientId, {
          id: event.id,
          beerName: sourceBeer.beerName,
          drinkType: 'beer',
          priceCzk: sourceBeer.priceCzk,
          volumeMl: sourceBeer.volumeMl,
          servingType: sourceBeer.servingType,
          at: sourceBeer.at,
        });
        void trackClientEvent({
          event: 'drink_added',
          context: { had_active_session: true, source: 'live_activity' },
        });
      }

      if (await isDrinkPersisted(event.id)) {
        acknowledge.add(event.id);
        committedIds.push(event.id);
      }
    } catch {
      // Leave the native event pending; the next foreground pass can retry it.
    }
  }

  if (acknowledge.size > 0) {
    try {
      await ackPendingAdds([...acknowledge]);
    } catch {
      // Replaying already-persisted UUIDs is safe.
    }
  }

  if (committedIds.length > 0) {
    const current = useTallyStore.getState().current;
    syncVisit(current);
    if (current) void refreshBeerCountReminderAfterBeer(current.clientId);
    await flushDrinksQueue();
    await Promise.all(
      committedIds.map(async (id) => {
        if (!(await isDrinkQueued(id))) useTallyStore.getState().markDrinkSynced(id);
      }),
    );
  }
}

export function reconcilePendingLiveBeerAdds(): Promise<void> {
  const result = pendingReconciliationQueue.then(
    reconcilePendingLiveBeerAddsInternal,
    reconcilePendingLiveBeerAddsInternal,
  );
  pendingReconciliationQueue = result.catch(() => undefined);
  return result;
}

/**
 * Hydrates the tally, commits native actions, and only then applies the idle
 * cutoff. Every lifecycle/UI sweep uses this ordering so a fresh lock-screen
 * tap can never be archived as stale before it reaches the diary.
 */
export async function reconcileLiveBeerActivityAndAutoArchive(): Promise<void> {
  await waitForTallyHydration();
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    await reconcilePendingLiveBeerAdds();
  }
  useTallyStore.getState().maybeAutoArchive();
}

/**
 * Installs one process-wide bridge from the persisted tally to the system
 * surfaces. Native failures stay best-effort and can never block counting.
 */
export async function initializeLiveBeerActivity(): Promise<void> {
  if (installed) return;
  installed = true;

  await Promise.all([waitForTallyHydration(), waitForSettingsHydration()]);

  const isNativeActivityPlatform = Platform.OS === 'ios' || Platform.OS === 'android';
  await reconcileLiveBeerActivityAndAutoArchive();

  if (!isNativeActivityPlatform) return;

  useTallyStore.subscribe(requestSync);
  useSettingsStore.subscribe((state, previousState) => {
    if (
      state.hidePubNames !== previousState.hidePubNames ||
      state.priceCurrency !== previousState.priceCurrency
    ) {
      requestSync();
    }
  });
  requestSync();
}
