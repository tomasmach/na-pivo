/**
 * Friend profile — pushed route `/parta/<id>` (Parta 3.0 §F1).
 *
 * A back-navigable "place" (matches /profile/edit, /settings) backed by
 * `GET /v1/friends/<id>`. It surfaces the shared history that makes the party
 * feel real — three amber stat tiles (GoingRoster numeral idiom), "Naposledy
 * spolu", and the recent shared štace — plus the dead-end killers: a prominent
 * "Ukaž na kompasu" when the friend is live now (geohash-8 handoff, never raw
 * GPS), and an overflow menu that hosts the safety actions (block / report /
 * remove).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { GlowButton } from '@/components/shared/GlowButton';
import {
  ChevronLeftIcon,
  CompassIcon,
  EllipsisIcon,
  FlameIcon,
  MapPinIcon,
} from '@/components/shared/IconGlyph';
import {
  blockFriend,
  fetchFriendProfile,
  removeFriend,
  type FriendProfile,
  type FriendProfileDetail,
} from '@/data/friendsClient';
import { focusPubFromActivity } from '@/friends/focusPubHandoff';
import HairlineRow from '@/friends/HairlineRow';
import SectionHeader from '@/friends/SectionHeader';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { Avatar } from '@/profile/Avatar';
import { cs } from '@/i18n/cs';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Spacing } from '@/theme/layout';
import { useReduceMotion } from '@/utils/useReduceMotion';

type LoadState = 'loading' | 'loaded' | 'error';

/** `@nickname` (preferred) → display name → a friendly fallback. */
function nameOf(profile: FriendProfile | null | undefined): string {
  if (!profile) return 'Kamarád';
  if (profile.nickname) return `@${profile.nickname}`;
  return profile.displayName || 'Kamarád';
}

/** "29. 6." short shared-visit stamp for the recent-together rows. */
function shortDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
}

interface StatTileProps {
  value: number;
  label: string;
  flame?: boolean;
}

/** One amber-numeral stat tile — the GoingRoster count idiom, not a card. */
function StatTile({ value, label, flame }: StatTileProps) {
  return (
    <View style={styles.statTile}>
      <View style={styles.statNumeralRow}>
        {flame ? <FlameIcon size={18} color={Colors.amber} /> : null}
        <Text style={styles.statNumeral} allowFontScaling={false} maxFontSizeMultiplier={FontScaleCap.display}>
          {value}
        </Text>
      </View>
      <Text style={styles.statLabel} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </View>
  );
}

export default function FriendProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const showToast = useToastStore((s) => s.show);
  const reportProfileContent = useAccountStore((s) => s.reportProfileContent);

  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const accountId = useMemo(() => {
    const raw = params.id;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' ? value : '';
  }, [params.id]);

  // Lazy init from the presence of an id so the effect never needs a synchronous
  // "loading" setState (would trip the cascading-render lint rule).
  const [state, setState] = useState<LoadState>(() => (accountId ? 'loading' : 'error'));
  const [detail, setDetail] = useState<FriendProfileDetail | null>(null);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const load = useCallback(async () => {
    if (!accountId) return; // state already 'error' from lazy init
    const result = await fetchFriendProfile(accountId);
    if (!mountedRef.current) return;
    setDetail(result);
    setState(result ? 'loaded' : 'error');
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Retry is a user event, so setting "loading" here is safe.
  const retry = useCallback(() => {
    setState('loading');
    void load();
  }, [load]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/friends' as Href);
  }, [router]);

  const name = nameOf(detail?.profile);

  // "Ukaž na kompasu": prefer the live row, fall back to today's plan.
  const compassTarget = detail?.liveActivity ?? detail?.plan ?? null;
  const handleShowOnCompass = useCallback(() => {
    if (!compassTarget) return;
    if (focusPubFromActivity(compassTarget)) {
      router.push('/' as Href);
    }
  }, [compassTarget, router]);

  const doReport = useCallback(() => {
    void reportProfileContent({ targetAccountId: accountId, reason: 'other', comment: name }).then(
      (res) => {
        if (!mountedRef.current) return;
        showToast(res.ok ? cs.friends.reportDone : res.detail || cs.profile.edit.errorGeneric);
      },
    );
  }, [accountId, name, reportProfileContent, showToast]);

  const doBlock = useCallback(() => {
    void blockFriend(accountId).then((res) => {
      if (!mountedRef.current) return;
      if (res.ok) {
        showToast(cs.friends.blocked);
        goBack();
      } else {
        showToast(res.detail);
      }
    });
  }, [accountId, goBack, showToast]);

  const doRemove = useCallback(() => {
    void removeFriend(accountId).then((res) => {
      if (!mountedRef.current) return;
      if (res.ok) {
        showToast(cs.friends.friendRemoved);
        goBack();
      } else {
        showToast(res.detail);
      }
    });
  }, [accountId, goBack, showToast]);

  const confirmReport = useCallback(() => {
    Alert.alert(cs.profile.report.confirmTitle, cs.profile.report.confirmBody(name), [
      { text: cs.common.cancel, style: 'cancel' },
      { text: cs.profile.report.confirmSubmit, style: 'destructive', onPress: doReport },
    ]);
  }, [doReport, name]);

  const confirmBlock = useCallback(() => {
    Alert.alert(cs.friends.blockTitle(name), cs.friends.blockBody, [
      { text: cs.common.cancel, style: 'cancel' },
      { text: cs.friends.blockConfirm, style: 'destructive', onPress: doBlock },
    ]);
  }, [doBlock, name]);

  const confirmRemove = useCallback(() => {
    Alert.alert(cs.friends.removeTitle, cs.friends.removeBody(name), [
      { text: cs.common.cancel, style: 'cancel' },
      { text: cs.friends.removeConfirm, style: 'destructive', onPress: doRemove },
    ]);
  }, [doRemove, name]);

  const openOverflow = useCallback(() => {
    Alert.alert(cs.friends.rowActionsTitle, undefined, [
      { text: cs.friends.reportAction, onPress: confirmReport },
      { text: cs.friends.blockAction, style: 'destructive', onPress: confirmBlock },
      { text: cs.friends.profileRemove, style: 'destructive', onPress: confirmRemove },
      { text: cs.common.cancel, style: 'cancel' },
    ]);
  }, [confirmBlock, confirmRemove, confirmReport]);

  const stats = detail?.stats;
  const recent = detail?.recentTogether ?? [];

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.sm }]}>
      {/* Header — back · centred @nickname · overflow */}
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={cs.friends.claimBack}
          style={({ pressed }) => [styles.headerBtn, pressed && styles.dim]}
        >
          <ChevronLeftIcon size={26} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {state === 'loaded' ? name : ''}
        </Text>
        {state === 'loaded' ? (
          <Pressable
            onPress={openOverflow}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={cs.friends.profileActionsA11y}
            style={({ pressed }) => [styles.headerBtn, pressed && styles.dim]}
          >
            <EllipsisIcon size={22} color={Colors.foamMuted} />
          </Pressable>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      {state === 'error' ? (
        <View style={styles.centerBlock}>
          <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.friends.profileError}
          </Text>
          <View style={styles.errorCta}>
            <GlowButton
              label={cs.friends.retry}
              onPress={retry}
              variant="secondary"
              glow="none"
              height={50}
            />
          </View>
        </View>
      ) : state === 'loading' ? (
        <View style={styles.loadingWrap}>
          <SkeletonBlock width={88} height={88} radius={44} reduceMotion={reduceMotion} />
          <SkeletonBlock width={160} height={22} reduceMotion={reduceMotion} />
          <SkeletonBlock width="100%" height={74} reduceMotion={reduceMotion} />
          <SkeletonBlock width="100%" height={48} reduceMotion={reduceMotion} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Identity hero */}
          <View style={styles.hero}>
            <Avatar
              uri={detail?.profile.avatarUrl}
              nickname={detail?.profile.nickname}
              displayName={detail?.profile.displayName}
              size={76}
            />
            <Text style={styles.heroName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
              {name}
            </Text>
            {detail?.profile.displayName ? (
              <Text style={styles.heroDisplay} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {detail.profile.displayName}
              </Text>
            ) : null}
          </View>

          {/* Live-now handoff to the compass */}
          {compassTarget ? (
            <View style={styles.compassWrap}>
              <GlowButton
                label={cs.friends.showOnCompass}
                onPress={handleShowOnCompass}
                variant="primary"
                glow="soft"
                icon={<CompassIcon size={20} color={Colors.stout} />}
              />
            </View>
          ) : null}

          {/* Three amber stat tiles */}
          <View style={styles.statsRow}>
            <StatTile value={stats?.sharedPubCount ?? 0} label={cs.friends.statSharedBeers} />
            <StatTile value={stats?.nightsTogether ?? 0} label={cs.friends.statNightsTogether} />
            <StatTile
              value={stats?.streakWeeks ?? 0}
              label={cs.friends.statStreakTogether}
              flame={(stats?.streakWeeks ?? 0) > 0}
            />
          </View>

          {/* Naposledy spolu + recent štace */}
          <View style={styles.recentSection}>
            <SectionHeader label={cs.friends.profileRecentHeader} />
            {stats?.lastPubName ? (
              <HairlineRow first>
                <View style={styles.recentRow}>
                  <MapPinIcon size={16} color={Colors.amber} />
                  <Text style={styles.recentLead} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.friends.lastTogether(stats.lastPubName)}
                  </Text>
                </View>
              </HairlineRow>
            ) : null}

            {recent.length > 0 ? (
              recent.map((row, i) => (
                <HairlineRow key={`${row.cacheKey}-${i}`} first={!stats?.lastPubName && i === 0}>
                  <View style={styles.recentRow}>
                    <MapPinIcon size={16} color={Colors.mutedText} />
                    <Text style={styles.recentPub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                      {row.pubName || '—'}
                    </Text>
                    {shortDate(row.at) ? (
                      <Text style={styles.recentDate} allowFontScaling={false}>
                        {shortDate(row.at)}
                      </Text>
                    ) : null}
                  </View>
                </HairlineRow>
              ))
            ) : !stats?.lastPubName ? (
              <Text style={styles.emptyHistory} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.friends.profileNoHistory}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  headerBtn: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
  },
  dim: {
    opacity: 0.6,
  },

  content: {
    paddingTop: Spacing.md,
  },

  // — Loading / error —
  loadingWrap: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.xxl,
  },
  centerBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  errorText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  errorCta: {
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.xl,
  },

  // — Identity hero —
  hero: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  heroName: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
  },
  heroDisplay: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    color: Colors.foamMuted,
  },

  // — Compass handoff —
  compassWrap: {
    marginTop: Spacing.xl,
  },

  // — Stat tiles —
  statsRow: {
    marginTop: Spacing.xl,
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  statTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.xs,
  },
  statNumeralRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  statNumeral: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 30,
    color: Colors.amber,
    includeFontPadding: false,
  },
  statLabel: {
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.mutedText,
    textAlign: 'center',
  },

  // — Recent together —
  recentSection: {
    marginTop: Spacing.xl,
  },
  recentRow: {
    minHeight: HitArea.min - 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  recentLead: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foam,
  },
  recentPub: {
    flex: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    color: Colors.foamMuted,
  },
  recentDate: {
    flexShrink: 0,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  emptyHistory: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.ui.medium,
    fontStyle: 'italic',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
  },
});
