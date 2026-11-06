import AsyncStorage from '@react-native-async-storage/async-storage';

import { useVycepStore } from '@/stores/vycepStore';

export const PUBLIC_NIGHTS_ASK_SEEN_KEY = 'na-pivo-public-nights-ask-seen';

function vycepHydrated(): Promise<void> {
  if (useVycepStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useVycepStore.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

/** Once per install, and never to someone who already shares everything with the world. */
export async function shouldAskPublicNights(): Promise<boolean> {
  try {
    if (await AsyncStorage.getItem(PUBLIC_NIGHTS_ASK_SEEN_KEY)) return false;
    await vycepHydrated();
    const { nightAutopublish, shareDefault } = useVycepStore.getState();
    return !(nightAutopublish === 'public' && shareDefault === 'public');
  } catch {
    return false;
  }
}

export async function markPublicNightsAsked(): Promise<void> {
  try {
    await AsyncStorage.setItem(PUBLIC_NIGHTS_ASK_SEEN_KEY, '1');
  } catch {
    // A failed write may ask once more next launch.
  }
}
