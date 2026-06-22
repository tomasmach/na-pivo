import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearDeleteDrinksQueue } from './deleteDrinksQueue';
import { clearDrinksQueue } from './drinksQueue';
import { clearUpdateDrinksQueue } from './updateDrinksQueue';
import { clearPubRatingsQueue } from './pubRatingsQueue';
import { runWithoutPubRatingsSync } from './pubRatingsSync';
import { clearVisitsQueue } from './visitsQueue';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { useTallyStore } from '@/stores/tallyStore';

const PRIVATE_STORAGE_KEYS = [
  'na-pivo-tally',
  'na-pivo-pub-ratings',
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

  await Promise.all([
    clearDrinksQueue(),
    clearDeleteDrinksQueue(),
    clearUpdateDrinksQueue(),
    clearVisitsQueue(),
    clearPubRatingsQueue(),
    ...PRIVATE_STORAGE_KEYS.map((key) => AsyncStorage.removeItem(key)),
  ]);
}
