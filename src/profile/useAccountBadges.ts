import { useCallback, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import { badgeStates, withMapperCounters, type BadgeState } from '@/profile/badgeModel';
import { useAccountStore } from '@/stores/accountStore';

/** Every badge of the signed-in or anonymous account; null before a backend sends values. */
export function useAccountBadges(): BadgeState[] | null {
  const profile = useAccountStore((s) => s.profile);
  return useMemo(
    () => (profile?.badgeProgress ? badgeStates(withMapperCounters(profile.badgeProgress, profile.mapper)) : null),
    [profile],
  );
}

const FOCUS_REFRESH_MS = 60_000;
let lastFocusRefresh = 0;

/**
 * Photos, ratings, visits and friends also move badges. Opening the profile or
 * the collection fetches fresh values, at most once a minute.
 */
export function useRefreshBadgesOnFocus() {
  useFocusEffect(
    useCallback(() => {
      if (Date.now() - lastFocusRefresh < FOCUS_REFRESH_MS) return;
      lastFocusRefresh = Date.now();
      void useAccountStore.getState().refreshBadges();
    }, []),
  );
}
