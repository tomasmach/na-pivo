import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildDrinkEntry } from '@/data/drinksClient';
import {
  PrivateAccountMutationFrozenError,
  capturePrivateAccountMutationScope,
  isPrivateAccountMutationScopeCurrent,
  registerPrivateAccountFreezeListener,
  runPrivateAccountMutation,
  type PrivateAccountMutationScope,
} from '@/data/privateAccountBoundary';
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
  selectConfirmedPartyJoinCode,
  usePartyEveningStore,
} from '@/stores/partyEveningStore';
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
  clearPendingAdds,
  end as endAndroidActivity,
  getPendingAdds,
  getStatus as getAndroidActivityStatus,
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
let initializationPromise: Promise<void> | null = null;
let operationQueue: Promise<void> = Promise.resolve();
let pendingReconciliationQueue: Promise<void> = Promise.resolve();
let lastPayloadSignature: string | null | undefined;
let lastPayload: BeerEveningLiveActivityProps | null | undefined;

function installIosInteractionListener(): void {
  if (Platform.OS !== 'ios') return;

  try {
    // Keep expo-widgets lazy so Expo Go and unit-test harnesses without its
    // native module can still initialize the rest of the beer counter.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { addUserInteractionListener } = require('expo-widgets') as {
      addUserInteractionListener(listener: (event: { target?: string }) => void): {
        remove(): void;
      };
    };
    addUserInteractionListener((event) => {
      if (event.target === 'add-beer') void reconcilePendingLiveBeerAdds();
    });
  } catch {
    // Foreground reconciliation remains the fallback when widgets are absent.
  }
}

function assertCurrentScope(scope: PrivateAccountMutationScope): void {
  if (!isPrivateAccountMutationScopeCurrent(scope)) {
    throw new PrivateAccountMutationFrozenError();
  }
}

function ignoreFrozen(result: Promise<void>): Promise<void> {
  return result.catch((error: unknown) => {
    if (!(error instanceof PrivateAccountMutationFrozenError)) throw error;
  });
}

/** Capture the global lease now, before this operation waits behind the local
 * native mutex. This prevents an A update queued here from waking after B. */
function serialize(operation: (scope: PrivateAccountMutationScope) => Promise<void>): Promise<void> {
  const previous = operationQueue;
  const result = runPrivateAccountMutation(async (scope) => {
    await previous;
    assertCurrentScope(scope);
    await operation(scope);
    assertCurrentScope(scope);
  });
  operationQueue = result.catch(() => undefined);
  return ignoreFrozen(result);
}

registerPrivateAccountFreezeListener(() => {
  // A store subscription may have coalesced A's payload just before the
  // transition. Force the first post-boundary B payload to publish again.
  lastPayloadSignature = undefined;
  lastPayload = undefined;
});

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

async function endIosActivities(factory: IosLiveActivityFactory): Promise<void> {
  const instances = factory.getInstances();
  await Promise.all(instances.map((instance) => instance.end('immediate')));
}

async function assertCurrentIosScope(
  scope: PrivateAccountMutationScope,
  factory: IosLiveActivityFactory,
): Promise<void> {
  if (isPrivateAccountMutationScopeCurrent(scope)) return;
  try {
    await endIosActivities(factory);
  } catch {
    // The strict account-boundary cleanup retries and verifies the end after
    // this stale lease drains.
  }
  throw new PrivateAccountMutationFrozenError();
}

async function syncIos(
  props: BeerEveningLiveActivityProps | null,
  scope: PrivateAccountMutationScope,
): Promise<void> {
  assertCurrentScope(scope);
  const factory = loadIosFactory();
  if (!factory) return;

  if (props) {
    const iosMajorVersion = Number.parseInt(String(Platform.Version).split('.')[0] ?? '', 10);
    props = {
      ...props,
      supportsInteractiveAdd: Number.isFinite(iosMajorVersion) && iosMajorVersion >= 17,
    };
    const iconUri = await ensureLiveActivityIconUri();
    await assertCurrentIosScope(scope, factory);
    if (iconUri) props = { ...props, iconUri };
  }

  const instances = factory.getInstances();
  if (!props) {
    await Promise.all(instances.map((instance) => instance.end('immediate')));
    await assertCurrentIosScope(scope, factory);
    return;
  }

  if (instances.length === 0) {
    factory.start(props, COUNTER_DEEP_LINK);
    await assertCurrentIosScope(scope, factory);
    return;
  }

  // There should only ever be one beer evening. Recover defensively from a
  // previous start race by keeping the first instance and removing duplicates.
  await instances[0].update(props);
  await assertCurrentIosScope(scope, factory);
  await Promise.all(instances.slice(1).map((instance) => instance.end('immediate')));
  await assertCurrentIosScope(scope, factory);
}

async function endAndroidAfterInvalidation(): Promise<void> {
  try {
    await endAndroidActivity();
    await clearPendingAdds();
  } catch {
    // The strict cleanup repeats and verifies both operations after drain.
  }
}

async function assertCurrentAndroidScope(scope: PrivateAccountMutationScope): Promise<void> {
  if (isPrivateAccountMutationScopeCurrent(scope)) return;
  await endAndroidAfterInvalidation();
  throw new PrivateAccountMutationFrozenError();
}

async function syncAndroid(
  props: BeerEveningLiveActivityProps | null,
  allowPermissionPrompt: boolean,
  scope: PrivateAccountMutationScope,
): Promise<void> {
  assertCurrentScope(scope);
  if (!props) {
    await endAndroidActivity();
    await assertCurrentAndroidScope(scope);
    return;
  }

  const status = await startOrUpdateAndroidActivity(props);
  await assertCurrentAndroidScope(scope);
  if (!status.notificationsEnabled && allowPermissionPrompt) {
    try {
      const permission = await ensureNotificationPermissionForBeerFeatures();
      await assertCurrentAndroidScope(scope);
      if (permission.ok) {
        await startOrUpdateAndroidActivity(props);
        await assertCurrentAndroidScope(scope);
      }
    } catch (error) {
      if (!isPrivateAccountMutationScopeCurrent(scope)) {
        await endAndroidAfterInvalidation();
      }
      throw error;
    }
  }
}

async function syncPlatformActivity(
  props: BeerEveningLiveActivityProps | null,
  allowAndroidPermissionPrompt: boolean,
  scope: PrivateAccountMutationScope,
): Promise<void> {
  assertCurrentScope(scope);
  if (Platform.OS === 'ios') await syncIos(props, scope);
  else if (Platform.OS === 'android') {
    await syncAndroid(props, allowAndroidPermissionPrompt, scope);
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
  const invocationScope = capturePrivateAccountMutationScope();
  if (!isPrivateAccountMutationScopeCurrent(invocationScope)) return;
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
  void serialize((scope) =>
    syncPlatformActivity(payload, allowAndroidPermissionPrompt, scope),
  ).catch(() => undefined);
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

/** The native action is reconciled outside React, so read the same shared-table
 * store the in-app counter uses. A stale/ended evening is harmless server-side,
 * but an explicitly inactive one should never be attached locally. */
function activePartyCode(): string | null {
  return selectConfirmedPartyJoinCode(usePartyEveningStore.getState());
}

function buildRepeatedDrinkEntry(
  session: TallySession,
  beer: TallyDrink,
  event: BeerLiveActivityPendingAdd,
) {
  const drankAt = eventTimestamp(event);
  const partyCode = activePartyCode();
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
        ...(partyCode ? { partyCode } : {}),
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
      ...(partyCode ? { partyCode } : {}),
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
async function reconcilePendingLiveBeerAddsInternal(
  scope: PrivateAccountMutationScope,
): Promise<void> {
  assertCurrentScope(scope);
  let pending: BeerLiveActivityPendingAdd[];
  try {
    pending = await getPendingAdds();
  } catch {
    return;
  }
  assertCurrentScope(scope);
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
    assertCurrentScope(scope);
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
      if (entry) {
        const queued = await ensureDrinkQueued(entry);
        if (queued === 'storage-error') {
          // Even a failed enqueue is an awaited step across the boundary —
          // re-check the lease before touching the next event.
          assertCurrentScope(scope);
          continue;
        }
        assertCurrentScope(scope);
      }

      if (!current.drinks.some((drink) => drink.id === event.id)) {
        assertCurrentScope(scope);
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

      const persisted = await isDrinkPersisted(event.id);
      assertCurrentScope(scope);
      if (persisted) {
        acknowledge.add(event.id);
        committedIds.push(event.id);
      }
    } catch (error) {
      if (error instanceof PrivateAccountMutationFrozenError) throw error;
      // Leave the native event pending; the next foreground pass can retry it.
    }
  }

  if (acknowledge.size > 0) {
    try {
      assertCurrentScope(scope);
      await ackPendingAdds([...acknowledge]);
      assertCurrentScope(scope);
    } catch (error) {
      if (error instanceof PrivateAccountMutationFrozenError) throw error;
      // Replaying already-persisted UUIDs is safe.
    }
  }

  if (committedIds.length > 0) {
    assertCurrentScope(scope);
    const current = useTallyStore.getState().current;
    const partyCode = activePartyCode();
    if (partyCode) syncVisit(current, undefined, partyCode);
    else syncVisit(current);
    // Do not finish the native interaction reconciliation until the old local
    // reminder is cancelled and a fresh one is anchored to this beer.
    if (current) await refreshBeerCountReminderAfterBeer(current.clientId);
    await flushDrinksQueue();
    assertCurrentScope(scope);
    await Promise.all(
      committedIds.map(async (id) => {
        const queued = await isDrinkQueued(id);
        assertCurrentScope(scope);
        if (!queued) useTallyStore.getState().markDrinkSynced(id);
      }),
    );
  }
}

function enqueuePendingReconciliation(scope: PrivateAccountMutationScope): Promise<void> {
  const result = pendingReconciliationQueue.then(
    () => {
      assertCurrentScope(scope);
      return reconcilePendingLiveBeerAddsInternal(scope);
    },
    () => {
      assertCurrentScope(scope);
      return reconcilePendingLiveBeerAddsInternal(scope);
    },
  );
  pendingReconciliationQueue = result.catch(() => undefined);
  return result;
}

export function reconcilePendingLiveBeerAdds(): Promise<void> {
  return ignoreFrozen(
    runPrivateAccountMutation(async (scope) => {
      await enqueuePendingReconciliation(scope);
      assertCurrentScope(scope);
    }),
  );
}

/**
 * Hydrates the tally, commits native actions, and only then applies the idle
 * cutoff. Every lifecycle/UI sweep uses this ordering so a fresh lock-screen
 * tap can never be archived as stale before it reaches the diary.
 */
async function reconcileLiveBeerActivityAndAutoArchiveInternal(
  scope: PrivateAccountMutationScope,
): Promise<void> {
  await waitForTallyHydration();
  assertCurrentScope(scope);
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    await enqueuePendingReconciliation(scope);
    assertCurrentScope(scope);
  }
  useTallyStore.getState().maybeAutoArchive();
}

export function reconcileLiveBeerActivityAndAutoArchive(): Promise<void> {
  return ignoreFrozen(
    runPrivateAccountMutation((scope) =>
      reconcileLiveBeerActivityAndAutoArchiveInternal(scope),
    ),
  );
}

/**
 * Installs one process-wide bridge from the persisted tally to the system
 * surfaces. Native failures stay best-effort and can never block counting.
 */
export function initializeLiveBeerActivity(): Promise<void> {
  if (initializationPromise) return initializationPromise;

  const result = runPrivateAccountMutation(async (scope) => {
    if (installed) return;
    await Promise.all([waitForTallyHydration(), waitForSettingsHydration()]);
    assertCurrentScope(scope);

    const isNativeActivityPlatform = Platform.OS === 'ios' || Platform.OS === 'android';
    installIosInteractionListener();
    await reconcileLiveBeerActivityAndAutoArchiveInternal(scope);
    assertCurrentScope(scope);

    if (!isNativeActivityPlatform) {
      installed = true;
      return;
    }

    useTallyStore.subscribe(requestSync);
    useSettingsStore.subscribe((state, previousState) => {
      if (
        state.hidePubNames !== previousState.hidePubNames ||
        state.priceCurrency !== previousState.priceCurrency
      ) {
        requestSync();
      }
    });
    installed = true;
    requestSync();
  });
  initializationPromise = ignoreFrozen(result).finally(() => {
    initializationPromise = null;
  });
  return initializationPromise;
}

async function clearNativePendingAddsWithReadback(): Promise<boolean> {
  let nativeClearSucceeded = false;
  try {
    nativeClearSucceeded = await clearPendingAdds();
    for (let pass = 0; pass < 3; pass += 1) {
      const remaining = await getPendingAdds();
      if (remaining.length === 0) return nativeClearSucceeded;
      const ids = remaining
        .map((event) => event.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (ids.length > 0) await ackPendingAdds(ids);
      nativeClearSucceeded = (await clearPendingAdds()) && nativeClearSucceeded;
    }
    return false;
  } catch {
    return false;
  }
}

async function endIosActivitiesWithReadback(): Promise<boolean> {
  const factory = loadIosFactory();
  if (!factory) return false;
  try {
    await endIosActivities(factory);
    return factory.getInstances().length === 0;
  } catch {
    return false;
  }
}

async function endAndroidActivityWithReadback(): Promise<boolean> {
  try {
    const ended = await endAndroidActivity();
    const verified = await getAndroidActivityStatus();
    return (
      !ended.active &&
      ended.sessionId === null &&
      !verified.active &&
      verified.sessionId === null
    );
  } catch {
    return false;
  }
}

/**
 * Strict account-boundary cleanup. The caller has already frozen and drained
 * global mutations; this additionally drains both local native lanes, removes
 * every OS surface, and verifies that no previous-account action remains.
 */
export async function clearLiveBeerActivityForAccountBoundary(): Promise<boolean> {
  await Promise.all([operationQueue, pendingReconciliationQueue]);

  const activityCleared =
    Platform.OS === 'ios'
      ? await endIosActivitiesWithReadback()
      : Platform.OS === 'android'
        ? await endAndroidActivityWithReadback()
        : true;
  const pendingAddsCleared =
    Platform.OS === 'ios' || Platform.OS === 'android'
      ? await clearNativePendingAddsWithReadback()
      : true;

  lastPayloadSignature = undefined;
  lastPayload = undefined;
  return activityCleared && pendingAddsCleared;
}
