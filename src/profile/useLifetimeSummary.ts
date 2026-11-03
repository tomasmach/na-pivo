import { useMemo } from 'react';

import { deriveReconciledDiaryStats } from '@/data/diarySync';
import { isContextPubKey, normalizeDrinkType } from '@/drinks/drinkTypes';
import { earliestTimestamp } from '@/profile/dailyBeerAverage';
import { useMyStats } from '@/stats/useMyStats';
import { selectIsSignedIn, useAccountStore } from '@/stores/accountStore';
import {
  allSessionsNewestFirst,
  sessionCount,
  sessionTotalCzk,
  useTallyStore,
} from '@/stores/tallyStore';

/**
 * Lifetime beers, pubs, evenings and spend for the profile. Local sessions are
 * the floor; the server knows evenings this phone never had, so its numbers win
 * once they are larger, as in Deník.
 */
export function useLifetimeSummary(opened: boolean) {
  const isSignedIn = useAccountStore(selectIsSignedIn);
  const profile = useAccountStore((state) => state.profile);
  const diarySnapshot = useAccountStore((state) => {
    const snapshot = state.diarySnapshot;
    if (!snapshot || snapshot.accountId !== state.session?.accountId) return null;
    return snapshot.data;
  });
  const current = useTallyStore((state) => state.current);
  const history = useTallyStore((state) => state.history);
  const remoteStats = useMyStats(opened);

  const sessions = useMemo(() => allSessionsNewestFirst(current, history), [current, history]);
  const localBeers = useMemo(
    () => sessions.reduce((total, session) => total + sessionCount(session), 0),
    [sessions],
  );
  const reconciledStats = useMemo(
    () => (diarySnapshot ? deriveReconciledDiaryStats(diarySnapshot, sessions) : null),
    [diarySnapshot, sessions],
  );
  let beers = localBeers;
  if (isSignedIn && reconciledStats) {
    beers = reconciledStats.totalBeers;
  } else if (isSignedIn && profile?.stats) {
    beers = Math.max(profile.stats.totalBeers, localBeers);
  }

  const lifetime = useMemo(() => {
    const evenings = sessions.filter((session) => session.drinks.length > 0).length;
    const localPubs = new Set(
      sessions
        .filter((session) => session.drinks.length > 0 && !isContextPubKey(session.pubKey))
        .map((session) => session.pubKey),
    ).size;
    const localSpent = sessions.reduce((total, session) => total + sessionTotalCzk(session), 0);
    return {
      evenings: Math.max(remoteStats?.totalEvenings ?? 0, evenings),
      pubs: Math.max(reconciledStats?.distinctPubs ?? 0, localPubs),
      spentCzk: Math.max(reconciledStats?.totalSpentCzk ?? 0, localSpent),
    };
  }, [reconciledStats, remoteStats, sessions]);

  // The server snapshot holds the whole drink history; scan it only when the
  // snapshot changes, not on every local drink.
  const remoteFirstBeerAt = useMemo(
    () =>
      earliestTimestamp(
        (diarySnapshot?.drinks ?? [])
          .filter((drink) => !drink.is_suspect && normalizeDrinkType(drink.drink_type) === 'beer')
          .map((drink) => drink.drank_at),
      ),
    [diarySnapshot],
  );
  const firstBeerAt = useMemo(
    () =>
      earliestTimestamp([
        // The filtered drink snapshot already drops beers removed on this
        // phone; the cached profile date would still count them.
        isSignedIn && !diarySnapshot ? profile?.stats?.firstBeerAt : null,
        remoteFirstBeerAt,
        ...sessions.flatMap((session) =>
          session.drinks
            .filter((drink) => normalizeDrinkType(drink.drinkType) === 'beer')
            .map((drink) => drink.at),
        ),
      ]),
    [diarySnapshot, isSignedIn, profile?.stats?.firstBeerAt, remoteFirstBeerAt, sessions],
  );

  return { beers, ...lifetime, firstBeerAt, sessions, diarySnapshot };
}
