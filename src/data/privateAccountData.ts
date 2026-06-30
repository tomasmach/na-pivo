import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearDeleteDrinksQueue } from './deleteDrinksQueue';
import { clearDrinksQueue } from './drinksQueue';
import { clearUpdateDrinksQueue } from './updateDrinksQueue';
import { clearFeedbackQueue } from './feedbackQueue';
import { clearPubAmenitiesQueue } from './pubAmenitiesQueue';
import { runWithoutPubAmenitiesSync } from './pubAmenitiesSync';
import { clearPubRatingsQueue } from './pubRatingsQueue';
import { runWithoutPubRatingsSync } from './pubRatingsSync';
import { clearVisitsQueue } from './visitsQueue';
import { usePubAmenitiesStore } from '@/stores/pubAmenitiesStore';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { useTallyStore } from '@/stores/tallyStore';

const PRIVATE_STORAGE_KEYS = [
  'na-pivo-tally',
  'na-pivo-pub-ratings',
  'na-pivo-pub-amenities',
  'na-pivo-visits-seeded',
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

  await Promise.all([
    clearDrinksQueue(),
    clearDeleteDrinksQueue(),
    clearUpdateDrinksQueue(),
    clearFeedbackQueue(),
    clearVisitsQueue(),
    clearPubRatingsQueue(),
    clearPubAmenitiesQueue(),
    ...PRIVATE_STORAGE_KEYS.map((key) => AsyncStorage.removeItem(key)),
  ]);
}
