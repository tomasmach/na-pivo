import { useEffect, useState } from 'react';
import { usePathname, useRouter, type Href } from 'expo-router';

import { getCurrentAppVersion } from '@/data/releaseNotesClient';
import { t } from '@/i18n';
import {
  getSeenPubReminderOnboardingVersion,
  markPubReminderOnboardingSeen,
  shouldShowPubReminderOnboarding,
} from '@/notifications/pubReminderOnboarding';
import { badgeName } from '@/profile/badgeText';
import { getSeenNicknameNudgeVersion, markNicknameNudgeSeen, shouldShowNicknameNudge } from '@/profile/nicknameNudge';
import { useAccountBadges } from '@/profile/useAccountBadges';
import { selectNeedsNickname, useAccountStore } from '@/stores/accountStore';
import { useBadgeStore } from '@/stores/badgeStore';
import { useLaunchModalMutex } from '@/stores/launchModalMutex';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useSettingsStore, waitForSettingsHydration } from '@/stores/settingsStore';
import { markPublicNightsAsked, shouldAskPublicNights } from '@/vycep/publicNightsAsk';

import { toast } from '../../ui/store';
import { badgeIcon, observeLevel, useMe } from './profilModel';

const TAB_PATHS = new Set(['/nv', '/nv/kompas', '/nv/piva', '/nv/stamgast', '/nv/vycep', '/nv/parta']);

let levelCheck: string | null = null;
let nudgeChecked = false;
let reminderChecked = false;
let publicNightsChecked = false;
let openSheet: string | null = null;

function release(id: string) {
  useLaunchModalMutex.getState().release(id);
}

/**
 * The new look has no BadgeHost, nickname nudge or pub-reminder explainer of
 * its own, so the header avatar, which sits on every tab, raises them: a medal
 * toast when a badge goes up, the level-up sheet once per new level, the
 * one-time ask to post nights publicly, and the pub-reminder offer and the
 * nickname prompt once per app version. Sheets only open over a tab, one at a
 * time: each holds the launch-modal mutex until the user is back on a tab.
 */
export function useProfilWatchers() {
  const router = useRouter();
  const pathname = usePathname();
  const onTab = TAB_PATHS.has(pathname);
  const accountId = useAccountStore((s) => s.profile?.id ?? null);
  const needsNickname = useAccountStore(selectNeedsNickname);
  const firstLaunch = useOnboardingStore((s) => s.firstLaunchSession);
  const remindersOn = useSettingsStore((s) => s.pubReminderEnabled);
  const holder = useLaunchModalMutex((s) => s.holder);
  const states = useAccountBadges();
  const { xp, isSignedIn } = useMe();
  const level = xp?.level ?? null;
  const [hydrated, setHydrated] = useState(() => useBadgeStore.persist.hasHydrated());

  useEffect(() => useBadgeStore.persist.onFinishHydration(() => setHydrated(true)), []);

  useEffect(() => {
    if (!onTab || !openSheet) return;
    release(openSheet);
    openSheet = null;
  }, [onTab]);

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
    const open = (id: string, href: Href) => {
      openSheet = id;
      router.push(href);
    };

    if (onTab && isSignedIn && accountId && level != null) {
      const key = `${accountId}:${level}`;
      if (levelCheck !== key && useLaunchModalMutex.getState().claim('level-up')) {
        levelCheck = key;
        void observeLevel(accountId, level).then((up) => {
          if (up) open('level-up', { pathname: '/nv/novy-level', params: { since: up.since } });
          else release('level-up');
        });
      }
    }

    // The welcome pager owns the first launch.
    if (onTab && !firstLaunch && !publicNightsChecked) {
      if (useLaunchModalMutex.getState().claim('public-nights')) {
        publicNightsChecked = true;
        void shouldAskPublicNights().then((ask) => {
          if (!ask) {
            release('public-nights');
            return;
          }
          void markPublicNightsAsked();
          open('public-nights', '/nv/verejne-noci');
        });
      }
    }

    if (onTab && !firstLaunch && !remindersOn && !reminderChecked) {
      if (useLaunchModalMutex.getState().claim('pub-reminder')) {
        reminderChecked = true;
        const version = getCurrentAppVersion();
        void (async () => {
          await waitForSettingsHydration();
          const seenVersion = await getSeenPubReminderOnboardingVersion();
          const pubReminderEnabled = useSettingsStore.getState().pubReminderEnabled;
          if (!shouldShowPubReminderOnboarding({ currentVersion: version, seenVersion, pubReminderEnabled })) {
            release('pub-reminder');
            return;
          }
          await markPubReminderOnboardingSeen(version);
          open('pub-reminder', '/nv/pripominky');
        })();
      }
    }

    if (onTab && needsNickname && !firstLaunch && !nudgeChecked) {
      if (useLaunchModalMutex.getState().claim('nickname')) {
        nudgeChecked = true;
        const version = getCurrentAppVersion();
        void getSeenNicknameNudgeVersion().then((seen) => {
          if (!shouldShowNicknameNudge({ currentVersion: version, seenVersion: seen })) {
            release('nickname');
            return;
          }
          void markNicknameNudgeSeen(version);
          open('nickname', '/nv/dokoncit-ucet');
        });
      }
    }
  }, [accountId, firstLaunch, holder, isSignedIn, level, needsNickname, onTab, remindersOn, router]);
}
