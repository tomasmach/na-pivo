import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';

import { generateUuidV4 } from '@/data/account';
import { ensureDeleteQueued, flushDeleteDrinksQueue } from '@/data/deleteDrinksQueue';
import { buildDrinkEntry } from '@/data/drinksClient';
import {
  ensureDrinkQueued,
  flushDrinksQueue,
  removeQueuedDrink,
} from '@/data/drinksQueue';
import { decodeGeohash8, geohash8 } from '@/data/geohash';
import { getAllLoadedPubs } from '@/data/pubs';
import { buildVisitEntry } from '@/data/visitsSync';
import { ensureVisitOpQueued, flushVisitsQueue } from '@/data/visitsQueue';
import {
  isDrinkType,
  isServingType,
  type DrinkType,
  type ServingType,
} from '@/drinks/drinkTypes';
import { useAccountStore } from '@/stores/accountStore';
import { useFocusedPubStore } from '@/stores/focusedPubStore';
import {
  drinkingDayKey,
  useTallyStore,
  type TallyDrink,
  type TallyPub,
  type TallySession,
} from '@/stores/tallyStore';
import {
  selectedWearableTarget,
  useWearableTargetStore,
} from '@/stores/wearableTargetStore';
import {
  ackPendingCommands,
  addWearableCommandListener,
  getPendingCommands,
  getTransportStatus,
  publishSnapshot,
  requestSync,
} from 'na-pivo-wearable-bridge';

import {
  parseWearableCommandEnvelope,
  WEARABLE_PROTOCOL_VERSION,
  type WearableCommandEnvelope,
  type WearableDrinkChoice,
  type WearableDrinkSpec,
  type WearableEveningState,
  type WearablePubRef,
  type WearableStateSnapshotEnvelope,
} from './protocol';
import {
  applyWearableCommand,
  createWearableSyncState,
  type WearableApplyStatus,
  type WearableSyncState,
} from './stateReducer';
import {
  beginMobileWearableSyncOperation,
  getMobileWearableSyncBoundary,
  MOBILE_WEARABLE_SHADOW_STORAGE_KEY,
  resumeMobileWearableAccountBoundary,
} from './mobileSyncBoundary';

const EPOCH_BINDING_KEY = 'na-pivo-wearable-account-epoch-v1';
const SNAPSHOT_STALE_AFTER_MS = 15 * 60 * 1000;
const BACKGROUND_POLL_MS = 12_000;
const MAX_SNAPSHOT_EVENINGS = 20;
const MAX_CHOICES = 20;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GEOHASH_8_RE = /^[0123456789bcdefghjkmnpqrstuvwxyz]{8}$/;
const GENERIC_DRINK_NAMES = new Set([
  'beer',
  'drink',
  'napoj',
  'nealko',
  'neco',
  'něco',
  'nápoj',
  'panak',
  'panák',
  'pivo',
  'shot',
  'vino',
  'víno',
]);

interface EpochBinding {
  accountId: string;
  epoch: string;
}

interface PhoneShadow {
  version: 1;
  accountEpoch: string;
  actorId: string;
  actorSequence: number;
  state: WearableSyncState;
}

let installed = false;
let installationPromise: Promise<void> | null = null;
let activeAccountId: string | null = null;
let shadow: PhoneShadow | null = null;
let serialWork: Promise<void> = Promise.resolve();
let publishTimer: ReturnType<typeof setTimeout> | null = null;
let commandCommitInProgress = false;

interface CoordinatorContext {
  accountId: string;
  boundaryGeneration: number;
}

function enqueueSerial(work: () => Promise<void>): Promise<void> {
  const next = serialWork.then(work, work);
  serialWork = next.catch(() => undefined);
  return next;
}

async function runDurableCoordinatorOperation<T>(
  work: () => Promise<T>,
): Promise<T> {
  const finishOperation = beginMobileWearableSyncOperation();
  try {
    return await work();
  } finally {
    finishOperation();
  }
}

function captureCoordinatorContext(): CoordinatorContext | null {
  const boundary = getMobileWearableSyncBoundary();
  const accountId = useAccountStore.getState().session?.accountId ?? null;
  if (
    boundary.suspended ||
    !shadow ||
    !activeAccountId ||
    accountId !== activeAccountId
  ) {
    return null;
  }
  return {
    accountId: activeAccountId,
    boundaryGeneration: boundary.generation,
  };
}

function coordinatorContextIsCurrent(context: CoordinatorContext): boolean {
  const boundary = getMobileWearableSyncBoundary();
  return (
    !boundary.suspended &&
    boundary.generation === context.boundaryGeneration &&
    activeAccountId === context.accountId &&
    useAccountStore.getState().session?.accountId === context.accountId &&
    shadow !== null
  );
}

function isConcreteDrinkName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 80 &&
    !GENERIC_DRINK_NAMES.has(trimmed.toLocaleLowerCase('cs'))
  );
}

function isValidPrice(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 1000
  );
}

function isValidVolume(value: unknown, type: DrinkType): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 10 &&
    value <= (type === 'shot' ? 200 : 3000)
  );
}

function defaultVolume(type: DrinkType): number {
  if (type === 'shot') return 40;
  if (type === 'wine') return 200;
  return 500;
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function safeServingType(value: unknown): ServingType {
  return isServingType(value) ? value : 'unknown';
}

function isCanonicalPubRef(pub: WearablePubRef): boolean {
  return (
    typeof pub.name === 'string' &&
    pub.name.trim().length > 0 &&
    pub.name.length <= 200 &&
    Number.isFinite(pub.latitude) &&
    pub.latitude >= -90 &&
    pub.latitude <= 90 &&
    Number.isFinite(pub.longitude) &&
    pub.longitude >= -180 &&
    pub.longitude <= 180 &&
    GEOHASH_8_RE.test(pub.pubKey) &&
    geohash8(pub.latitude, pub.longitude) === pub.pubKey
  );
}

function assertCanonicalPubRef(pub: WearablePubRef): void {
  if (!isCanonicalPubRef(pub)) {
    throw new Error('Wearable pub identity is inconsistent');
  }
}

function commandPubRefsAreCanonical(
  envelope: WearableCommandEnvelope,
): boolean {
  const command = envelope.payload.command;
  if (command.type === 'set_target') {
    return isCanonicalPubRef(command.target.pub);
  }
  if (command.type === 'start_evening_and_add_drink') {
    return isCanonicalPubRef(command.pub);
  }
  return true;
}

function setManualTargetFromWearable(pub: WearablePubRef): void {
  assertCanonicalPubRef(pub);
  useWearableTargetStore.getState().setManualTarget(pub);
  useFocusedPubStore.setState({
    pub: {
      cacheKey: pub.pubKey,
      name: pub.name,
      lat: pub.latitude,
      lng: pub.longitude,
    },
  });
}

function adoptConfirmedPubTarget(pub: WearablePubRef): void {
  const selected = selectedWearableTarget();
  if (
    selected?.selection === 'manual' &&
    selected.pub.pubKey !== pub.pubKey
  ) {
    return;
  }
  setManualTargetFromWearable(pub);
}

function tallyPubFromWearable(pub: WearablePubRef): TallyPub {
  assertCanonicalPubRef(pub);
  return {
    pubKey: pub.pubKey,
    pubName: pub.name,
    ...(pub.city ? { pubCity: pub.city } : {}),
    ...(pub.externalId ? { pubExternalId: pub.externalId } : {}),
  };
}

function pubRefForSession(
  session: TallySession,
  knownPubs: readonly WearablePubRef[],
): WearablePubRef | null {
  if (!GEOHASH_8_RE.test(session.pubKey)) return null;
  const known = knownPubs.find(
    (pub) => pub.pubKey === session.pubKey && isCanonicalPubRef(pub),
  );
  if (known) {
    return {
      ...known,
      name: session.pubName || known.name,
      ...(session.pubCity ? { city: session.pubCity } : {}),
      ...(session.pubExternalId ? { externalId: session.pubExternalId } : {}),
    };
  }
  const { lat, lng } = decodeGeohash8(session.pubKey);
  return {
    pubKey: session.pubKey,
    name: session.pubName,
    latitude: lat,
    longitude: lng,
    ...(session.pubCity ? { city: session.pubCity } : {}),
    ...(session.pubExternalId ? { externalId: session.pubExternalId } : {}),
  };
}

function tallyDrinkToSpec(drink: TallyDrink): WearableDrinkSpec | null {
  const type = isDrinkType(drink.drinkType) ? drink.drinkType : 'beer';
  if (
    !UUID_RE.test(drink.id) ||
    !isConcreteDrinkName(drink.beerName) ||
    !isValidPrice(drink.priceCzk) ||
    !validIso(drink.at)
  ) {
    return null;
  }
  const volumeMl = isValidVolume(drink.volumeMl, type)
    ? drink.volumeMl
    : defaultVolume(type);
  return {
    id: drink.id,
    name: drink.beerName.trim(),
    drinkType: type,
    volumeMl,
    priceCzk: drink.priceCzk,
    servingType: safeServingType(drink.servingType),
    recordedAt: drink.at,
  };
}

function choiceKey(
  name: string,
  drinkType: DrinkType,
  volumeMl: number | null,
  priceCzk: number | null,
  servingType: ServingType,
): string {
  return [
    name.trim().toLocaleLowerCase('cs'),
    drinkType,
    volumeMl ?? '',
    priceCzk ?? '',
    servingType,
  ].join('|');
}

function tallyDrinkToChoice(drink: TallyDrink): WearableDrinkChoice | null {
  const drinkType = isDrinkType(drink.drinkType) ? drink.drinkType : 'beer';
  if (!isConcreteDrinkName(drink.beerName)) return null;
  const volumeMl = isValidVolume(drink.volumeMl, drinkType) ? drink.volumeMl : null;
  const priceCzk = isValidPrice(drink.priceCzk) ? drink.priceCzk : null;
  const servingType = safeServingType(drink.servingType);
  const key = choiceKey(drink.beerName, drinkType, volumeMl, priceCzk, servingType);
  return {
    choiceId: `history:${key}`.slice(0, 128),
    name: drink.beerName.trim(),
    drinkType,
    volumeMl,
    priceCzk,
    servingType,
  };
}

function allSessions(): TallySession[] {
  const { current, history } = useTallyStore.getState();
  return [...(current ? [current] : []), ...history];
}

function buildDrinkChoices(): {
  recentDrinks: WearableDrinkChoice[];
  frequentDrinks: WearableDrinkChoice[];
} {
  const source = allSessions()
    .flatMap((session) => session.drinks)
    .filter((drink) => !useTallyStore.getState().removedDrinkIds.includes(drink.id))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const recentByKey = new Map<string, WearableDrinkChoice>();
  const frequency = new Map<
    string,
    { choice: WearableDrinkChoice; count: number; latestAt: number }
  >();

  for (const drink of source) {
    const choice = tallyDrinkToChoice(drink);
    if (!choice) continue;
    const key = choiceKey(
      choice.name,
      choice.drinkType,
      choice.volumeMl,
      choice.priceCzk,
      choice.servingType,
    );
    if (!recentByKey.has(key)) recentByKey.set(key, choice);
    const previous = frequency.get(key);
    frequency.set(key, {
      choice,
      count: (previous?.count ?? 0) + 1,
      latestAt: Math.max(previous?.latestAt ?? 0, Date.parse(drink.at) || 0),
    });
  }

  return {
    recentDrinks: [...recentByKey.values()].slice(0, MAX_CHOICES),
    frequentDrinks: [...frequency.values()]
      .sort((a, b) => b.count - a.count || b.latestAt - a.latestAt)
      .map(({ choice }) => choice)
      .slice(0, MAX_CHOICES),
  };
}

function loadedMenuChoices(pubKey: string): WearableDrinkChoice[] {
  const pub = getAllLoadedPubs().find(
    (candidate) => geohash8(candidate.lat, candidate.lng) === pubKey,
  );
  return (pub?.beers ?? [])
    .map((beer, index): WearableDrinkChoice | null => {
      if (!isConcreteDrinkName(beer.name)) return null;
      return {
        choiceId: `menu:${pubKey}:${index}:${beer.name.toLocaleLowerCase('cs')}`.slice(
          0,
          128,
        ),
        name: beer.name.trim(),
        drinkType: 'beer',
        volumeMl: isValidVolume(beer.volumeMl, 'beer') ? beer.volumeMl : null,
        priceCzk: isValidPrice(beer.priceCzk) ? beer.priceCzk : null,
        servingType: 'unknown',
      };
    })
    .filter((choice): choice is WearableDrinkChoice => choice !== null)
    .slice(0, MAX_CHOICES);
}

function makeEveningState(
  session: TallySession,
  status: WearableEveningState['status'],
  knownPubs: readonly WearablePubRef[],
  globalRemoved: ReadonlySet<string>,
  prior?: WearableEveningState,
): WearableEveningState | null {
  if (!UUID_RE.test(session.clientId) || !validIso(session.startedAt)) return null;
  const pub = pubRefForSession(session, knownPubs);
  if (!pub) return null;
  const removed = new Set(prior?.removedDrinkIds ?? []);
  for (const drink of [...(prior?.drinks ?? []), ...session.drinks]) {
    if (globalRemoved.has(drink.id)) removed.add(drink.id);
  }
  return {
    eveningId: session.clientId,
    pub,
    drinkingDayKey: drinkingDayKey(new Date(session.startedAt)),
    startedAt: session.startedAt,
    ...(validIso(session.closedAt) ? { closedAt: session.closedAt } : {}),
    status,
    drinks: session.drinks
      .filter((drink) => !globalRemoved.has(drink.id))
      .map(tallyDrinkToSpec)
      .filter((drink): drink is WearableDrinkSpec => drink !== null),
    removedDrinkIds: [...removed],
  };
}

function materializeStateFromPhone(state: WearableSyncState): WearableSyncState {
  const targetState = useWearableTargetStore.getState();
  const selectedCandidate = selectedWearableTarget();
  const selected =
    selectedCandidate && isCanonicalPubRef(selectedCandidate.pub)
      ? selectedCandidate
      : null;
  const knownPubs = [
    ...(selected ? [selected.pub] : []),
    ...targetState.nearbyPubs,
    ...Object.values(state.evenings).map((evening) => evening.pub),
  ].filter(isCanonicalPubRef);
  const tally = useTallyStore.getState();
  const globalRemoved = new Set([
    ...state.removedDrinkIds,
    ...tally.removedDrinkIds,
  ]);
  const evenings: Record<string, WearableEveningState> = {};
  const conflictIds = new Set<string>();
  for (const conflict of state.eveningConflicts) {
    conflictIds.add(conflict.activeEveningId);
    conflictIds.add(conflict.incomingEveningId);
  }
  for (const evening of Object.values(state.evenings)) {
    if (evening.status === 'conflict') conflictIds.add(evening.eveningId);
  }

  // Facts already represented by the tally are rebuilt below. Only unresolved
  // conflict branches survive outside it; this prevents an ever-growing shadow
  // (and prevents a deleted last drink from being resurrected by stale state).
  for (const eveningId of conflictIds) {
    const prior = state.evenings[eveningId];
    if (!prior || !isCanonicalPubRef(prior.pub)) continue;
    const removedDrinkIds = new Set(prior.removedDrinkIds);
    const drinks = prior.drinks.filter((drink) => {
      if (!globalRemoved.has(drink.id)) return true;
      removedDrinkIds.add(drink.id);
      return false;
    });
    evenings[eveningId] = {
      ...prior,
      drinks,
      removedDrinkIds: [...removedDrinkIds],
    };
  }

  for (const session of tally.history) {
    const prior = evenings[session.clientId];
    const status = prior?.status === 'conflict' ? 'conflict' : 'closed';
    const evening = makeEveningState(
      session,
      status,
      knownPubs,
      globalRemoved,
      prior,
    );
    if (evening) evenings[evening.eveningId] = evening;
  }
  if (tally.current) {
    const prior = evenings[tally.current.clientId];
    const evening = makeEveningState(
      tally.current,
      prior?.status === 'conflict' ? 'conflict' : 'active',
      knownPubs,
      globalRemoved,
      prior,
    );
    if (evening) evenings[evening.eveningId] = evening;
  }

  return {
    ...state,
    target: selected ? { selection: selected.selection, pub: selected.pub } : null,
    evenings,
    activeEveningId:
      tally.current && evenings[tally.current.clientId]
        ? tally.current.clientId
        : null,
    removedDrinkIds: [...globalRemoved],
  };
}

function domainFingerprint(state: WearableSyncState): string {
  return JSON.stringify({
    target: state.target,
    evenings: state.evenings,
    activeEveningId: state.activeEveningId,
    eveningAliases: state.eveningAliases,
    removedDrinkIds: state.removedDrinkIds,
    targetConflicts: state.targetConflicts,
    eveningConflicts: state.eveningConflicts,
  });
}

function materializeStateWithSemanticRevision(
  previous: WearableSyncState,
): WearableSyncState {
  const materialized = materializeStateFromPhone(previous);
  if (domainFingerprint(materialized) === domainFingerprint(previous)) {
    return materialized;
  }
  return { ...materialized, revision: previous.revision + 1 };
}

function isStoredShadow(value: unknown, epoch: string): value is PhoneShadow {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PhoneShadow>;
  const state = candidate.state as Partial<WearableSyncState> | undefined;
  return (
    candidate.version === 1 &&
    candidate.accountEpoch === epoch &&
    typeof candidate.actorId === 'string' &&
    candidate.actorId.length > 0 &&
    Number.isInteger(candidate.actorSequence) &&
    (candidate.actorSequence ?? -1) >= 0 &&
    !!state &&
    state.accountEpoch === epoch &&
    Number.isInteger(state.revision) &&
    (state.revision ?? -1) >= 0 &&
    !!state.evenings &&
    typeof state.evenings === 'object' &&
    (state.activeEveningId === null ||
      typeof state.activeEveningId === 'string') &&
    !!state.eveningAliases &&
    typeof state.eveningAliases === 'object' &&
    Array.isArray(state.removedDrinkIds) &&
    Array.isArray(state.processedMessageIds) &&
    !!state.actorSequences &&
    typeof state.actorSequences === 'object' &&
    Array.isArray(state.targetConflicts) &&
    Array.isArray(state.eveningConflicts)
  );
}

async function loadShadow(epoch: string): Promise<PhoneShadow | null> {
  try {
    const raw = await AsyncStorage.getItem(MOBILE_WEARABLE_SHADOW_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredShadow(parsed, epoch) ? parsed : null;
  } catch {
    return null;
  }
}

async function persistShadow(value: PhoneShadow): Promise<void> {
  await runDurableCoordinatorOperation(() =>
    AsyncStorage.setItem(
      MOBILE_WEARABLE_SHADOW_STORAGE_KEY,
      JSON.stringify(value),
    ),
  );
}

async function accountEpoch(accountId: string): Promise<string> {
  try {
    const raw = await SecureStore.getItemAsync(EPOCH_BINDING_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<EpochBinding>;
      if (
        parsed.accountId === accountId &&
        typeof parsed.epoch === 'string' &&
        UUID_RE.test(parsed.epoch)
      ) {
        return parsed.epoch;
      }
    }
  } catch {
    // A new binding below is safer than reusing an unreadable account epoch.
  }

  const binding: EpochBinding = { accountId, epoch: generateUuidV4() };
  await SecureStore.setItemAsync(EPOCH_BINDING_KEY, JSON.stringify(binding), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return binding.epoch;
}

async function waitForHydration(): Promise<void> {
  const stores = [useTallyStore, useWearableTargetStore] as const;
  await Promise.all(
    stores.map(async (store) => {
      if (!store.persist.hasHydrated()) await store.persist.rehydrate();
      if (!store.persist.hasHydrated()) {
        throw new Error('Wearable private state could not be hydrated');
      }
    }),
  );
}

function sessionById(clientId: string): TallySession | null {
  const { current, history } = useTallyStore.getState();
  if (current?.clientId === clientId) return current;
  return history.find((session) => session.clientId === clientId) ?? null;
}

async function queueSessionVisit(session: TallySession | null): Promise<void> {
  if (!session) return;
  // buildVisitEntry decodes pubKey to a representative coordinate. Never let a
  // malformed/provider id be interpreted as a geohash and fabricate a place.
  if (!GEOHASH_8_RE.test(session.pubKey)) return;
  const entry = buildVisitEntry(session);
  if (!entry) return;
  await ensureVisitOpQueued({ op: 'upsert', clientId: entry.client_id, entry });
}

async function queueDrink(
  pub: WearablePubRef,
  drink: WearableDrinkSpec,
  session: TallySession,
): Promise<void> {
  assertCanonicalPubRef(pub);
  await ensureDrinkQueued(
    buildDrinkEntry(
      {
        externalId: pub.externalId ?? null,
        name: pub.name,
        lat: pub.latitude,
        lng: pub.longitude,
        city: pub.city,
        drinkType: drink.drinkType,
        beer: {
          name: drink.name,
          priceCzk: drink.priceCzk,
          volumeMl: drink.volumeMl,
          servingType: drink.servingType,
        },
        drankAt: drink.recordedAt,
        eveningClientId: session.clientId,
      },
      drink.id,
    ),
  );
  await queueSessionVisit(session);
}

function canonicalEveningId(state: WearableSyncState, incomingId: string): string {
  let resolved = incomingId;
  const seen = new Set<string>();
  while (state.eveningAliases[resolved] && !seen.has(resolved)) {
    seen.add(resolved);
    resolved = state.eveningAliases[resolved];
  }
  return resolved;
}

async function commitDrinkCommand(
  nextState: WearableSyncState,
  eveningId: string,
  drink: WearableDrinkSpec,
  pub: WearablePubRef,
  status: WearableApplyStatus,
): Promise<void> {
  const tally = useTallyStore.getState();
  if (tally.isDrinkRemoved(drink.id)) {
    await removeQueuedDrink(drink.id);
    await ensureDeleteQueued(drink.id);
    return;
  }

  const canonicalId = canonicalEveningId(nextState, eveningId);
  let session = tally.hasDrink(drink.id) ? sessionById(canonicalId) : null;
  if (!session) {
    const beer = {
      id: drink.id,
      beerName: drink.name,
      drinkType: drink.drinkType,
      priceCzk: drink.priceCzk,
      volumeMl: drink.volumeMl,
      servingType: drink.servingType,
      at: drink.recordedAt,
    };
    const isDifferentPubConflict =
      status === 'conflict' &&
      nextState.activeEveningId !== canonicalId &&
      nextState.evenings[canonicalId]?.status === 'conflict';
    if (isDifferentPubConflict) {
      session = useTallyStore
        .getState()
        .addExternalDrinkToHistory(tallyPubFromWearable(pub), beer, canonicalId);
    } else {
      session = useTallyStore
        .getState()
        .addExternalDrink(tallyPubFromWearable(pub), beer, canonicalId);
    }
  }
  if (session) await queueDrink(pub, drink, session);
}

async function commitRemoveCommand(
  nextState: WearableSyncState,
  eveningId: string,
  drinkId: string,
): Promise<void> {
  const canonicalId = canonicalEveningId(nextState, eveningId);
  const removed = useTallyStore.getState().removeDrinkById(drinkId);
  await removeQueuedDrink(drinkId);
  await ensureDeleteQueued(drinkId);

  const session = sessionById(removed?.sessionClientId ?? canonicalId);
  if (session && session.drinks.length > 0) {
    await queueSessionVisit(session);
  } else {
    await ensureVisitOpQueued({
      op: 'delete',
      clientId: removed?.sessionClientId ?? canonicalId,
    });
  }
}

async function commitCloseCommand(
  nextState: WearableSyncState,
  eveningId: string,
  closedAt: string,
): Promise<void> {
  const canonicalId = canonicalEveningId(nextState, eveningId);
  useTallyStore.getState().archiveSession(canonicalId, closedAt);
  await queueSessionVisit(sessionById(canonicalId));
}

interface TallyConflictResolution {
  selected: TallySession | null;
  displaced: TallySession | null;
}

function resolveTallyConflict(
  nextState: WearableSyncState,
  selectedId: string,
  resolvedAt: string,
): TallyConflictResolution {
  const canonicalId = canonicalEveningId(nextState, selectedId);
  let resolution: TallyConflictResolution = {
    selected: sessionById(canonicalId),
    displaced: null,
  };
  useTallyStore.setState((state) => {
    if (state.current?.clientId === canonicalId) {
      resolution = { selected: state.current, displaced: null };
      return state;
    }
    const index = state.history.findIndex((session) => session.clientId === canonicalId);
    if (index < 0) return state;
    const selected = state.history[index];
    const history = state.history.filter((_, candidateIndex) => candidateIndex !== index);
    let displaced: TallySession | null = null;
    if (state.current?.drinks.length) {
      displaced = {
        ...state.current,
        archivedReason: 'manual',
        closedAt: state.current.closedAt ?? resolvedAt,
      };
      history.unshift(displaced);
    }
    const { archivedReason: _reason, closedAt: _closedAt, ...active } = selected;
    resolution = { selected: active, displaced };
    return { current: active, history };
  });
  return resolution;
}

async function commitCommand(
  envelope: WearableCommandEnvelope,
  nextState: WearableSyncState,
  status: WearableApplyStatus,
): Promise<void> {
  const command = envelope.payload.command;
  switch (command.type) {
    case 'set_target': {
      assertCanonicalPubRef(command.target.pub);
      if (command.target.selection === 'manual') {
        setManualTargetFromWearable(command.target.pub);
      } else {
        const targets = useWearableTargetStore.getState();
        targets.clearManualTarget();
        targets.setNearbySnapshot(command.target.pub, [
          command.target.pub,
          ...targets.nearbyPubs,
        ]);
        useFocusedPubStore.setState({ pub: null });
      }
      return;
    }
    case 'clear_target':
      useFocusedPubStore.setState({ pub: null });
      useWearableTargetStore.getState().clearManualTarget();
      return;
    case 'start_evening_and_add_drink':
      if (status === 'applied') {
        adoptConfirmedPubTarget(command.pub);
      }
      await commitDrinkCommand(
        nextState,
        command.eveningId,
        command.drink,
        command.pub,
        status,
      );
      return;
    case 'add_drink': {
      const canonicalId = canonicalEveningId(nextState, command.eveningId);
      const pub = nextState.evenings[canonicalId]?.pub;
      if (!pub) throw new Error('Wearable evening is unavailable');
      await commitDrinkCommand(nextState, canonicalId, command.drink, pub, status);
      return;
    }
    case 'remove_drink':
      await commitRemoveCommand(nextState, command.eveningId, command.drinkId);
      return;
    case 'close_evening':
      await commitCloseCommand(nextState, command.eveningId, command.closedAt);
      return;
    case 'resolve_evening_conflict': {
      const resolution = resolveTallyConflict(
        nextState,
        command.activeEveningId,
        envelope.sentAt,
      );
      await queueSessionVisit(resolution.displaced);
      await queueSessionVisit(resolution.selected);
      return;
    }
  }
}

function shouldCommitCommand(
  status: WearableApplyStatus,
  reason?: string,
): boolean {
  if (status === 'applied') return true;
  if (status !== 'conflict') return false;
  return (
    reason === 'concurrent_evenings_at_different_pubs' ||
    reason === 'late_add_preserved_without_reopening'
  );
}

async function replayShadowIntoTally(
  state: WearableSyncState,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isCurrent()) return;
  const targetStore = useWearableTargetStore.getState();
  if (state.target && isCanonicalPubRef(state.target.pub)) {
    if (state.target.selection === 'manual') {
      targetStore.setManualTarget(state.target.pub);
      useFocusedPubStore.setState({
        pub: {
          cacheKey: state.target.pub.pubKey,
          name: state.target.pub.name,
          lat: state.target.pub.latitude,
          lng: state.target.pub.longitude,
        },
      });
    } else {
      const nearbyPubs = [
        state.target.pub,
        ...targetStore.nearbyPubs.filter(
          (pub) => pub.pubKey !== state.target?.pub.pubKey,
        ),
      ].slice(0, 10);
      useWearableTargetStore.setState({
        manualTarget: null,
        nearestTarget: state.target.pub,
        nearbyPubs,
      });
      useFocusedPubStore.setState({ pub: null });
    }
  } else {
    targetStore.clearManualTarget();
    useFocusedPubStore.setState({ pub: null });
  }

  for (const drinkId of state.removedDrinkIds) {
    if (!isCurrent()) return;
    await removeQueuedDrink(drinkId);
    if (!isCurrent()) return;
    await ensureDeleteQueued(drinkId);
  }

  const evenings = Object.values(state.evenings)
    .filter((evening) => isCanonicalPubRef(evening.pub))
    .sort((a, b) => {
      if (a.eveningId === state.activeEveningId) return 1;
      if (b.eveningId === state.activeEveningId) return -1;
      return Date.parse(a.startedAt) - Date.parse(b.startedAt);
    });

  for (const evening of evenings) {
    if (!isCurrent()) return;
    for (const drink of evening.drinks) {
      if (!isCurrent()) return;
      if (
        evening.removedDrinkIds.includes(drink.id) ||
        state.removedDrinkIds.includes(drink.id)
      ) {
        useTallyStore.getState().removeDrinkById(drink.id);
        await removeQueuedDrink(drink.id);
        if (!isCurrent()) return;
        await ensureDeleteQueued(drink.id);
        continue;
      }
      await commitDrinkCommand(
        state,
        evening.eveningId,
        drink,
        evening.pub,
        evening.status === 'conflict' ? 'conflict' : 'applied',
      );
    }
    if (!isCurrent()) return;
    if (evening.status === 'closed' && evening.closedAt) {
      await commitCloseCommand(state, evening.eveningId, evening.closedAt);
    }
    if (!isCurrent()) return;
    if (evening.drinks.length === 0 && evening.removedDrinkIds.length > 0) {
      await ensureVisitOpQueued({
        op: 'delete',
        clientId: evening.eveningId,
      });
    }
  }
}

function snapshotEvenings(state: WearableSyncState): {
  activeEvening: WearableEveningState | null;
  otherEvenings: WearableEveningState[];
} {
  const activeEvening = state.activeEveningId
    ? state.evenings[state.activeEveningId] ?? null
    : null;
  const otherEvenings = Object.values(state.evenings)
    .filter(
      (evening) =>
        evening.eveningId !== activeEvening?.eveningId &&
        evening.status === 'conflict',
    )
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, MAX_SNAPSHOT_EVENINGS);
  return { activeEvening, otherEvenings };
}

async function publishPhoneSnapshot(
  expectedContext?: CoordinatorContext,
): Promise<void> {
  const context = expectedContext ?? captureCoordinatorContext();
  if (!context || !coordinatorContextIsCurrent(context) || !shadow) return;
  const now = new Date().toISOString();
  const targetState = useWearableTargetStore.getState();
  const transport = await getTransportStatus();
  if (!coordinatorContextIsCurrent(context) || !shadow) return;
  const state = materializeStateWithSemanticRevision(shadow.state);
  const sequence = shadow.actorSequence + 1;
  const { activeEvening, otherEvenings } = snapshotEvenings(state);
  const choices = buildDrinkChoices();
  const selected = state.target;
  const storedMenu =
    selected && targetState.menuPubKey === selected.pub.pubKey
      ? targetState.menuDrinks
      : selected
        ? loadedMenuChoices(selected.pub.pubKey)
        : [];
  const menuDrinks = selected
    ? storedMenu.filter(
          (choice) =>
            isConcreteDrinkName(choice.name) &&
            isDrinkType(choice.drinkType) &&
            (choice.volumeMl === null ||
              isValidVolume(choice.volumeMl, choice.drinkType)) &&
            (choice.priceCzk === null || isValidPrice(choice.priceCzk)) &&
            isServingType(choice.servingType),
        )
    : [];
  const refreshedAt = targetState.lastNearbyRefreshAt
    ? Date.parse(targetState.lastNearbyRefreshAt)
    : Number.NaN;
  const snapshot: WearableStateSnapshotEnvelope = {
    protocolVersion: WEARABLE_PROTOCOL_VERSION,
    messageId: generateUuidV4(),
    accountEpoch: shadow.accountEpoch,
    actorId: shadow.actorId,
    actorKind: 'phone',
    actorSequence: sequence,
    baseRevision: shadow.state.revision,
    sentAt: now,
    kind: 'state_snapshot',
    payload: {
      revision: state.revision,
      target: state.target,
      activeEvening,
      otherEvenings,
      nearbyPubs: targetState.nearbyPubs.filter(isCanonicalPubRef).slice(0, 10),
      recentDrinks: choices.recentDrinks,
      frequentDrinks: choices.frequentDrinks,
      menuDrinks,
      pendingCommandCount: transport.pendingCommands,
      isStale:
        !Number.isFinite(refreshedAt) ||
        Date.now() - refreshedAt > SNAPSHOT_STALE_AFTER_MS,
      lastPhoneContactAt: now,
    },
  };
  shadow = {
    ...shadow,
    actorSequence: sequence,
    state,
  };
  await persistShadow(shadow);
  if (!coordinatorContextIsCurrent(context)) return;
  await publishSnapshot(JSON.stringify(snapshot));
}

async function processPendingCommands(): Promise<void> {
  const context = captureCoordinatorContext();
  if (!context || !shadow) return;
  const pendingJson = await getPendingCommands();
  if (!coordinatorContextIsCurrent(context) || !shadow) return;
  if (pendingJson.length === 0) {
    await publishPhoneSnapshot(context);
    return;
  }

  const pending = pendingJson
    .map((raw) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        const result = parseWearableCommandEnvelope(parsed);
        return result.ok ? result.value : null;
      } catch {
        return null;
      }
    })
    .filter(
      (envelope): envelope is WearableCommandEnvelope =>
        envelope !== null && commandPubRefsAreCanonical(envelope),
    )
    .sort(
      (a, b) =>
        a.actorId.localeCompare(b.actorId) ||
        a.actorSequence - b.actorSequence ||
        a.messageId.localeCompare(b.messageId),
    );
  const acknowledged = new Set<string>();
  let madeProgress = true;

  while (madeProgress) {
    madeProgress = false;
    for (const envelope of pending) {
      if (!coordinatorContextIsCurrent(context) || !shadow) return;
      if (acknowledged.has(envelope.messageId)) continue;
      if (envelope.accountEpoch !== shadow.accountEpoch) continue;
      const result = applyWearableCommand(shadow.state, envelope);
      if (result.status === 'deferred') continue;
      if (
        result.status === 'rejected' &&
        result.reason === 'account_epoch_mismatch'
      ) {
        continue;
      }
      if (shouldCommitCommand(result.status, result.reason)) {
        commandCommitInProgress = true;
        try {
          await runDurableCoordinatorOperation(() =>
            commitCommand(envelope, result.state, result.status),
          );
        } finally {
          commandCommitInProgress = false;
        }
      }
      if (!coordinatorContextIsCurrent(context) || !shadow) return;
      shadow = { ...shadow, state: result.state };
      await persistShadow(shadow);
      if (!coordinatorContextIsCurrent(context)) return;
      acknowledged.add(envelope.messageId);
      madeProgress = true;
    }
  }

  await publishPhoneSnapshot(context);
  if (!coordinatorContextIsCurrent(context)) return;
  if (acknowledged.size > 0) {
    await ackPendingCommands([...acknowledged]);
    void flushDrinksQueue();
    void flushDeleteDrinksQueue();
    void flushVisitsQueue();
  }
}

function schedulePublish(): void {
  // A wearable command first mutates Zustand and then awaits its durable backend
  // queue writes. Publishing that optimistic intermediate state after a failed
  // queue write would make the retained inbox command look like a duplicate on
  // retry and could skip the missing queue operation.
  if (commandCommitInProgress) return;
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishTimer = null;
    void enqueueSerial(publishPhoneSnapshot);
  }, 250);
}

async function activateCurrentAccount(options?: {
  resumeBoundary?: boolean;
}): Promise<void> {
  const accountId = useAccountStore.getState().session?.accountId ?? null;
  if (!accountId) {
    shadow = null;
    activeAccountId = null;
    return;
  }
  const boundaryAtStart = getMobileWearableSyncBoundary();
  if (boundaryAtStart.suspended && !options?.resumeBoundary) return;
  if (accountId === activeAccountId && shadow) {
    await processPendingCommands();
    return;
  }

  const epoch = await accountEpoch(accountId);
  if (
    getMobileWearableSyncBoundary().generation !==
      boundaryAtStart.generation ||
    useAccountStore.getState().session?.accountId !== accountId
  ) {
    return;
  }
  const stored = await loadShadow(epoch);
  if (
    getMobileWearableSyncBoundary().generation !==
      boundaryAtStart.generation ||
    useAccountStore.getState().session?.accountId !== accountId
  ) {
    return;
  }
  shadow =
    stored ??
    {
      version: 1,
      accountEpoch: epoch,
      actorId: `phone-${generateUuidV4()}`,
      actorSequence: 0,
      state: createWearableSyncState(epoch),
    };
  activeAccountId = accountId;
  if (options?.resumeBoundary) resumeMobileWearableAccountBoundary();
  const context = captureCoordinatorContext();
  if (!context || !shadow) return;
  const stateToReplay = shadow.state;
  commandCommitInProgress = true;
  try {
    await runDurableCoordinatorOperation(() =>
      replayShadowIntoTally(stateToReplay, () =>
        coordinatorContextIsCurrent(context),
      ),
    );
  } catch (error) {
    shadow = null;
    activeAccountId = null;
    throw error;
  } finally {
    commandCommitInProgress = false;
  }
  if (!coordinatorContextIsCurrent(context) || !shadow) return;
  shadow = {
    ...shadow,
    state: materializeStateWithSemanticRevision(shadow.state),
  };
  await persistShadow(shadow);
  if (!coordinatorContextIsCurrent(context)) return;
  await requestSync();
  if (!coordinatorContextIsCurrent(context)) return;
  await processPendingCommands();
}

/**
 * Installs the phone side of the watch protocol once. Native delivery only wakes
 * this coordinator; a command is acknowledged after its local fact, backend
 * queue operation, reducer state and outgoing snapshot are all durable.
 */
export async function initializeMobileWearableSync(): Promise<void> {
  if (installed) {
    await enqueueSerial(activateCurrentAccount);
    return;
  }
  if (installationPromise) {
    await installationPromise;
    return;
  }

  const attempt = (async () => {
    await waitForHydration();
    if (installed) return;
    installed = true;

    addWearableCommandListener(() => {
      void enqueueSerial(processPendingCommands);
    });
    useTallyStore.subscribe((state, previous) => {
      if (
        state.current !== previous.current ||
        state.history !== previous.history ||
        state.removedDrinkIds !== previous.removedDrinkIds
      ) {
        schedulePublish();
      }
    });
    useWearableTargetStore.subscribe((state, previous) => {
      if (
        state.manualTarget !== previous.manualTarget ||
        state.nearestTarget !== previous.nearestTarget ||
        state.nearbyPubs !== previous.nearbyPubs ||
        state.menuDrinks !== previous.menuDrinks
      ) {
        schedulePublish();
      }
    });
    useAccountStore.subscribe((state, previous) => {
      const accountChanged =
        state.session?.accountId !== previous.session?.accountId;
      const suspendedSessionReplaced =
        getMobileWearableSyncBoundary().suspended &&
        state.session !== previous.session;
      if (accountChanged || suspendedSessionReplaced) {
        // Detach synchronously so a native wake-up in the same JS turn cannot use
        // the outgoing account while the replacement shadow is being loaded.
        shadow = null;
        activeAccountId = null;
        void enqueueSerial(() =>
          activateCurrentAccount({ resumeBoundary: true }),
        );
      }
    });
    AppState.addEventListener('change', (state) => {
      if (state === 'active') void enqueueSerial(activateCurrentAccount);
    });
    setInterval(() => {
      if (AppState.currentState === 'active') {
        void enqueueSerial(processPendingCommands);
      }
    }, BACKGROUND_POLL_MS);

    await enqueueSerial(activateCurrentAccount);
  })();
  installationPromise = attempt;
  try {
    await attempt;
  } finally {
    if (installationPromise === attempt) installationPromise = null;
  }
}
