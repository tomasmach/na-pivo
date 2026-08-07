import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AccountSession } from './account';
import { suppressPrivatePersistenceDuringMemoryReset } from './privateAccountStorage';

import { clearAddedPubsQueue } from './addedPubsQueue';
import {
  ACCOUNT_PREFERENCES_QUEUE_STORAGE_KEY,
  clearAccountPreferencesQueue,
} from './accountPreferencesQueue';
import { clearBeerPhotoLocalFiles, clearBeerPhotosQueue } from './beerPhotosQueue';
import { clearCommunityQueue } from './communityQueue';
import { clearDeleteDrinksQueue } from './deleteDrinksQueue';
import { clearDrinksQueue } from './drinksQueue';
import {
  cancelDrinksHistorySeed,
  DRINKS_HISTORY_PROGRESS_KEY,
  DRINKS_HISTORY_SEEDED_KEY,
} from './drinksHistorySync';
import { clearUpdateDrinksQueue } from './updateDrinksQueue';
import { clearBeerCheckinsQueue } from './beerCheckinsQueue';
import { clearFeedbackQueue } from './feedbackQueue';
import { clearFriendsQueue } from './friendsQueue';
import { clearFriendsDashboardSnapshot } from './friendsSnapshot';
import { clearLeaderboardsCache } from './leaderboardsClient';
import { clearNightsQueue } from './nightsQueue';
import { clearPhotoContestCache } from './photoContestClient';
import { clearPartyGamesQueue } from './partyGamesQueue';
import { clearPartyGameStartsQueue } from './partyGameStartsQueue';
import {
  clearPartyEveningActionsQueue,
  PARTY_EVENING_ACTIONS_STORAGE_KEY,
} from './partyEveningActionsQueue';
import {
  clearPartyEveningIdentityCache,
  PARTY_EVENING_IDENTITY_STORAGE_KEY,
} from './partyEveningIdentityCache';
import { clearPubNameCorrectionsQueue } from './pubNameCorrectionsQueue';
import { clearPubReportQueue } from './pubReportQueue';
import { clearPubAmenitiesQueue } from './pubAmenitiesQueue';
import { runWithoutPubAmenitiesSync } from './pubAmenitiesSync';
import { clearPubRatingsQueue } from './pubRatingsQueue';
import { runWithoutPubRatingsSync } from './pubRatingsSync';
import { clearVisitsQueue } from './visitsQueue';
import { clearVisitsSnapshot } from './visitsSnapshot';
import { clearNightFeedCaches } from '@/feed/feedCache';
import {
  clearBeerPhotosAccountData,
  useBeerPhotosStore,
} from '@/stores/beerPhotosStore';
import { useCommunityStore } from '@/stores/communityStore';
import { usePartyGroupsStore } from '@/stores/partyGroupsStore';
import { usePubAmenitiesStore } from '@/stores/pubAmenitiesStore';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { usePubStore } from '@/stores/pubStore';
import { useTallyStore } from '@/stores/tallyStore';
import { useVycepStore } from '@/stores/vycepStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePartaSignalStore } from '@/stores/partaSignalStore';
import { useLivePartyStore } from '@/mocks/livePartyStore';
import { clearNightRecordCache, NIGHT_RECORD_STORAGE_KEY } from '@/party/nightRecordCache';
import {
  clearContestResultsAccountData,
  CONTEST_RESULTS_STORAGE_KEY,
  useContestResultsStore,
} from '@/stores/contestResultsStore';
import {
  clearPartyEveningState,
} from '@/stores/partyEveningStore';
import { usePartyGamesStore } from '@/stores/partyGamesStore';
import { clearLiveBeerActivityForAccountBoundary } from '@/liveActivity/liveBeerActivity';
import { clearBeerCountReminderForAccountBoundary } from '@/notifications/beerCountReminder';

async function clearPubReminderAccountDataLazy(): Promise<boolean> {
  // Pub reminders own expo-location/task-manager at module scope. Loading that
  // native surface only when strict cleanup actually runs keeps generic auth
  // and live-activity startup usable in runtimes where those modules are absent.
  const { clearPubReminderAccountData } = await import(
    '@/notifications/pubReminderNotifications'
  );
  return clearPubReminderAccountData();
}

/**
 * Every fixed AsyncStorage key touched by the private-store invalidations
 * below. Keep this explicit: the strict final pass removes and reads back each
 * key after helper writes have settled, so a swallowed adapter error cannot be
 * mistaken for a completed account boundary.
 */
export const PRIVATE_STORAGE_KEYS = [
  'na-pivo-tally',
  'na-pivo-pub-ratings',
  'na-pivo-pub-amenities',
  'na-pivo-visits-seeded',
  DRINKS_HISTORY_SEEDED_KEY,
  DRINKS_HISTORY_PROGRESS_KEY,
  'na-pivo-drinks-queue',
  'na-pivo-delete-drinks-queue',
  'na-pivo-update-drinks-queue',
  'na-pivo-beer-checkins-queue',
  'na-pivo-beer-photos-queue',
  'na-pivo-feedback-queue',
  ACCOUNT_PREFERENCES_QUEUE_STORAGE_KEY,
  'na-pivo-community',
  'na-pivo-community-queue',
  'na-pivo-pub',
  'na-pivo-added-pubs-queue',
  'na-pivo-pub-name-corrections-queue',
  'na-pivo-pub-report-queue',
  'na-pivo-visits-queue',
  'na-pivo-visits-map-snapshot',
  'na-pivo-friends-queue',
  'na-pivo-friends-dashboard',
  'na-pivo-nights-queue',
  'na-pivo-pub-ratings-queue',
  'na-pivo-pub-amenities-queue',
  'na-pivo-party-groups',
  'na-pivo-party-games-queue',
  'na-pivo-party-games-queue-quarantine-v1',
  'na-pivo-party-game-starts-queue-quarantine-v1',
  'na-pivo-party-game-starts-queue',
  PARTY_EVENING_ACTIONS_STORAGE_KEY,
  PARTY_EVENING_IDENTITY_STORAGE_KEY,
  'na-pivo-live-party',
  NIGHT_RECORD_STORAGE_KEY,
  CONTEST_RESULTS_STORAGE_KEY,
  'na-pivo-beer-photos',
  'na-pivo-vycep',
  // Recent pub, beer, and people searches belong to the outgoing account too.
  'na-pivo-search-recent-v1',
  'na-pivo-pending-invite-code',
  'na-pivo-beer-count-reminder-state',
  'na-pivo-pub-reminder-state',
  'na-pivo-pub-reminder-geofences',
  // Note: the Parta social-graph snapshot ('na-pivo-friends-dashboard') is cleared
  // via clearFriendsDashboardSnapshot() below — that path also bumps the snapshot
  // generation so an in-flight dashboard fetch can't re-persist it after the clear.
] as const;

const PRIVATE_STORAGE_PREFIXES = ['na-pivo-night-feed-v1:'] as const;

const SETTINGS_STORAGE_KEY = 'na-pivo-settings';

const PRIVATE_SETTINGS_DEFAULTS = {
  homePoint: null,
  marketingEmailsEnabled: false,
  lastSeenPartyStreak: 0,
  pendingAccountPreferences: {},
  pendingAccountPreferencesOwnerId: null,
} as const;

async function clearPersistedPrivateSettings(): Promise<void> {
  useSettingsStore.setState(PRIVATE_SETTINGS_DEFAULTS);
  const raw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) return;

  try {
    const persisted = JSON.parse(raw) as {
      state?: {
        homePoint?: unknown;
        marketingEmailsEnabled?: unknown;
        lastSeenPartyStreak?: unknown;
        pendingAccountPreferences?: unknown;
        pendingAccountPreferencesOwnerId?: unknown;
      };
    };
    if (!persisted.state || typeof persisted.state !== 'object') return;
    Object.assign(persisted.state, PRIVATE_SETTINGS_DEFAULTS);
    await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // A malformed settings payload cannot be trusted not to contain the old
    // location. Removing it is safer than carrying it across accounts.
    await AsyncStorage.removeItem(SETTINGS_STORAGE_KEY);
  }
}

export type PrivateAccountDataClearResult =
  | { ok: true }
  | { ok: false; code: 'storage'; failedOperations: string[] };

interface ClearTaskResult {
  ok: boolean;
  operation: string;
}

function startClearTask(operation: string, action: () => unknown): Promise<ClearTaskResult> {
  try {
    return Promise.resolve(action()).then(
      (value) => ({ ok: value !== false, operation }),
      () => ({ ok: false, operation }),
    );
  } catch {
    return Promise.resolve({ ok: false, operation });
  }
}

async function strictlyRemoveAndVerify(key: string): Promise<boolean> {
  try {
    await AsyncStorage.removeItem(key);
    return (await AsyncStorage.getItem(key)) === null;
  } catch {
    return false;
  }
}

async function persistedPrivateSettingsAreClear(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw === null) return true;
    const persisted = JSON.parse(raw) as {
      state?: {
        homePoint?: unknown;
        marketingEmailsEnabled?: unknown;
        lastSeenPartyStreak?: unknown;
        pendingAccountPreferences?: unknown;
        pendingAccountPreferencesOwnerId?: unknown;
      };
    };
    return !persisted.state || (
      persisted.state.homePoint == null &&
      persisted.state.marketingEmailsEnabled !== true &&
      persisted.state.lastSeenPartyStreak === 0 &&
      !!persisted.state.pendingAccountPreferences &&
      typeof persisted.state.pendingAccountPreferences === 'object' &&
      !Array.isArray(persisted.state.pendingAccountPreferences) &&
      Object.keys(persisted.state.pendingAccountPreferences).length === 0 &&
      persisted.state.pendingAccountPreferencesOwnerId == null
    );
  } catch {
    return false;
  }
}

/** Final synchronous pass: no stale hydration/action can outlive strict clear. */
export function resetPrivateAccountMemory(): void {
  suppressPrivatePersistenceDuringMemoryReset(() => {
    cancelDrinksHistorySeed();
    clearPartyEveningState();
    usePartyGamesStore.getState().disconnect();
    useLivePartyStore.setState({
      live: false,
      pubName: '',
      houseBeer: 'Pivo',
      pubTaps: [],
      pubKey: null,
      pubVisits: [],
      pickingPub: false,
      startedAt: null,
      games: [],
    });
    useTallyStore.setState({ current: null, history: [] });
    usePubRatingsStore.setState({ ratings: {} });
    usePubAmenitiesStore.setState({ votes: {} });
    useCommunityStore.setState({ overrides: {} });
    usePartyGroupsStore.setState({ groups: [] });
    useVycepStore.setState({ published: {} });
    usePubStore.setState({
      revealedPub: null,
      reportedPubIds: [],
      reportedCacheKeys: [],
    });
    useBeerPhotosStore.setState({ photos: [] });
    useContestResultsStore.setState({
      viewerAccountId: null,
      lastSeenResultsContestId: null,
      pendingResult: null,
    });
    useSettingsStore.setState(PRIVATE_SETTINGS_DEFAULTS);
    usePartaSignalStore.setState({
      pendingRequests: 0,
      unread: 0,
      liveNow: false,
      pendingRefresh: false,
      focusTarget: null,
    });
  });
}

/** Reload private persisted stores only after the exact boundary is released. */
export async function rehydratePrivateStoresAfterBoundary(): Promise<boolean> {
  try {
    await Promise.all([
      useTallyStore.persist.rehydrate(),
      usePubRatingsStore.persist.rehydrate(),
      usePubAmenitiesStore.persist.rehydrate(),
      useCommunityStore.persist.rehydrate(),
      usePubStore.persist.rehydrate(),
      usePartyGroupsStore.persist.rehydrate(),
      useLivePartyStore.persist.rehydrate(),
      useContestResultsStore.persist.rehydrate(),
      useBeerPhotosStore.persist.rehydrate(),
      useVycepStore.persist.rehydrate(),
      useSettingsStore.persist.rehydrate(),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove device-local private account data without contacting the backend.
 *
 * Logout/delete account rotates the app to a fresh anonymous account. Any
 * leftover drinks, visits, ratings, or queued private sync operations would then
 * be visible locally or could upload under the wrong account, so they must be
 * cleared before the session boundary moves.
 */
export async function clearLocalPrivateAccountData(options?: {
  /** Captured owner whose credential remains installed until this succeeds. */
  outgoingSession?: AccountSession | null;
}): Promise<PrivateAccountDataClearResult> {
  const tasks: Promise<ClearTaskResult>[] = [];
  const start = (operation: string, action: () => unknown) => {
    tasks.push(startClearTask(operation, action));
  };

  // Start every synchronous invalidation before yielding. Each action is
  // isolated so one broken adapter cannot stop the remaining private stores
  // from invalidating. The caller keeps A's credential installed until the
  // discriminated result confirms the durable pass below.
  start('cancel_drinks_history_seed', () => cancelDrinksHistorySeed());
  start('beer_photos_store', () =>
    clearBeerPhotosAccountData(
      Object.prototype.hasOwnProperty.call(options ?? {}, 'outgoingSession')
        ? { outgoingSession: options?.outgoingSession ?? null }
        : undefined,
    ),
  );
  start('beer_photos_queue', () => clearBeerPhotosQueue());
  start('leaderboards_cache', () => clearLeaderboardsCache());
  start('photo_contest_cache', () => clearPhotoContestCache());
  start('contest_results', () => clearContestResultsAccountData());
  start('live_beer_activity', () => clearLiveBeerActivityForAccountBoundary());
  start('beer_count_reminder', () => clearBeerCountReminderForAccountBoundary());
  start('pub_reminder', () => clearPubReminderAccountDataLazy());
  start('night_record_cache', () => clearNightRecordCache());
  start('party_evening_state', () => clearPartyEveningState());
  start('party_games_socket', () => usePartyGamesStore.getState().disconnect());
  start('live_party_state', () => useLivePartyStore.getState().end());
  start('tally_state', () => useTallyStore.setState({ current: null, history: [] }));
  start('pub_ratings_state', () =>
    runWithoutPubRatingsSync(() => {
      usePubRatingsStore.setState({ ratings: {} });
    }),
  );
  start('pub_amenities_state', () =>
    runWithoutPubAmenitiesSync(() => {
      usePubAmenitiesStore.setState({ votes: {} });
    }),
  );
  start('community_state', () => useCommunityStore.setState({ overrides: {} }));
  start('beer_photo_files', () => clearBeerPhotoLocalFiles());
  start('party_groups_state', () => usePartyGroupsStore.setState({ groups: [] }));
  start('vycep_state', () => useVycepStore.setState({ published: {} }));
  start('pub_state', () =>
    usePubStore.setState({
      revealedPub: null,
      reportedPubIds: [],
      reportedCacheKeys: [],
    }),
  );

  for (const clearQueue of [
    clearAddedPubsQueue,
    clearCommunityQueue,
    clearDrinksQueue,
    clearDeleteDrinksQueue,
    clearUpdateDrinksQueue,
    clearBeerCheckinsQueue,
    clearFeedbackQueue,
    clearAccountPreferencesQueue,
    clearPubNameCorrectionsQueue,
    clearPubReportQueue,
    clearVisitsQueue,
    clearVisitsSnapshot,
    clearFriendsQueue,
    clearFriendsDashboardSnapshot,
    clearNightFeedCaches,
    clearNightsQueue,
    clearPartyGamesQueue,
    clearPartyGameStartsQueue,
    clearPartyEveningActionsQueue,
    clearPartyEveningIdentityCache,
    clearPubRatingsQueue,
    clearPubAmenitiesQueue,
  ]) {
    start(clearQueue.name || 'private_queue', () => clearQueue());
  }
  start('settings_private_fields', () => clearPersistedPrivateSettings());

  const helperResults = await Promise.all(tasks);
  const failedOperations = helperResults
    .filter((result) => !result.ok)
    .map((result) => result.operation);

  // Queue clear implementations may persist `[]`; remove their backing keys
  // only after those writes settle so a late helper write cannot recreate
  // private storage behind the account boundary.
  let dynamicKeys: string[] = [];
  try {
    dynamicKeys = (await AsyncStorage.getAllKeys()).filter((key) =>
      PRIVATE_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );
  } catch {
    failedOperations.push('discover_dynamic_storage');
  }

  const fixedAndDynamicKeys = [...new Set<string>([
    ...PRIVATE_STORAGE_KEYS,
    ...dynamicKeys,
  ])];
  const removalResults = await Promise.all(
    fixedAndDynamicKeys.map(async (key) => ({
      key,
      ok: await strictlyRemoveAndVerify(key),
    })),
  );
  failedOperations.push(
    ...removalResults
      .filter((result) => !result.ok)
      .map((result) => `remove:${result.key}`),
  );

  if (!(await persistedPrivateSettingsAreClear())) {
    failedOperations.push('verify_settings_private_fields');
  }

  // A protected read/action may have resolved immediately before the freeze
  // and applied on a later microtask. This pass is intentionally the final
  // synchronous operation before the caller is allowed to release the boundary.
  resetPrivateAccountMemory();

  return failedOperations.length === 0
    ? { ok: true }
    : { ok: false, code: 'storage', failedOperations: [...new Set(failedOperations)] };
}

/** Best-effort adapter for callers that do not move an account credential. */
export async function clearLocalPrivateAccountDataBestEffort(options?: {
  outgoingSession?: AccountSession | null;
}): Promise<void> {
  await clearLocalPrivateAccountData(options);
}
