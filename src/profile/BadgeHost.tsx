/**
 * Mounted once at the app root. Announces a medal the moment a fresh profile
 * shows a higher level than this phone has seen (usually right after a beer
 * reaches the server, or after the offline queue catches up), and draws the
 * medal detail over whichever screen asked for it, the counter included.
 */

import React, { useEffect, useState } from 'react';
import { useRouter, type Href } from 'expo-router';

import { t } from '@/i18n';
import { BadgeDetailSheet } from '@/profile/BadgeDetailSheet';
import { BadgeMedal, medalLook } from '@/profile/BadgeMedal';
import type { BadgeState } from '@/profile/badgeModel';
import { badgeAmount, badgeName } from '@/profile/badgeText';
import { LOCKED_BADGES, useAccountBadges } from '@/profile/useAccountBadges';
import { useAccountStore } from '@/stores/accountStore';
import { useBadgeStore } from '@/stores/badgeStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { fireSuccessHaptic } from '@/utils/haptics';

const TOAST_MS = 4000;

function reachedAmount(state: BadgeState): string {
  return state.kind === 'tiered'
    ? badgeAmount(state.key, state.tiers[state.tier - 1])
    : t.badges.about[state.key];
}

export function BadgeHost() {
  const router = useRouter();
  const accountId = useAccountStore((s) => s.profile?.id ?? null);
  const states = useAccountBadges();
  const sheet = useBadgeStore((s) => s.sheet);
  const sheetOpen = useBadgeStore((s) => s.sheetOpen);
  const close = useBadgeStore((s) => s.close);
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
    if (useSettingsStore.getState().hapticEnabled) fireSuccessHaptic();
    const icon = <BadgeMedal badge={first.key} look={medalLook(first)} size={36} />;
    if (medals.length === 1) {
      useToastStore.getState().show(t.badges.toastOne(badgeName(first)), {
        icon,
        subtitle: reachedAmount(first),
        onPress: () => useBadgeStore.getState().open(first.key),
        durationMs: TOAST_MS,
      });
      return;
    }
    useToastStore.getState().show(t.badges.toastMany(medals.length), {
      icon,
      subtitle: medals.map((state) => badgeName(state)).join(', '),
      onPress: () => router.push('/profile/badges' as Href),
      durationMs: TOAST_MS,
    });
  }, [accountId, hydrated, router, states]);

  const state = sheet && (states ?? LOCKED_BADGES).find((candidate) => candidate.key === sheet.key);
  if (!sheet || !state) return null;
  return (
    <BadgeDetailSheet
      key={sheet.session}
      state={state}
      minting={sheet.minting}
      visible={sheetOpen}
      now={new Date()}
      onClose={close}
    />
  );
}
