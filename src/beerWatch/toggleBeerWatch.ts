import { t } from '@/i18n';
import { requestPushRegistration } from '@/notifications/friendPush';
import { findBeerWatch, useBeerWatchStore } from '@/stores/beerWatchStore';
import { useToastStore } from '@/stores/toastStore';

import { syncBeerWatchLocation } from './beerWatchLocation';

let inFlight = false;

/**
 * Watch or stop watching a beer from any button, with the outcome as a toast.
 * The first watch asks for notifications (only when not decided yet) and sends
 * the rounded location; a denied permission still keeps the watch.
 */
export async function toggleBeerWatch(beerName: string, breweryName?: string | null): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  const toast = useToastStore.getState().show;
  try {
    const store = useBeerWatchStore.getState();
    const existing = findBeerWatch(store.watches, beerName);
    if (existing) {
      const ok = await store.unwatch(existing.productKey);
      toast(ok ? t.beerWatch.unwatchedToast : t.beerWatch.failedToast);
      return;
    }
    const result = await store.watch(beerName, breweryName);
    if (!result.ok) {
      toast(
        result.reason === 'unknown_beer'
          ? t.beerWatch.unknownBeerToast
          : result.reason === 'too_many'
            ? t.beerWatch.tooManyToast
            : t.beerWatch.failedToast,
      );
      return;
    }
    toast(t.beerWatch.watchedToast);
    void syncBeerWatchLocation();
    await requestPushRegistration();
  } finally {
    inFlight = false;
  }
}
