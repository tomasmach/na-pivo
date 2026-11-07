import { useEffect, useMemo } from 'react';
import { useIsFocused } from 'expo-router';

import { fetchFriendsDashboard, type FriendProfile } from '@/data/friendsClient';
import { snapshotGeneration } from '@/data/friendsSnapshot';
import { useAccountStore } from '@/stores/accountStore';

import { tablemates } from './partaModel';
import { usePartaStore } from './partaStore';

const REFRESH_EVERY_MS = 2 * 60_000;
const MIN_GAP_MS = 60_000;
let lastRefresh = 0;

/** Refreshes only the dashboard, so the counter does not clear Parta's unread dot. */
function refreshPresence(): void {
  if (Date.now() - lastRefresh < MIN_GAP_MS) return;
  lastRefresh = Date.now();
  const generation = snapshotGeneration();
  void fetchFriendsDashboard().then((dashboard) => {
    if (!dashboard || generation !== snapshotGeneration()) return;
    // After an account switch the store still holds the previous account until Parta loads.
    if (usePartaStore.getState().generation !== generation) {
      usePartaStore.setState({ dashboard, plans: null, pingIds: [], meetups: null, generation });
    } else {
      usePartaStore.setState({ dashboard });
    }
  });
}

/**
 * Who from the party sits with me, for the counter. While the counter is open it asks
 * again every couple of minutes and after each drink, so a kámoš who just sat down shows up.
 */
export function useTablemates(pubKey: string | null, beers: number, now: number): FriendProfile[] {
  const dashboard = usePartaStore((st) => (st.generation === snapshotGeneration() ? st.dashboard : null));
  const focused = useIsFocused();
  const signedIn = useAccountStore((st) => !!st.profile);
  // Without a saved Parta yet there is no telling, so ask once.
  const hasFriends = signedIn && (dashboard ? dashboard.friends.length > 0 : true);
  const slot = Math.floor(now / REFRESH_EVERY_MS);
  useEffect(() => {
    if (focused && pubKey && hasFriends) refreshPresence();
  }, [focused, pubKey, hasFriends, beers, slot]);
  return useMemo(() => tablemates(dashboard, pubKey, now), [dashboard, pubKey, now]);
}
