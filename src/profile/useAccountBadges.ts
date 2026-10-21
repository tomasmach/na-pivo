import { useMemo } from 'react';

import { parseBadgeProgress } from '@/data/auth';
import { badgeStates, withMapperCounters, type BadgeState } from '@/profile/badgeModel';
import { useAccountStore } from '@/stores/accountStore';

/** The whole collection locked: before the first profile arrives, or from an older backend. */
export const LOCKED_BADGES: readonly BadgeState[] = badgeStates(parseBadgeProgress({}));

/** Every badge of the signed-in or anonymous account; null before a backend sends values. */
export function useAccountBadges(): BadgeState[] | null {
  const profile = useAccountStore((s) => s.profile);
  return useMemo(
    () => (profile?.badgeProgress ? badgeStates(withMapperCounters(profile.badgeProgress, profile.mapper)) : null),
    [profile],
  );
}
