import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearAddedPubsQueue } from './addedPubsQueue';
import { clearCommunityQueue } from './communityQueue';
import { clearDeleteDrinksQueue } from './deleteDrinksQueue';
import { clearDrinksQueue } from './drinksQueue';
import { clearUpdateDrinksQueue } from './updateDrinksQueue';
import { clearFeedbackQueue } from './feedbackQueue';
import { clearPubNameCorrectionsQueue } from './pubNameCorrectionsQueue';
import { clearPubReportQueue } from './pubReportQueue';
import { clearPubAmenitiesQueue } from './pubAmenitiesQueue';
import { runWithoutPubAmenitiesSync } from './pubAmenitiesSync';
import { clearPubRatingsQueue } from './pubRatingsQueue';
import { runWithoutPubRatingsSync } from './pubRatingsSync';
import { clearVisitsQueue } from './visitsQueue';
import { useCommunityStore } from '@/stores/communityStore';
import { usePubAmenitiesStore } from '@/stores/pubAmenitiesStore';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { usePubStore } from '@/stores/pubStore';
import { useTallyStore } from '@/stores/tallyStore';

const PRIVATE_STORAGE_KEYS = [
  'na-pivo-tally',
  'na-pivo-pub-ratings',
  'na-pivo-pub-amenities',
  'na-pivo-visits-seeded',
  'na-pivo-community',
  'na-pivo-pub',
];

/**
 * Remove device-local private account data without contacting the backend.
 *
 * Logout/delete account rotates the app to a fresh anonymous account. Any
 * leftover drinks, visits, ratings, or queued private sync operations would then
 * be visible locally or could upload under the wrong account, so they must be
 * cleared before the session boundary moves.
 */
export async function clearLocalPrivateAccountData(): Promise<void> {
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
  usePubStore.setState({
    revealedPub: null,
    reportedPubIds: [],
    reportedCacheKeys: [],
  });

  await Promise.all([
    clearAddedPubsQueue(),
    clearCommunityQueue(),
    clearDrinksQueue(),
    clearDeleteDrinksQueue(),
    clearUpdateDrinksQueue(),
    clearFeedbackQueue(),
    clearPubNameCorrectionsQueue(),
    clearPubReportQueue(),
    clearVisitsQueue(),
    clearPubRatingsQueue(),
    clearPubAmenitiesQueue(),
  ]);
  await Promise.all(PRIVATE_STORAGE_KEYS.map((key) => AsyncStorage.removeItem(key)));
}
