import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAppDialog } from '@/components/shared/AppDialog';
import { BeerIcon, CheckIcon, ChevronLeftIcon, PlusIcon } from '@/components/shared/IconGlyph';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import { EMPTY_ACHIEVEMENTS } from '@/data/achievements';
import {
  cancelFriendRequest,
  fetchFriendProfile,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  type FriendActionResult,
  type FriendProfileDetail,
} from '@/data/friendsClient';
import { fetchProfileNights, type PublishedNight } from '@/data/nightsClient';
import { FeedCard } from '@/feed/FeedScreen';
import { mergeNightPages } from '@/feed/feedModel';
import ComposeSheet from '@/friends/ComposeSheet';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { BarChart } from '@/mocks/BarChart';
import { SectionBreak } from '@/mocks/SectionBreak';
import { Segmented } from '@/mocks/Segmented';
import { StatGrid } from '@/mocks/StatGrid';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { AchievementGrid } from '@/profile/AchievementGrid';
import { Avatar } from '@/profile/Avatar';
import {
  profileTimelineSeries,
  type ProfilePeriod,
} from '@/profile/profileStats';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

const TABS = ['Statistiky', 'Aktivita'] as const;
const PERIODS: ProfilePeriod[] = ['Týden', 'Měsíc', 'Rok'];

function relationshipLabel(detail: FriendProfileDetail): string {
  switch (detail.friendshipStatus) {
    case 'accepted':
      return 'Parťák';
    case 'outgoing_pending':
      return 'Žádost odeslána';
    case 'incoming_pending':
      return 'Přijmout';
    default:
      return 'Přidat';
  }
}

export default function PublicProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const showToast = useToastStore((state) => state.show);
  const params = useLocalSearchParams<{ accountId?: string }>();
  const accountId = typeof params.accountId === 'string' ? params.accountId : '';
  const [detail, setDetail] = useState<FriendProfileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Statistiky');
  const [period, setPeriod] = useState<ProfilePeriod>('Měsíc');
  const [scrubbed, setScrubbed] = useState<number | null>(null);
  const [relationshipBusy, setRelationshipBusy] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [nights, setNights] = useState<PublishedNight[] | null>(null);
  const [nightsCursor, setNightsCursor] = useState<string | null>(null);
  const [nightsLoading, setNightsLoading] = useState(true);
  const [nightsError, setNightsError] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!accountId) {
      setLoading(false);
      setLoadFailed(true);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    const result = await fetchFriendProfile(accountId);
    setLoading(false);
    if (!result) {
      setLoadFailed(true);
      return;
    }
    setDetail(result);
  }, [accountId]);

  const loadNights = useCallback(async () => {
    if (!accountId) return;
    setNightsLoading(true);
    setNightsError(false);
    const result = await fetchProfileNights(accountId);
    setNightsLoading(false);
    if (!result.ok) {
      setNightsError(true);
      return;
    }
    setNights(result.nights);
    setNightsCursor(result.nextCursor);
  }, [accountId]);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      void loadProfile();
      void loadNights();
    }, 0);
    return () => clearTimeout(kickoff);
  }, [loadNights, loadProfile]);

  const series = useMemo(
    () => profileTimelineSeries(detail?.publishedTimeline ?? null, period),
    [detail?.publishedTimeline, period],
  );
  const selectedPoint = scrubbed === null ? null : series.points[scrubbed];
  const handle = detail?.profile.nickname
    ? `@${detail.profile.nickname}`
    : detail?.profile.displayName || 'Pivař';

  const refreshRelationship = useCallback(async () => {
    const refreshed = await fetchFriendProfile(accountId);
    if (refreshed) setDetail(refreshed);
  }, [accountId]);

  const runRelationshipAction = useCallback(async () => {
    if (!detail || relationshipBusy) return;
    setRelationshipBusy(true);
    let result: FriendActionResult;
    if (detail.friendshipStatus === 'accepted') {
      result = await removeFriend(detail.profile.id);
    } else if (detail.friendshipStatus === 'outgoing_pending') {
      result = await cancelFriendRequest(detail.profile.id);
    } else if (detail.friendshipStatus === 'incoming_pending' && detail.incomingRequestId) {
      result = await respondFriendRequest(detail.incomingRequestId, 'accept');
    } else {
      result = await sendFriendRequest({ accountId: detail.profile.id });
    }
    setRelationshipBusy(false);
    if (!result.ok) {
      showToast(result.detail);
      return;
    }
    await refreshRelationship();
  }, [detail, refreshRelationship, relationshipBusy, showToast]);

  const relationshipPress = () => {
    if (detail?.friendshipStatus !== 'accepted') {
      void runRelationshipAction();
      return;
    }
    showAppDialog({
      title: `Odebrat ${handle} z party?`,
      buttons: [
        { text: 'Nechat v partě', style: 'cancel' },
        { text: 'Odebrat', style: 'destructive', onPress: () => void runRelationshipAction() },
      ],
    });
  };

  const loadMore = async () => {
    if (!accountId || !nightsCursor || moreLoading) return;
    setMoreLoading(true);
    const result = await fetchProfileNights(accountId, nightsCursor);
    setMoreLoading(false);
    if (!result.ok) {
      setNightsError(true);
      return;
    }
    setNights((current) => mergeNightPages(current ?? [], result.nights));
    setNightsCursor(result.nextCursor);
  };

  if (loading && !detail) {
    return (
      <View style={styles.stateScreen} accessibilityLabel="Načítám profil">
        <SkeletonBlock width={72} height={72} radius={36} reduceMotion={reduceMotion} />
        <SkeletonBlock width="72%" height={24} reduceMotion={reduceMotion} />
        <SkeletonBlock width="88%" height={140} reduceMotion={reduceMotion} />
      </View>
    );
  }

  if (loadFailed || !detail) {
    return (
      <View style={styles.stateScreen}>
        <Text style={styles.stateTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          Profil se teď nenačetl
        </Text>
        <Pressable
          onPress={() => void loadProfile()}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.retryText}>Zkusit znovu</Text>
        </Pressable>
      </View>
    );
  }

  const relationshipOn = detail.friendshipStatus !== 'none';

  return (
    <View style={styles.screen}>
      <View style={[styles.top, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Zpět"
          hitSlop={8}
        >
          <ChevronLeftIcon size={20} color={Colors.foam} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.identity}>
          <Avatar
            uri={detail.profile.avatarUrl}
            nickname={detail.profile.nickname}
            displayName={detail.profile.displayName}
            size={72}
          />
          <View style={styles.grow}>
            <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
              {handle}
            </Text>
            <Text style={styles.since} maxFontSizeMultiplier={FontScaleCap.body}>
              {detail.stats.nightsTogether > 0
                ? `Byli jste spolu ${detail.stats.nightsTogether}× na pivu`
                : 'Ještě jste spolu nebyli'}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={relationshipPress}
            disabled={relationshipBusy}
            style={({ pressed }) => [
              styles.action,
              relationshipOn ? styles.actionOn : styles.actionPrimary,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: relationshipBusy, selected: relationshipOn }}
            accessibilityLabel={relationshipLabel(detail)}
          >
            {relationshipOn ? (
              <CheckIcon size={17} color={Colors.amber} />
            ) : (
              <PlusIcon size={17} color={Colors.stout} />
            )}
            <Text style={[styles.actionText, relationshipOn && styles.actionTextOn]} maxFontSizeMultiplier={FontScaleCap.body}>
              {relationshipBusy ? 'Chvilku…' : relationshipLabel(detail)}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setComposeOpen(true)}
            disabled={!detail.isFriend}
            style={({ pressed }) => [
              styles.action,
              styles.actionGhost,
              !detail.isFriend && styles.actionDisabled,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !detail.isFriend }}
            accessibilityLabel={`Pozvat ${handle} na pivo`}
          >
            <BeerIcon size={17} color={Colors.foam} />
            <Text style={[styles.actionText, styles.actionTextGhost]} maxFontSizeMultiplier={FontScaleCap.body}>
              Na pivo?
            </Text>
          </Pressable>
        </View>

        <UnderlineTabs options={TABS} value={tab} onChange={setTab} inset={MockLayout.screenPad} />

        {tab === 'Statistiky' ? (
          <>
            {detail.publishedTimeline?.windows ? (
              <>
                <View style={styles.totals}>
                  <Text style={styles.window} maxFontSizeMultiplier={FontScaleCap.body}>
                    {selectedPoint ? selectedPoint.label : period}
                  </Text>
                  <StatGrid columns={4} compact stats={selectedPoint?.totals ?? series.totals} />
                </View>
                <View style={styles.chart}>
                  <BarChart points={series.points} onScrub={setScrubbed} />
                </View>
                <View style={styles.periodRow}>
                  <Segmented options={PERIODS} value={period} onChange={setPeriod} />
                </View>
              </>
            ) : null}

            {detail.publicStats ? (
              <>
                <SectionBreak title="Celkem" />
                <StatGrid
                  columns={3}
                  stats={[
                    { label: 'Piv', value: String(detail.publicStats.totalBeers) },
                    { label: 'Hospod', value: String(detail.publicStats.distinctPubs) },
                    { label: 'Mapér', value: String(detail.publicStats.mapperLevel) },
                  ]}
                />
              </>
            ) : null}

            {detail.achievements ? (
              <>
                <SectionBreak title="Odznaky" />
                <AchievementGrid mapper={undefined} achievements={detail.achievements ?? EMPTY_ACHIEVEMENTS} />
              </>
            ) : null}
          </>
        ) : (
          <View style={styles.activity}>
            {nightsLoading && nights === null ? (
              <View style={styles.activityLoading} accessibilityLabel="Načítám večery">
                <SkeletonBlock width="100%" height={150} reduceMotion={reduceMotion} />
                <SkeletonBlock width="100%" height={150} reduceMotion={reduceMotion} />
              </View>
            ) : null}
            {!nightsLoading && (nights?.length ?? 0) === 0 ? (
              <View style={styles.activityState}>
                <Text style={styles.activityTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {nightsError ? 'Večery se teď nedotáhly' : 'Zatím žádný zveřejněný večer'}
                </Text>
                {nightsError ? (
                  <Pressable onPress={() => void loadNights()} style={styles.retry} accessibilityRole="button">
                    <Text style={styles.retryText}>Zkusit znovu</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {(nights ?? []).map((night, index) => (
              <FeedCard key={night.id} night={night} first={index === 0} />
            ))}
            {nightsCursor ? (
              <Pressable onPress={() => void loadMore()} disabled={moreLoading} style={styles.more} accessibilityRole="button">
                <Text style={styles.moreText}>{moreLoading ? 'Dotahuju…' : 'Starší večery'}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </ScrollView>

      {composeOpen ? (
        <ComposeSheet
          friends={[detail.profile]}
          onSubmitted={() => undefined}
          onClose={() => setComposeOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  stateScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
    backgroundColor: Colors.stout,
  },
  stateTitle: { fontSize: 20, fontWeight: '800', color: Colors.foam, textAlign: 'center' },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },
  content: { paddingHorizontal: MockLayout.screenPad },
  top: { paddingHorizontal: MockLayout.screenPad, paddingBottom: Spacing.sm },
  back: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.1),
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  handle: { ...MockType.titleXL, fontSize: 26, color: Colors.foam },
  since: { fontSize: 14, fontWeight: '500', color: Colors.mutedText, marginTop: 2 },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  action: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.pill,
  },
  actionPrimary: { backgroundColor: Colors.amber },
  actionOn: { backgroundColor: withAlpha(Colors.amber, 0.16) },
  actionGhost: { backgroundColor: withAlpha(Colors.foam, 0.09) },
  actionDisabled: { opacity: 0.38 },
  actionText: { fontSize: 14, fontWeight: '800', color: Colors.stout },
  actionTextOn: { color: Colors.amber },
  actionTextGhost: { color: Colors.foam },
  totals: { marginTop: Spacing.lg, gap: Spacing.sm },
  window: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  chart: { marginTop: Spacing.lg },
  periodRow: { marginTop: Spacing.lg },
  retry: {
    minHeight: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    marginTop: Spacing.sm,
  },
  retryText: { fontSize: 14, fontWeight: '800', color: Colors.foam },
  activity: { marginTop: Spacing.xs },
  activityLoading: { gap: Spacing.md, marginTop: Spacing.md },
  activityState: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  activityTitle: { fontSize: 18, fontWeight: '800', color: Colors.foam, textAlign: 'center' },
  more: { minHeight: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 14, fontWeight: '800', color: Colors.amber },
});
