/**
 * DESIGN MOCK — the profile, rebuilt as Strava's "You".
 *
 * The Tácek profile stacked a hero card, a level ring, a four-up stat strip, a
 * nudge, a primary CTA and a secondary button — six competing blocks before you
 * reached anything you did. This is the same information in the order Strava
 * uses: who you are, your numbers, then your activities.
 *
 * What went, and why:
 *   level ring       a locked padlock is a screen advertising its own emptiness
 *   "Založ si profil" a CTA is only earned when there is no account (below)
 *   "Pivní fotky"    a button to a place; the photos belong IN the list
 *   nudge strip      one more thing shouting on a screen about your history
 *
 * The only CTA left is sign-in, and only when signed out — that is the one
 * moment the screen genuinely has something to ask for.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';

import { accountXpProgress } from '@/data/accountXp';
import { EMPTY_ACHIEVEMENTS } from '@/data/achievements';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import { fetchMyNights, type PublishedNight } from '@/data/nightsClient';
import { PhotoDiarySection } from '@/photos/PhotoDiarySection';
import { FeedCard } from '@/feed/FeedScreen';
import { loadNightFeedCache, saveNightFeedCache } from '@/feed/feedCache';
import { mergeNightPages } from '@/feed/feedModel';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { BarChart } from '@/mocks/BarChart';
import { SectionBreak } from '@/mocks/SectionBreak';
import { Segmented } from '@/mocks/Segmented';
import { StatGrid } from '@/mocks/StatGrid';
import { AchievementGrid } from '@/profile/AchievementGrid';
import { Avatar } from '@/profile/Avatar';
import {
  firstDrinkLabel,
  profileSeries,
  type ProfilePeriod,
} from '@/profile/profileStats';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { selectIsSignedIn, useAccountStore } from '@/stores/accountStore';
import { useMyStatsState } from '@/stats/useMyStats';
import { TAB_CHROME } from '@/components/shared/TabBar';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import {
  ChevronRightIcon,
  HistoryIcon,
  PencilIcon,
  UsersIcon,
} from '@/components/shared/IconGlyph';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

/** Stable keys; the visible labels come from t below. */
const TABS = ['stats', 'activity'] as const;
const TAB_LABELS: Record<(typeof TABS)[number], string> = {
  stats: t.profile.tabStats,
  activity: t.profile.tabActivity,
};
const TAB_OPTIONS = TABS.map((key) => TAB_LABELS[key]);
const tabFromLabel = (label: string) => TABS.find((key) => TAB_LABELS[key] === label) ?? 'stats';

const PERIODS: ProfilePeriod[] = ['week', 'month', 'year'];
const PERIOD_LABELS: Record<ProfilePeriod, string> = {
  week: t.profile.periodWeek,
  month: t.profile.periodMonth,
  year: t.profile.periodYear,
};
const PERIOD_OPTIONS = PERIODS.map((key) => PERIOD_LABELS[key]);
const periodFromLabel = (label: string) => PERIODS.find((key) => PERIOD_LABELS[key] === label) ?? 'week';

/** Badges shown on the profile: two rows of three, the cabinet is a tap away. */
const PROFILE_BADGE_TEASER = 6;

/**
 * The private diary is a first-class profile surface, not another activity
 * filter. Published nights stay under Aktivita; this door opens every local,
 * private and queued record without requiring an account or a network.
 */
function ProfileDoor({
  icon,
  label,
  value,
  accessibilityLabel,
  onPress,
  first,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  accessibilityLabel: string;
  onPress: () => void;
  first?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.diaryDoor, first && styles.diaryDoorFirst, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.diaryDoorIcon}>{icon}</View>
      <View style={styles.grow}>
        <Text
          style={styles.diaryDoorLabel}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {label}
        </Text>
        {value ? (
          <Text
            style={styles.diaryDoorValue}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {value}
          </Text>
        ) : null}
      </View>
      <ChevronRightIcon size={18} color={Colors.mutedText} />
    </Pressable>
  );
}

export function ProfileDiaryDoor({ onPress }: { onPress: () => void }) {
  return (
    <ProfileDoor
      first
      icon={<HistoryIcon size={20} color={Colors.amber} />}
      label={t.profile.privateDiary}
      accessibilityLabel={t.a11y.profileDiary}
      onPress={onPress}
    />
  );
}

function ProfileActivityContent({ accountId, reduceMotion }: { accountId: string; reduceMotion: boolean }) {
  const router = useRouter();
  const [nights, setNights] = useState<PublishedNight[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const persist = useCallback(
    (nextNights: PublishedNight[], nextCursor: string | null) => {
      void saveNightFeedCache(accountId, 'mine', {
        nights: nextNights,
        nextCursor,
        savedAt: Date.now(),
      });
    },
    [accountId],
  );

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    // A stale load-more landing under this refresh would merge into the wrong
    // generation and leave its spinner disabled over a replaced list.
    setLoadingMore(false);
    setError(null);

    const network = fetchMyNights();
    const cached = await loadNightFeedCache(accountId, 'mine');
    if (currentRequest !== requestId.current) return;
    if (cached && cached.nights.length > 0) {
      setNights(cached.nights);
      setCursor(cached.nextCursor);
      setLoading(false);
    }

    const result = await network;
    if (currentRequest !== requestId.current) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.detail);
      return;
    }
    setNights(result.nights);
    setCursor(result.nextCursor);
    persist(result.nights, result.nextCursor);
  }, [accountId, persist]);

  useEffect(() => {
    const kickoff = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(kickoff);
      requestId.current += 1;
    };
  }, [load]);

  const loadMore = useCallback(async () => {
    // A refresh in flight resets loadingMore and will replace the list, so a
    // page started now could only race it — belt over braces on top of the
    // disabled prop.
    if (!cursor || loading || loadingMore) return;
    const currentRequest = requestId.current;
    setLoadingMore(true);
    const result = await fetchMyNights(cursor);
    // A refresh, account swap or unmount bumped the request in between; this
    // page belongs to a replaced generation and must touch nothing.
    if (currentRequest !== requestId.current) return;
    setLoadingMore(false);
    if (!result.ok) {
      setError(result.detail);
      return;
    }
    const merged = mergeNightPages(nights ?? [], result.nights);
    setNights(merged);
    setCursor(result.nextCursor);
    setError(null);
    persist(merged, result.nextCursor);
  }, [cursor, loading, loadingMore, nights, persist]);

  const openNight = useCallback((night: PublishedNight) => {
    router.push(`/night/${encodeURIComponent(night.id)}` as Href);
  }, [router]);

  if (loading && !nights) {
    return (
      <View style={styles.activityLoading} accessibilityLabel={t.profile.myNightsLoadingA11y}>
        <SkeletonBlock width="100%" height={160} reduceMotion={reduceMotion} />
        <SkeletonBlock width="100%" height={160} reduceMotion={reduceMotion} />
      </View>
    );
  }

  if (!nights?.length) {
    return (
      <View style={styles.activityState}>
        <Text style={styles.activityTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {error ? t.profile.nightsError : t.profile.nightsEmpty}
        </Text>
        {error ? (
          <Pressable
            onPress={() => void load()}
            style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t.profile.myNightsRetryA11y}
          >
            <Text style={styles.retryText}>{t.profile.nightsRetry}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.activityList}>
      {error ? (
        <Pressable
          onPress={() => void load()}
          style={({ pressed }) => [styles.activityWarning, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t.profile.myNightsRefreshA11y}
        >
          <Text style={styles.activityWarningText}>{t.profile.nightsStale}</Text>
        </Pressable>
      ) : null}
      {nights.map((night, index) => (
        <FeedCard
          key={night.id}
          night={night}
          first={index === 0}
          onOpenNight={openNight}
        />
      ))}
      {cursor ? (
        <Pressable
          onPress={() => void loadMore()}
          disabled={loading || loadingMore}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t.profile.myNightsMoreA11y}
        >
          <Text style={styles.moreText}>
            {loadingMore ? t.profile.nightsLoadingMore : t.profile.nightsMore}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Own-night state is private to the active account. Profile tabs stay mounted
 * while a credential is replaced, so changing the owner must synchronously
 * unmount the previous list before the replacement account's cache or network
 * request settles. A stable key keeps ordinary same-account offline refreshes.
 */
export function ProfileActivity({
  accountId,
  reduceMotion,
}: {
  accountId: string;
  reduceMotion: boolean;
}) {
  return (
    <ProfileActivityContent
      key={accountId}
      accountId={accountId}
      reduceMotion={reduceMotion}
    />
  );
}

export default function ProfileMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<(typeof TABS)[number]>('stats');
  const [period, setPeriod] = useState<ProfilePeriod>('week');
  const [scrubbed, setScrubbed] = useState<number | null>(null);
  const { stats, status: statsStatus, retry: retryStats } = useMyStatsState();
  const series = useMemo(() => profileSeries(stats, period), [period, stats]);
  // The header follows your finger. With nothing held it shows the whole window.
  const point = scrubbed === null ? null : series.points[scrubbed];
  const totals = point?.totals ?? series.totals;
  const profile = useAccountStore((s) => s.profile);
  const signedIn = useAccountStore(selectIsSignedIn);

  const handle = profile?.nickname
    ? `@${profile.nickname}`
    : profile?.displayName?.trim() || t.profile.handleFallback;

  // One ladder, both counters. Signed out or with nothing earned yet there is no
  // rung to show, so the line disappears rather than announcing a zero.
  const xp = useMemo(
    () => (signedIn ? accountXpProgress(profile?.mapper, profile?.pivar) : null),
    [profile?.mapper, profile?.pivar, signedIn],
  );

  // The locally cached party snapshot: a count on the door without a request,
  // so it survives a table with no signal. The count carries the owner it was
  // read for — tabs stay mounted across a credential replacement, so a stale
  // count must disappear synchronously with the account it belonged to.
  const ownerId = signedIn && profile?.id ? profile.id : null;
  const [partaCount, setPartaCount] = useState<{ ownerId: string; count: number } | null>(null);
  const partaRequestId = useRef(0);
  // Raw-snapshot hydration is owner-bound (same invariant as usePartaDashboard):
  // a null owner never reads the raw blob, only the first non-null owner of
  // this mount may, and once a different non-null owner shows up in-process
  // the read locks permanently — the raw storage is a single global blob, so
  // any further read would hand back the previous account's data.
  const partaSnapshotOwnerRef = useRef<string | null>(null);
  const partaSnapshotLockedRef = useRef(false);

  const loadPartaCount = useCallback(async () => {
    if (!ownerId) return;
    if (
      partaSnapshotLockedRef.current ||
      (partaSnapshotOwnerRef.current != null && partaSnapshotOwnerRef.current !== ownerId)
    ) {
      partaSnapshotLockedRef.current = true;
      return;
    }
    partaSnapshotOwnerRef.current = ownerId;
    const requestId = ++partaRequestId.current;
    const snapshot = await loadFriendsDashboardSnapshot();
    if (requestId !== partaRequestId.current || !snapshot) return;
    setPartaCount({
      ownerId,
      count:
        snapshot.dashboard.relationshipPage?.friendsCount ??
        snapshot.dashboard.friends.length,
    });
  }, [ownerId]);

  useFocusEffect(
    useCallback(() => {
      void loadPartaCount();
      return () => {
        partaRequestId.current += 1;
      };
    }, [loadPartaCount]),
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TAB_CHROME }]}
      contentInsetAdjustmentBehavior="automatic"
    >
      {/* Who you are: a face and a handle — and the way back to changing them.
          The identity block IS the edit affordance; a separate "Upravit profil"
          row would be a second thing pointing at the same place. */}
      <Pressable
        // Without an account there is nothing to edit and the editor cannot
        // save, so the block goes inert rather than opening a dead end — the
        // amber CTA below is the honest destination in that state.
        disabled={!signedIn}
        style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
        accessibilityRole={signedIn ? 'button' : 'header'}
        accessibilityLabel={signedIn ? t.a11y.profileIdentity : handle}
        onPress={() => {
          trackUiInteraction('profile_edit_open');
          router.push('/profile/edit' as Href);
        }}
      >
        {/* The real photo when there is one, the initial when there is not.
            A stock face is a lie that reads as a bug the moment somebody
            notices it is not them — and most people never set a photo. */}
        <Avatar
          uri={profile?.avatarUrl}
          nickname={profile?.nickname}
          displayName={profile?.displayName}
          size={68}
        />
        <View style={styles.grow}>
          <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {handle}
          </Text>
          {/* A fresh account sits on rung one with nothing earned; "Úroveň 1 ·
              Zelenáč" is a line announcing a zero, so it waits for the first XP. */}
          {xp && xp.xp > 0 ? (
            <Text style={styles.level} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.profile.levelLine(xp.level, xp.title)}
            </Text>
          ) : null}
          <Text style={styles.since} maxFontSizeMultiplier={FontScaleCap.body}>
            {signedIn ? firstDrinkLabel(stats?.firstDrinkAt) : t.profile.noAccountNick}
          </Text>
        </View>
        {signedIn ? <PencilIcon size={18} color={Colors.mutedText} /> : null}
      </Pressable>

      <ProfileDiaryDoor
        onPress={() => {
          trackUiInteraction('profile_diary_open');
          router.push('/profile/diary' as Href);
        }}
      />

      <ProfileDoor
        icon={<UsersIcon size={20} color={Colors.amber} />}
        label={t.profile.moreParta}
        value={
          partaCount && partaCount.ownerId === ownerId
            ? t.profile.partaCount(partaCount.count)
            : undefined
        }
        accessibilityLabel={t.a11y.profileParta}
        onPress={() => {
          trackUiInteraction('profile_friends_manage_open');
          // The people inbox opens OUTSIDE the tabs: pushing the copy inside
          // (tabs)/friends would flip the tab bar to Kocoviny while you are
          // standing on Profil.
          router.push('/profile/parta' as Href);
        }}
      />

      {/* Sign-in is the one thing this screen may ask for, and only when there
          is genuinely nothing to ask twice. */}
      {signedIn ? null : (
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t.profile.createProfileA11y}
          onPress={() => router.push('/auth' as Href)}
        >
          <Text style={styles.ctaText} maxFontSizeMultiplier={FontScaleCap.heading}>
            {t.profile.ctaSignUp}
          </Text>
        </Pressable>
      )}

      {/* Two jobs, two tabs. Statistiky is the default because a profile is
          first a place you check where you stand; Aktivita is the same posts the
          feed shows, so a night looks identical wherever you meet it. */}
      {signedIn ? <UnderlineTabs
                options={TAB_OPTIONS}
                value={TAB_LABELS[tab]}
                onChange={(label) => setTab(tabFromLabel(label))}
                inset={MockLayout.screenPad}
              /> : null}

      {signedIn && tab === 'stats' ? (
        <>
          {statsStatus === 'loading' && !stats ? (
            <View style={styles.loading} accessibilityLabel={t.profile.statsLoadingA11y}>
              <SkeletonBlock width="100%" height={72} reduceMotion={reduceMotion} />
              <SkeletonBlock width="100%" height={150} reduceMotion={reduceMotion} />
            </View>
          ) : null}
          {statsStatus === 'unavailable' && !stats ? (
            <Pressable
              onPress={retryStats}
              style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t.profile.statsRetryA11y}
            >
              <Text style={styles.retryText}>{t.profile.statsRetry}</Text>
            </Pressable>
          ) : null}
          {stats ? <>
          {/* Numbers first, then the shape of them, then the control that
              changes both. The segment used to lead, which meant the screen
              opened on a filter rather than on an answer — you look at a profile
              to see where you stand, not to pick a time window. */}
          <View style={styles.totals}>
            <Text style={styles.window} maxFontSizeMultiplier={FontScaleCap.body}>
              {point ? point.label : PERIOD_LABELS[period]}
            </Text>
            <StatGrid columns={4} compact stats={totals} />
          </View>

          <View style={styles.chart}>
            <BarChart points={series.points} onScrub={setScrubbed} />
          </View>

          <View style={styles.periodRow}>
            <Segmented
              options={PERIOD_OPTIONS}
              value={PERIOD_LABELS[period]}
              onChange={(label) => setPeriod(periodFromLabel(label))}
            />
          </View>

          {/* The photos belong IN the list, not behind a button to a place. */}
          <SectionBreak />
          <PhotoDiarySection variant="profile" />

          <SectionBreak />
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              {t.profile.badgesLink}
            </Text>
            <Pressable
              onPress={() => {
                trackUiInteraction('profile_badges_open');
                router.push('/profile/badges' as Href);
              }}
              hitSlop={8}
              style={({ pressed }) => [styles.sectionLink, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t.a11y.profileBadges}
            >
              <Text style={styles.sectionLinkText} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.profile.badgesAll}
              </Text>
              <ChevronRightIcon size={16} color={Colors.amber} />
            </Pressable>
          </View>
          {/* Two rows here, the rest behind "Zobrazit vše" — a link above the
              complete cabinet would point at what you are already looking at. */}
          <AchievementGrid
            limit={PROFILE_BADGE_TEASER}
            mapper={profile?.mapper}
            achievements={profile?.achievements ?? EMPTY_ACHIEVEMENTS}
          />
          </> : null}
        </>
      ) : null}
      {signedIn && tab === 'activity' && profile?.id ? (
        <ProfileActivity accountId={profile.id} reduceMotion={reduceMotion} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: MockLayout.screenPad },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },

  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.sm },
  avatar: { width: 68, height: 68, borderRadius: 34 },
  handle: { fontSize: 24, fontWeight: '800', color: Colors.foam, letterSpacing: -0.4 },
  level: { fontSize: 13, fontWeight: '700', color: Colors.amber, marginTop: 2 },
  since: { fontSize: 14, fontWeight: '400', color: Colors.mutedText, marginTop: 2 },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    // Heading → content is controlGap (DESIGN.md §4), not a hand-picked 14.
    marginBottom: MockLayout.controlGap,
  },
  sectionTitle: { ...MockType.titleS, flex: 1, color: Colors.foam },
  sectionLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  sectionLinkText: { fontSize: 14, fontWeight: '700', color: Colors.amber },

  diaryDoor: {
    minHeight: MockLayout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    // Doors are a pair, so they sit closer to each other than to the identity
    // block above; only the first one takes the block-to-block gap.
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    // A door, not a capsule: at 28 on a 68pt row the corners meet in the middle
    // and the entry read as a pill floating over the profile.
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    backgroundColor: Colors.stout2,
  },
  diaryDoorIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  diaryDoorFirst: { marginTop: Spacing.lg },
  diaryDoorLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.foam,
  },
  diaryDoorValue: { fontSize: 13, fontWeight: '500', color: Colors.mutedText, marginTop: 2 },

  cta: {
    height: MockLayout.buttonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
    marginTop: Spacing.lg,
  },
  ctaText: { ...MockType.buttonLabel, color: Colors.stout },

  // No rule and no section gap here: the tabs above already draw a baseline and
  // own their own bottom margin, so a second hairline 32pt below the first read
  // as an empty band with a stray line across it.
  totals: { marginTop: Spacing.xs },
  window: { fontSize: 13, fontWeight: '700', color: Colors.amber, marginBottom: Spacing.sm },
  chart: { marginTop: Spacing.xl },
  periodRow: { marginTop: Spacing.lg },
  loading: { gap: Spacing.md, marginTop: Spacing.lg },
  retry: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  retryText: { fontSize: 14, fontWeight: '700', color: Colors.foam, textAlign: 'center' },
  activityLoading: { gap: Spacing.md, marginTop: Spacing.md },
  activityState: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  activityTitle: { fontSize: 19, fontWeight: '800', color: Colors.foam, textAlign: 'center' },
  activityList: { marginTop: Spacing.xs },
  activityWarning: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.amber, 0.1),
    marginVertical: Spacing.sm,
  },
  activityWarningText: { fontSize: 12, fontWeight: '700', color: Colors.amber },
  more: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 14, fontWeight: '800', color: Colors.amber },

  section: { ...MockType.titleS, color: Colors.foam, marginTop: MockLayout.sectionGap },

});
