import { useAccountStore } from '@/stores/accountStore';
import { usePubAmenitiesStore } from '@/stores/pubAmenitiesStore';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';

import { PrivateAccountMutationFrozenError } from './privateAccountBoundary';
import { restorePubAmenities } from './pubAmenitiesSync';
import { restorePubRatings } from './pubRatingsSync';

function ignoreExpectedFreeze(error: unknown): void {
  if (!(error instanceof PrivateAccountMutationFrozenError)) throw error;
}

function activePrivateAccountId(): string | null {
  const state = useAccountStore.getState();
  if (!state.startupBoundaryReady) return null;
  return state.session?.accountId ?? null;
}

function privateSessionChanged(
  current: ReturnType<typeof useAccountStore.getState>,
  previous: ReturnType<typeof useAccountStore.getState>
): boolean {
  if (!current.startupBoundaryReady) return false;
  const session = current.session;
  if (!session) return false;
  const previousSession = previous.startupBoundaryReady ? previous.session : null;
  return (
    session.accountId !== previousSession?.accountId || session.token !== previousSession?.token
  );
}

type PersistHydration = {
  hasHydrated: () => boolean;
  onFinishHydration: (listener: () => void) => () => void;
};

function waitForHydration(persist: PersistHydration): Promise<void> {
  if (persist.hasHydrated()) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve();
    };
    const unsubscribe = persist.onFinishHydration(finish);
    // Hydration can finish between the first check and listener registration.
    if (persist.hasHydrated()) finish();
  });
}

async function waitForPrivatePubStores(): Promise<void> {
  await Promise.all([
    waitForHydration(usePubRatingsStore.persist),
    waitForHydration(usePubAmenitiesStore.persist),
  ]);
}

/**
 * Pull account-scoped pub data on launch and every account replacement.
 * Auth publishes B into accountStore only after the boundary has thawed and
 * private Zustand stores have rehydrated, so this subscription is also the
 * safe post-transition retry. Running directly on thaw would pull B too early
 * and let the following persisted rehydrate overwrite it.
 */
export function installPrivatePubDataRestores(): () => void {
  let installed = true;
  let restoreGeneration = 0;

  const restoreCurrentAccount = (accountId: string | null, generation: number): void => {
    if (!accountId) return;
    const restore = () => {
      // A slow launch rehydrate must never let account A's pull land after B
      // was published, let an old bearer retry after same-account re-auth, nor
      // let a disposed coordinator perform network work. The generation keeps
      // the bearer itself out of this coordinator's delayed closures and logs.
      if (!installed || generation !== restoreGeneration || activePrivateAccountId() !== accountId)
        return;
      void restorePubRatings().catch(ignoreExpectedFreeze);
      void restorePubAmenities().catch(ignoreExpectedFreeze);
    };
    if (usePubRatingsStore.persist.hasHydrated() && usePubAmenitiesStore.persist.hasHydrated()) {
      restore();
      return;
    }
    void waitForPrivatePubStores().then(restore);
  };

  const unsubscribeAccount = useAccountStore.subscribe((state, previous) => {
    const accountId = state.startupBoundaryReady ? state.session?.accountId ?? null : null;
    if (accountId && privateSessionChanged(state, previous)) {
      restoreGeneration += 1;
      restoreCurrentAccount(accountId, restoreGeneration);
    }
  });
  const initialAccountId = activePrivateAccountId();
  if (initialAccountId) {
    restoreGeneration += 1;
    restoreCurrentAccount(initialAccountId, restoreGeneration);
  }
  return () => {
    installed = false;
    restoreGeneration += 1;
    unsubscribeAccount();
  };
}
