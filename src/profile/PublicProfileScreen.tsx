import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAppDialog } from '@/components/shared/AppDialog';
import {
  BeerIcon,
  CheckIcon,
  ChevronLeftIcon,
  MenuIcon,
  PlusIcon,
} from '@/components/shared/IconGlyph';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import { EMPTY_ACHIEVEMENTS } from '@/data/achievements';
import { reportProfileContent } from '@/data/auth';
import {
  blockFriend,
  fetchFriendProfile,
  followAccount,
  removeFriend,
  respondFriendRequest,
  unblockFriend,
  unfollowAccount,
  type FriendActionResult,
  type FriendProfileDetail,
} from '@/data/friendsClient';
import { fetchProfileNights, type PublishedNight } from '@/data/nightsClient';
import { FeedCard } from '@/feed/FeedScreen';
import { mergeNightPages, replaceNightReaction } from '@/feed/feedModel';
import { notifyNightFeedSafetyChange } from '@/feed/feedSafetySignal';
import { useNightActions } from '@/feed/useNightActions';
import { useNightReaction } from '@/feed/useNightReaction';
import ComposeSheet from '@/friends/ComposeSheet';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { BarChart } from '@/mocks/BarChart';
import { SectionBreak } from '@/mocks/SectionBreak';
import { Segmented } from '@/mocks/Segmented';
import { StatGrid } from '@/mocks/StatGrid';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { AchievementGrid } from '@/profile/AchievementGrid';
import { Avatar } from '@/profile/Avatar';
import { cs } from '@/i18n/cs';
import { leaveRoute } from '@/navigation/leaveRoute';
import {
  profileTimelineSeries,
  type ProfilePeriod,
} from '@/profile/profileStats';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

const TABS = ['Statistiky', 'Aktivita'] as const;
const PERIODS: ProfilePeriod[] = ['Týden', 'Měsíc', 'Rok'];

/**
 * The relationship button no longer offers "Přidat" to a stranger: a friendship
 * now comes from sharing a table, not from a request. What a stranger's profile
 * offers instead is the one-way follow. Incoming requests still resolve here —
 * versions in the store can still send one, and a person who has one waiting
 * would otherwise have nowhere to answer it.
 */
function relationshipLabel(detail: FriendProfileDetail, isFollowing: boolean): string {
  if (detail.blocked) return cs.friends.unblockAction;
  switch (detail.friendshipStatus) {
    case 'accepted':
      return 'Parťák';
    case 'incoming_pending':
      return 'Přijmout';
    default:
      return isFollowing ? cs.friends.unfollow : cs.friends.follow;
  }
}

export default function PublicProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const showToast = useToastStore((state) => state.show);
  const viewerAccountId = useAccountStore((state) => state.session?.accountId ?? null);
  const params = useLocalSearchParams<{ accountId?: string }>();
  const accountId = typeof params.accountId === 'string' ? params.accountId : '';
  const [storedDetail, setDetail] = useState<FriendProfileDetail | null>(null);
  const [detailViewerAccountId, setDetailViewerAccountId] = useState<string | null>(null);
  const [storedLoading, setLoading] = useState(true);
  const [storedLoadFailed, setLoadFailed] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Statistiky');
  const [period, setPeriod] = useState<ProfilePeriod>('Měsíc');
  const [scrubbed, setScrubbed] = useState<number | null>(null);
  const [relationshipBusyFor, setRelationshipBusyFor] = useState<string | null>(null);
  /**
   * Follow is a toggle the server confirms with an empty body, so the button
   * keeps its own answer rather than re-fetching the whole profile to learn a
   * single boolean. Tagged with both the viewer and the profile it belongs to,
   * so neither an account swap nor a push to another profile can inherit it.
   */
  const [followingFor, setFollowingFor] = useState<
    { viewer: string; profile: string; value: boolean } | null
  >(null);
  const [safetyBusyFor, setSafetyBusyFor] = useState<string | null>(null);
  const [composeOpenFor, setComposeOpenFor] = useState<string | null>(null);
  const [storedNights, setNights] = useState<PublishedNight[] | null>(null);
  const [storedNightsCursor, setNightsCursor] = useState<string | null>(null);
  const [nightsViewerAccountId, setNightsViewerAccountId] = useState<string | null>(null);
  const [storedNightsLoading, setNightsLoading] = useState(true);
  const [storedNightsError, setNightsError] = useState(false);
  const [moreLoadingFor, setMoreLoadingFor] = useState<string | null>(null);
  const profileControllerRef = useRef<AbortController | null>(null);
  const nightsControllerRef = useRef<AbortController | null>(null);
  const moreControllerRef = useRef<AbortController | null>(null);
  const profileGenerationRef = useRef(0);
  const nightsGenerationRef = useRef(0);

  const detailOwnerMatches =
    viewerAccountId !== null && detailViewerAccountId === viewerAccountId;
  const nightsOwnerMatches =
    viewerAccountId !== null && nightsViewerAccountId === viewerAccountId;
  const detail = detailOwnerMatches ? storedDetail : null;
  const loading = detailOwnerMatches ? storedLoading : true;
  const loadFailed = detailOwnerMatches ? storedLoadFailed : false;
  const nights = nightsOwnerMatches ? storedNights : null;
  const nightsCursor = nightsOwnerMatches ? storedNightsCursor : null;
  const nightsLoading = nightsOwnerMatches ? storedNightsLoading : true;
  const nightsError = nightsOwnerMatches ? storedNightsError : false;
  const composeOpen =
    viewerAccountId !== null && composeOpenFor === viewerAccountId;
  const relationshipBusy =
    viewerAccountId !== null && relationshipBusyFor === viewerAccountId;
  const following =
    followingFor !== null &&
    followingFor.viewer === viewerAccountId &&
    followingFor.profile === accountId
      ? followingFor.value
      : detail?.isFollowing === true;
  const safetyBusy = viewerAccountId !== null && safetyBusyFor === viewerAccountId;
  const moreLoading = viewerAccountId !== null && moreLoadingFor === viewerAccountId;

  const viewerIsCurrent = useCallback(
    (expected: string | null) =>
      expected !== null &&
      useAccountStore.getState().session?.accountId === expected,
    [],
  );

  const loadProfile = useCallback(async () => {
    if (!accountId || !viewerAccountId) {
      setLoading(false);
      setLoadFailed(true);
      return;
    }
    const requestedViewer = viewerAccountId;
    const generation = ++profileGenerationRef.current;
    profileControllerRef.current?.abort();
    const controller = new AbortController();
    profileControllerRef.current = controller;
    setLoading(true);
    setLoadFailed(false);
    const result = await fetchFriendProfile(accountId, controller.signal);
    if (
      controller.signal.aborted ||
      generation !== profileGenerationRef.current ||
      useAccountStore.getState().session?.accountId !== requestedViewer
    ) return;
    setLoading(false);
    if (!result) {
      setDetail(null);
      setLoadFailed(true);
      setDetailViewerAccountId(requestedViewer);
      return;
    }
    setDetail(result);
    setDetailViewerAccountId(requestedViewer);
  }, [accountId, viewerAccountId]);

  const loadNights = useCallback(async () => {
    if (!accountId || !viewerAccountId) return;
    const requestedViewer = viewerAccountId;
    const generation = ++nightsGenerationRef.current;
    nightsControllerRef.current?.abort();
    const controller = new AbortController();
    nightsControllerRef.current = controller;
    setNightsLoading(true);
    setNightsError(false);
    const result = await fetchProfileNights(accountId, undefined, controller.signal);
    if (
      controller.signal.aborted ||
      generation !== nightsGenerationRef.current ||
      useAccountStore.getState().session?.accountId !== requestedViewer
    ) return;
    setNightsLoading(false);
    if (!result.ok) {
      setNights(null);
      setNightsCursor(null);
      setNightsError(true);
      setNightsViewerAccountId(requestedViewer);
      return;
    }
    setNights(result.nights);
    setNightsCursor(result.nextCursor);
    setNightsViewerAccountId(requestedViewer);
  }, [accountId, viewerAccountId]);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      void loadProfile();
      void loadNights();
    }, 0);
    return () => {
      clearTimeout(kickoff);
      profileGenerationRef.current += 1;
      nightsGenerationRef.current += 1;
      profileControllerRef.current?.abort();
      nightsControllerRef.current?.abort();
      moreControllerRef.current?.abort();
    };
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
    await loadProfile();
  }, [loadProfile]);

  const unblockProfile = useCallback(async () => {
    if (!detail?.blocked || safetyBusy || !viewerAccountId) return;
    const requestedViewer = viewerAccountId;
    setSafetyBusyFor(requestedViewer);
    const result = await unblockFriend(detail.profile.id);
    if (!viewerIsCurrent(requestedViewer)) return;
    if (!result.ok) {
      setSafetyBusyFor(null);
      showToast(result.detail);
      return;
    }
    setDetail((current) => current ? { ...current, blocked: false } : current);
    await notifyNightFeedSafetyChange({
      viewerAccountId,
      targetAccountId: detail.profile.id,
      blocked: false,
    });
    if (!viewerIsCurrent(requestedViewer)) return;
    setSafetyBusyFor(null);
    showToast(cs.friends.unblocked);
    await Promise.all([loadProfile(), loadNights()]);
  }, [detail, loadNights, loadProfile, safetyBusy, showToast, viewerAccountId, viewerIsCurrent]);

  const runRelationshipAction = useCallback(async () => {
    if (!detail || relationshipBusy || !viewerAccountId) return;
    if (detail.blocked) {
      await unblockProfile();
      return;
    }
    const requestedViewer = viewerAccountId;
    setRelationshipBusyFor(requestedViewer);
    let result: FriendActionResult;
    let nextFollowing: boolean | null = null;
    if (detail.friendshipStatus === 'accepted') {
      result = await removeFriend(detail.profile.id);
    } else if (detail.friendshipStatus === 'incoming_pending' && detail.incomingRequestId) {
      result = await respondFriendRequest(detail.incomingRequestId, 'accept');
    } else if (following) {
      result = await unfollowAccount(detail.profile.id);
      nextFollowing = false;
    } else {
      result = await followAccount(detail.profile.id);
      nextFollowing = true;
    }
    if (!viewerIsCurrent(requestedViewer)) return;
    setRelationshipBusyFor(null);
    if (!result.ok) {
      showToast(result.detail);
      return;
    }
    if (nextFollowing !== null) {
      setFollowingFor({ viewer: requestedViewer, profile: detail.profile.id, value: nextFollowing });
      showToast(nextFollowing ? cs.friends.followed : cs.friends.unfollowed);
      return;
    }
    await refreshRelationship();
  }, [detail, following, refreshRelationship, relationshipBusy, showToast, unblockProfile, viewerAccountId, viewerIsCurrent]);

  const relationshipPress = () => {
    if (detail?.blocked) {
      void unblockProfile();
      return;
    }
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

  const reportProfile = useCallback(async () => {
    if (!detail || safetyBusy || !viewerAccountId) return;
    const requestedViewer = viewerAccountId;
    setSafetyBusyFor(requestedViewer);
    const result = await reportProfileContent({
      targetAccountId: detail.profile.id,
      reason: 'other',
      comment: handle,
    });
    if (!viewerIsCurrent(requestedViewer)) return;
    setSafetyBusyFor(null);
    showToast(result.ok ? cs.friends.reportDone : result.detail);
  }, [detail, handle, safetyBusy, showToast, viewerAccountId, viewerIsCurrent]);

  const blockProfile = useCallback(async () => {
    if (!detail || safetyBusy || !viewerAccountId) return;
    const requestedViewer = viewerAccountId;
    setSafetyBusyFor(requestedViewer);
    const result = await blockFriend(detail.profile.id);
    if (!viewerIsCurrent(requestedViewer)) return;
    if (!result.ok) {
      setSafetyBusyFor(null);
      showToast(result.detail);
      return;
    }
    setDetail((current) => current
      ? {
          ...current,
          blocked: true,
          isFriend: false,
          friendshipId: null,
          friendshipStatus: 'none',
          incomingRequestId: null,
          liveActivity: null,
          plan: null,
        }
      : current);
    setNights([]);
    setNightsCursor(null);
    await notifyNightFeedSafetyChange({
      viewerAccountId,
      targetAccountId: detail.profile.id,
      blocked: true,
    });
    if (!viewerIsCurrent(requestedViewer)) return;
    setSafetyBusyFor(null);
    showToast(cs.friends.blocked);
  }, [detail, safetyBusy, showToast, viewerAccountId, viewerIsCurrent]);

  const confirmReportProfile = useCallback(() => {
    showAppDialog({
      title: cs.profile.report.confirmTitle,
      message: cs.profile.report.confirmBody(handle),
      buttons: [
        { text: cs.common.cancel, style: 'cancel' },
        {
          text: cs.profile.report.confirmSubmit,
          style: 'destructive',
          onPress: () => void reportProfile(),
        },
      ],
    });
  }, [handle, reportProfile]);

  const confirmBlockProfile = useCallback(() => {
    showAppDialog({
      title: cs.friends.blockTitle(handle),
      message: cs.friends.blockBody,
      buttons: [
        { text: cs.common.cancel, style: 'cancel' },
        {
          text: cs.friends.blockConfirm,
          style: 'destructive',
          onPress: () => void blockProfile(),
        },
      ],
    });
  }, [blockProfile, handle]);

  const openProfileActions = useCallback(() => {
    if (!detail || safetyBusy) return;
    if (detail.blocked) {
      showAppDialog({
        title: cs.friends.rowActionsTitle,
        buttons: [
          { text: cs.friends.unblockAction, onPress: () => void unblockProfile() },
          { text: cs.common.cancel, style: 'cancel' },
        ],
      });
      return;
    }
    showAppDialog({
      title: cs.friends.rowActionsTitle,
      buttons: [
        { text: cs.friends.reportAction, onPress: confirmReportProfile },
        { text: cs.friends.blockAction, style: 'destructive', onPress: confirmBlockProfile },
        { text: cs.common.cancel, style: 'cancel' },
      ],
    });
  }, [confirmBlockProfile, confirmReportProfile, detail, safetyBusy, unblockProfile]);

  const loadMore = async () => {
    if (!accountId || !nightsCursor || moreLoading || !viewerAccountId) return;
    const requestedViewer = viewerAccountId;
    const requestedCursor = nightsCursor;
    const controller = new AbortController();
    moreControllerRef.current?.abort();
    moreControllerRef.current = controller;
    setMoreLoadingFor(requestedViewer);
    const result = await fetchProfileNights(accountId, requestedCursor, controller.signal);
    if (controller.signal.aborted || !viewerIsCurrent(requestedViewer)) return;
    setMoreLoadingFor(null);
    if (!result.ok) {
      setNightsError(true);
      return;
    }
    setNights((current) => mergeNightPages(current ?? [], result.nights));
    setNightsCursor(result.nextCursor);
  };

  const applyReaction = useCallback((nightId: string, rounds: number, myRound: boolean) => {
    if (!viewerIsCurrent(viewerAccountId)) return;
    setNights((current) => current
      ? replaceNightReaction(current, nightId, rounds, myRound)
      : current);
  }, [viewerAccountId, viewerIsCurrent]);
  const { reactingIds, toggleReaction } = useNightReaction(applyReaction, showToast);
  const removeNight = useCallback((removed: PublishedNight) => {
    if (!viewerIsCurrent(viewerAccountId)) return;
    setNights((current) => current?.filter((night) => night.id !== removed.id) ?? current);
  }, [viewerAccountId, viewerIsCurrent]);
  const openNightActions = useNightActions(removeNight);

  const openNight = useCallback((night: PublishedNight) => {
    router.push(`/night/${encodeURIComponent(night.id)}` as Href);
  }, [router]);

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

  const relationshipOn =
    !detail.blocked && (detail.friendshipStatus === 'accepted' || following);
  const relationshipDisabled = relationshipBusy || safetyBusy;

  return (
    <View style={styles.screen}>
      <View style={[styles.top, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={() => leaveRoute(router)}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Zpět"
          hitSlop={8}
        >
          <ChevronLeftIcon size={20} color={Colors.foam} />
        </Pressable>
        <Pressable
          onPress={openProfileActions}
          disabled={safetyBusy}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityState={{ disabled: safetyBusy }}
          accessibilityLabel="Další možnosti profilu"
          hitSlop={8}
        >
          <MenuIcon size={19} color={Colors.foam} />
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
            disabled={relationshipDisabled}
            style={({ pressed }) => [
              styles.action,
              relationshipOn ? styles.actionOn : styles.actionPrimary,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: relationshipDisabled, selected: relationshipOn }}
            accessibilityLabel={relationshipLabel(detail, following)}
          >
            {relationshipOn ? (
              <CheckIcon size={17} color={Colors.amber} />
            ) : (
              <PlusIcon size={17} color={Colors.stout} />
            )}
            <Text style={[styles.actionText, relationshipOn && styles.actionTextOn]} maxFontSizeMultiplier={FontScaleCap.body}>
              {relationshipDisabled ? 'Chvilku…' : relationshipLabel(detail, following)}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              if (viewerAccountId) setComposeOpenFor(viewerAccountId);
            }}
            disabled={!detail.isFriend || detail.blocked}
            style={({ pressed }) => [
              styles.action,
              styles.actionGhost,
              (!detail.isFriend || detail.blocked) && styles.actionDisabled,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !detail.isFriend || detail.blocked }}
            accessibilityLabel={`Pozvat ${handle} na pivo`}
          >
            <BeerIcon size={17} color={Colors.foam} />
            <Text style={[styles.actionText, styles.actionTextGhost]} maxFontSizeMultiplier={FontScaleCap.body}>
              Na pivo?
            </Text>
          </Pressable>
        </View>

        {detail.blocked ? (
          <View style={styles.blockedState}>
            <Text style={styles.activityTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.friends.profileBlocked}
            </Text>
          </View>
        ) : (
          <UnderlineTabs options={TABS} value={tab} onChange={setTab} inset={MockLayout.screenPad} />
        )}

        {!detail.blocked && tab === 'Statistiky' ? (
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
        ) : !detail.blocked ? (
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
              <FeedCard
                key={night.id}
                night={night}
                first={index === 0}
                reacting={reactingIds.has(night.id)}
                onToggleReaction={!night.isMine ? toggleReaction : undefined}
                onOpenNight={openNight}
                onOpenActions={openNightActions}
              />
            ))}
            {nightsCursor ? (
              <Pressable onPress={() => void loadMore()} disabled={moreLoading} style={styles.more} accessibilityRole="button">
                <Text style={styles.moreText}>{moreLoading ? 'Dotahuju…' : 'Starší večery'}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {composeOpen ? (
        <ComposeSheet
          friends={[detail.profile]}
          fixedRecipientIds={[detail.profile.id]}
          onSubmitted={() => undefined}
          onClose={() => setComposeOpenFor(null)}
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
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: MockLayout.screenPad,
    paddingBottom: Spacing.sm,
  },
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
  blockedState: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  activityTitle: { fontSize: 18, fontWeight: '800', color: Colors.foam, textAlign: 'center' },
  more: { minHeight: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 14, fontWeight: '800', color: Colors.amber },
});
