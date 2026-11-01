import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'expo-router';

import { getCurrentAppVersion } from '@/data/releaseNotesClient';
import { t } from '@/i18n';
import { badgeName } from '@/profile/badgeText';
import { getSeenNicknameNudgeVersion, markNicknameNudgeSeen, shouldShowNicknameNudge } from '@/profile/nicknameNudge';
import { useAccountBadges } from '@/profile/useAccountBadges';
import { selectNeedsNickname, useAccountStore } from '@/stores/accountStore';
import { useBadgeStore } from '@/stores/badgeStore';
import { useOnboardingStore } from '@/stores/onboardingStore';

import { toast } from '../../ui/store';
import { badgeIcon, observeLevel, useMe } from './profilModel';

const TAB_PATHS = new Set(['/nv', '/nv/kompas', '/nv/piva', '/nv/stamgast', '/nv/vycep', '/nv/parta']);

let levelCheck: string | null = null;
let nudgeChecked = false;

/**
 * The new look has no BadgeHost or nickname nudge of its own, so the header
 * avatar, which sits on every tab, raises them: a medal toast when a badge goes
 * up, the level-up sheet once per new level, and the nickname prompt once per
 * app version. Sheets only open over a tab, never over another flow.
 */
export function useProfilWatchers() {
  const router = useRouter();
  const pathname = usePathname();
  const onTab = TAB_PATHS.has(pathname);
  const accountId = useAccountStore((s) => s.profile?.id ?? null);
  const needsNickname = useAccountStore(selectNeedsNickname);
  const firstLaunch = useOnboardingStore((s) => s.firstLaunchSession);
  const states = useAccountBadges();
  const { xp, isSignedIn } = useMe();
  const level = xp?.level ?? null;
  const [hydrated, setHydrated] = useState(() => useBadgeStore.persist.hasHydrated());

  useEffect(() => useBadgeStore.persist.onFinishHydration(() => setHydrated(true)), []);

  useEffect(() => {
    if (!hydrated || !accountId || !states) return;
    const raised = useBadgeStore
      .getState()
      .observe(accountId, Object.fromEntries(states.map((state) => [state.key, state.tier])));
    const medals = states.filter((state) => raised.includes(state.key));
    const first = medals[0];
    if (!first) return;
    toast({
      kind: 'medal',
      icon: badgeIcon(first.key),
      title: medals.length === 1 ? t.badges.toastOne(badgeName(first)) : t.badges.toastMany(medals.length),
      sub: medals.length === 1 ? undefined : medals.map((state) => badgeName(state)).join(', '),
      href: medals.length === 1 ? `/nv/odznak?id=${first.key}` : '/nv/odznaky',
    });
  }, [accountId, hydrated, states]);

  useEffect(() => {
    if (!onTab || !isSignedIn || !accountId || level == null) return;
    const key = `${accountId}:${level}`;
    if (levelCheck === key) return;
    levelCheck = key;
    void observeLevel(accountId, level).then((up) => {
      if (up) router.push({ pathname: '/nv/novy-level', params: { since: up.since } });
    });
  }, [accountId, isSignedIn, level, onTab, router]);

  useEffect(() => {
    if (!onTab || !needsNickname || firstLaunch || nudgeChecked) return;
    nudgeChecked = true;
    const version = getCurrentAppVersion();
    void getSeenNicknameNudgeVersion().then((seen) => {
      if (!shouldShowNicknameNudge({ currentVersion: version, seenVersion: seen })) return;
      void markNicknameNudgeSeen(version);
      router.push('/nv/dokoncit-ucet');
    });
  }, [firstLaunch, needsNickname, onTab, router]);
}
