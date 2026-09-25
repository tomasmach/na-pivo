import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearToursPrivateData } from '@/stores/toursStore';

import { clearAddedPubsQueue } from './addedPubsQueue';
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
import { resetForegroundPulls } from './foregroundPulls';
import { clearNightsQueue } from './nightsQueue';
import { clearPubNameCorrectionsQueue } from './pubNameCorrectionsQueue';
import { clearPubReportQueue } from './pubReportQueue';
import { clearPubAmenitiesQueue } from './pubAmenitiesQueue';
import { runWithoutPubAmenitiesSync } from './pubAmenitiesSync';
import { clearPubRatingsQueue } from './pubRatingsQueue';
import { runWithoutPubRatingsSync } from './pubRatingsSync';
import { clearVisitsQueue } from './visitsQueue';
import { clearVisitsSnapshot } from './visitsSnapshot';
import { useBeerPhotosStore } from '@/stores/beerPhotosStore';
import { useCommunityStore } from '@/stores/communityStore';
import { usePartyGroupsStore } from '@/stores/partyGroupsStore';
import { usePubAmenitiesStore } from '@/stores/pubAmenitiesStore';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { usePubStore } from '@/stores/pubStore';
import { useTallyStore } from '@/stores/tallyStore';
import { useVycepStore } from '@/stores/vycepStore';
import { useSettingsStore } from '@/stores/settingsStore';

const PRIVATE_STORAGE_KEYS = [
  'na-pivo-tally',
  'na-pivo-pub-ratings',
  'na-pivo-pub-amenities',
  'na-pivo-visits-seeded',
  DRINKS_HISTORY_SEEDED_KEY,
  DRINKS_HISTORY_PROGRESS_KEY,
  'na-pivo-community',
  'na-pivo-pub',
  'na-pivo-added-pubs-queue',
  'na-pivo-party-groups',
  'na-pivo-beer-photos',
  'na-pivo-vycep',
  // Retired 2.0 features can still have private data after an app update.
  // Keep their cleanup contract even though their UI and queues were removed.
  'na-pivo-account-preferences-queue',
  'na-pivo-party-games-queue',
  'na-pivo-party-games-queue-quarantine-v1',
  'na-pivo-party-game-starts-queue',
  'na-pivo-party-game-starts-queue-quarantine-v1',
  'na-pivo-party-evening-actions-queue',
  'na-pivo-party-evening-identity-v1',
  'na-pivo-party-games-account-merge',
  'na-pivo-private-account-merge-v0',
  'na-pivo-live-party',
  'na-pivo-party-night-records-v1',
  'na-pivo-contest-results',
  'na-pivo-search-recent-v1',
  'na-pivo-pending-invite-code',
  'na-pivo-beer-checkin-action-tickets',
  'na-pivo-beer-photo-deletion-tombstones',
  'na-pivo-counter-telemetry',
  'na-pivo-account-deletion-intent-v2',
  'na-pivo-account-deletion-intent-quarantine-v1',
  'na-pivo-account-deletion-intent-quarantine-backup-v1',
  'na-pivo-account-deletion-intent-quarantine-recovered-v1',
  'na-pivo-beer-count-reminder-state',
  'na-pivo-pub-reminder-state',
  'na-pivo-pub-reminder-geofences',
  'na-pivo-handled-notification-responses-v1',
  // Note: the Parta social-graph snapshot ('na-pivo-friends-dashboard') is cleared
  // via clearFriendsDashboardSnapshot() below — that path also bumps the snapshot
  // generation so an in-flight dashboard fetch can't re-persist it after the clear.
];

const PRIVATE_STORAGE_PREFIXES = ['na-pivo-night-feed-v1:'];
const SETTINGS_STORAGE_KEY = 'na-pivo-settings';
const PRIVATE_SETTINGS_DEFAULTS = {
  homePoint: null,
  marketingEmailsEnabled: false,
  lastSeenPartyStreak: 0,
  pendingAccountPreferences: {},
  pendingAccountPreferencesOwnerId: null,
};

async function clearPersistedPrivateSettings(): Promise<void> {
  useSettingsStore.setState(PRIVATE_SETTINGS_DEFAULTS);
  const raw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) return;

  try {
    const persisted = JSON.parse(raw) as { state?: { homePoint?: unknown } };
    if (!persisted.state || typeof persisted.state !== 'object') return;
    Object.assign(persisted.state, PRIVATE_SETTINGS_DEFAULTS);
    await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // A malformed settings payload cannot be trusted not to contain the old
    // location. Removing it is safer than carrying it across accounts.
    await AsyncStorage.removeItem(SETTINGS_STORAGE_KEY);
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
export async function clearLocalPrivateAccountData(): Promise<void> {
  // Invalidate a captured pre-logout history snapshot before any async queue
  // clear can yield, so it cannot be enqueued under the replacement account.
  cancelDrinksHistorySeed();
  const toursCleanup = clearToursPrivateData();
  // The wiped ratings, votes and own pubs must come back on the next foreground
  // even when the same account signs in again within the pull interval.
  resetForegroundPulls();
  useTallyStore.setState({ current: null, history: [] });
  runWithoutPubRatingsSync(() => {
    usePubRatingsStore.setState({ ratings: {} });
  });
  // Community amenity votes are location-adjacent private data — wipe them under
  // the suppress flag so the reset is not echoed out as server deletes.
  runWithoutPubAmenitiesSync(() => {
    usePubAmenitiesStore.setState({ votes: {} });
  });
  useCommunityStore.setState({ overrides: {} });
  // Photo diary is private data: wipe the store, the durable local JPEGs, and
  // (below) the pending-upload queue before the session boundary moves.
  useBeerPhotosStore.setState({ photos: [] });
  clearBeerPhotoLocalFiles();
  usePartyGroupsStore.setState({ groups: [] });
  // Výčep publication ledger is tied to the outgoing account's nights.
  useVycepStore.setState({ published: {} });
  usePubStore.setState({
    revealedPub: null,
    reportedPubIds: [],
    reportedCacheKeys: [],
  });

  await Promise.all([
    toursCleanup,
    clearAddedPubsQueue(),
    clearCommunityQueue(),
    clearDrinksQueue(),
    clearDeleteDrinksQueue(),
    clearUpdateDrinksQueue(),
    clearBeerCheckinsQueue(),
    clearFeedbackQueue(),
    clearPubNameCorrectionsQueue(),
    clearPubReportQueue(),
    clearVisitsQueue(),
    clearBeerPhotosQueue(),
    clearVisitsSnapshot(),
    clearFriendsQueue(),
    clearFriendsDashboardSnapshot(),
    clearNightsQueue(),
    clearPubRatingsQueue(),
    clearPubAmenitiesQueue(),
  ]);
  const keys = await AsyncStorage.getAllKeys();
  const privateKeys = new Set([
    ...PRIVATE_STORAGE_KEYS,
    ...keys.filter((key) => PRIVATE_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))),
  ]);
  await Promise.all([...privateKeys].map((key) => AsyncStorage.removeItem(key)));
  await clearPersistedPrivateSettings();
}
