/**
 * PhotoContestScreen — the FotoPivař arena (/photo-contest).
 *
 * One biweekly round: enter one diary photo, give one vote, top 3 win. The
 * screen is a single scroll: countdown header → my-entry area (enter strip or
 * my entry card) → a two-column staggered gallery of entries → last round's
 * podium.
 *
 * Voting is optimistic with MOVE semantics (one vote total): tapping another
 * entry shifts my vote locally on both counts before the server confirms; a
 * hard reject restores the pre-tap snapshot and toasts. Entering/withdrawing
 * are online-only and always reconcile via a fresh snapshot fetch.
 *
 * Long-pressing a foreign entry opens the report flow (content-reports with
 * reason 'inappropriate_photo', pinned to the photo id when the backend
 * surfaces it on the entry).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { AppDialogHost, showAppDialog } from '@/components/shared/AppDialog';
import { GlowButton } from '@/components/shared/GlowButton';
import {
  BeerIcon,
  CameraIcon,
  ChevronLeftIcon,
  EllipsisIcon,
  MapPinIcon,
  TrophyIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { reportProfileContent } from '@/data/auth';
import type { FriendActionError } from '@/data/friendsClient';
import {
  clearPhotoContestVote,
  enterPhotoContest,
  fetchPhotoContest,
  votePhotoContest,
  withdrawPhotoContestEntry,
  type PhotoContestEntry,
  type PhotoContestSnapshot,
  type PhotoContestWinner,
} from '@/data/photoContestClient';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { cs } from '@/i18n/cs';
import { BeerPhotoCaptureFlow } from '@/photos/BeerPhotoCaptureFlow';
import { contestCountdownLabel } from '@/photos/contestCountdown';
import { ScalePressable } from '@/photos/ScalePressable';
import { Avatar } from '@/profile/Avatar';
import { loadBeerPhotos, useBeerPhotosStore } from '@/stores/beerPhotosStore';
import { useContestResultsStore } from '@/stores/contestResultsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { amberGlow } from '@/theme/shadows';
import { fireLightImpactHaptic, fireSuccessHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';

type LoadState = 'loading' | 'loaded' | 'error';

/** Cap the stagger so a long gallery never keeps late tiles invisible. */
const REVEAL_STEP_MS = 60;
const REVEAL_MAX_STEPS = 8;
const ENTRY_FRAME = require('../../assets/images/photo-contest/entry-frame.png');

function nameOf(entry: PhotoContestEntry | PhotoContestWinner): string {
  const p = entry.account;
  return p.nickname ? `@${p.nickname}` : p.displayName || 'Pivař';
}

/** Staggered fade + translateY reveal for gallery tiles on first mount. */
function Reveal({
  index,
  reduceMotion,
  children,
}: {
  index: number;
  reduceMotion: boolean;
  children: React.ReactNode;
}) {
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(
      Math.min(index, REVEAL_MAX_STEPS) * REVEAL_STEP_MS,
      withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }),
    );
  }, [index, reduceMotion, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 16 }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** The vote pill — BeerIcon + count, amber-filled when my vote sits here. */
function VotePill({
  entry,
  onPress,
}: {
  entry: PhotoContestEntry;
  onPress: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const countScale = useSharedValue(1);
  const prevVotesRef = useRef(entry.votes);

  // Numeral pop on increment only (CheersPill idiom).
  useEffect(() => {
    if (entry.votes > prevVotesRef.current && !reduceMotion) {
      countScale.value = withSequence(
        withTiming(1.15, { duration: 120, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) }),
      );
    }
    prevVotesRef.current = entry.votes;
  }, [entry.votes, reduceMotion, countScale]);

  const numeralStyle = useAnimatedStyle(() => ({ transform: [{ scale: countScale.value }] }));

  const glyphColor = entry.isMine
    ? Colors.mutedText
    : entry.myVote
      ? Colors.amber
      : Colors.mutedText;

  return (
    <Pressable
      onPress={onPress}
      disabled={entry.isMine}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ selected: entry.myVote, disabled: entry.isMine }}
      accessibilityLabel={
        entry.myVote ? cs.a11y.contestUnvote(nameOf(entry)) : cs.a11y.contestVote(nameOf(entry))
      }
      style={({ pressed }) => [
        styles.votePill,
        entry.myVote && styles.votePillActive,
        entry.isMine && styles.votePillMine,
        pressed && styles.pressedDim,
      ]}
    >
      <BeerIcon size={15} color={glyphColor} />
      <Animated.Text
        style={[styles.votePillText, entry.myVote && styles.votePillTextActive, numeralStyle]}
        numberOfLines={1}
        allowFontScaling={false}
      >
        {cs.photoContest.votesCount(entry.votes)}
      </Animated.Text>
    </Pressable>
  );
}

/**
 * One gallery tile: photo + author footer + vote pill. The report action is a
 * VISIBLE overflow button (screen-reader reachable, discoverable); long-press
 * on the tile stays as a shortcut. The overflow button is a SIBLING of the
 * tile pressable, not a child — a Pressable nested inside the tile's
 * ScalePressable did not receive taps reliably, so it overlays the tile from
 * a shared wrapper instead.
 */
function EntryTile({
  entry,
  tall,
  onVote,
  onActions,
  onOpenPhoto,
  onOpenProfile,
}: {
  entry: PhotoContestEntry;
  tall: boolean;
  onVote: () => void;
  onActions: () => void;
  onOpenPhoto: () => void;
  onOpenProfile: () => void;
}) {
  const [imageWidth, setImageWidth] = useState(0);

  return (
    <View style={styles.entryTile}>
      <ScalePressable
        onPress={(event) => {
          const { locationX, locationY } = event.nativeEvent;
          const hitOverflow =
            !entry.isMine && imageWidth > 0 && locationY <= 52 && locationX >= imageWidth - 52;
          if (hitOverflow) onActions();
          else onOpenPhoto();
        }}
        onLongPress={entry.isMine ? undefined : onActions}
        onLayout={(event) => setImageWidth(event.nativeEvent.layout.width)}
        accessibilityRole="button"
        accessibilityLabel={cs.a11y.contestOpenPhoto(nameOf(entry))}
        accessibilityHint={entry.isMine ? undefined : cs.a11y.contestPhotoActionsHint}
        accessibilityActions={
          entry.isMine
            ? undefined
            : [{ name: 'longpress', label: cs.a11y.contestEntryActions(nameOf(entry)) }]
        }
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'longpress') onActions();
        }}
        style={[styles.entryImageWrap, tall ? styles.entryImageTall : styles.entryImageShort]}
      >
        <Image
          source={{ uri: entry.imageUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
        {entry.isMine ? (
          <View style={styles.mineChip}>
            <Text style={styles.mineChipText} allowFontScaling={false}>
              {cs.photoContest.myEntryBadge}
            </Text>
          </View>
        ) : null}
      </ScalePressable>
      <View style={styles.entryFooter}>
        <Pressable
          onPress={entry.isMine ? undefined : onOpenProfile}
          disabled={entry.isMine}
          hitSlop={4}
          accessibilityRole={entry.isMine ? undefined : 'button'}
          accessibilityLabel={entry.isMine ? undefined : cs.a11y.contestOpenProfile(nameOf(entry))}
          style={({ pressed }) => [styles.entryAuthorRow, pressed && styles.pressedDim]}
        >
          <Avatar
            uri={entry.account.avatarUrl}
            nickname={entry.account.nickname}
            displayName={entry.account.displayName}
            size={22}
          />
          <Text style={styles.entryAuthor} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {nameOf(entry)}
          </Text>
        </Pressable>
        {entry.pubName ? (
          <View style={styles.entryPubRow}>
            <MapPinIcon size={11} color={Colors.mutedText} />
            <Text style={styles.entryPub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
              {entry.pubName}
            </Text>
          </View>
        ) : null}
        <VotePill entry={entry} onPress={onVote} />
      </View>
      {entry.isMine ? null : (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.entryOverflow}
        >
          <EllipsisIcon size={16} color={Colors.foam} />
        </View>
      )}
    </View>
  );
}

/** Podium tile for the last round (rank 1 leads, 2–3 flank). */
function WinnerTile({ winner, lead }: { winner: PhotoContestWinner; lead: boolean }) {
  return (
    <View style={[styles.winnerTile, lead && styles.winnerTileLead]}>
      <View
        style={[styles.winnerImageWrap, lead ? styles.winnerImageLead : styles.winnerImageSide, lead && amberGlow(10)]}
      >
        <Image
          source={{ uri: winner.imageUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      </View>
      {lead ? (
        <View style={styles.winnerCrown}>
          <TrophyIcon size={13} color={Colors.stout} />
          <Text style={styles.winnerCrownText} allowFontScaling={false}>
            {cs.photoContest.title}
          </Text>
        </View>
      ) : (
        <Text style={styles.winnerRank} allowFontScaling={false}>
          {cs.photoContest.winnerRank(winner.rank)}
        </Text>
      )}
      <Text style={styles.winnerName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {nameOf(winner)}
      </Text>
      <Text style={styles.winnerVotes} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.photoContest.votesCount(winner.votes)}
      </Text>
    </View>
  );
}

export default function PhotoContestScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const showToast = useToastStore((s) => s.show);

  const [state, setState] = useState<LoadState>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState<PhotoContestSnapshot | null>(null);
  const [viewerEntry, setViewerEntry] = useState<PhotoContestEntry | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  // Optimistic working copy of the entries (votes flip here before the server).
  const [entries, setEntries] = useState<PhotoContestEntry[]>([]);
  // Bumped whenever a fresh server snapshot replaces `entries`; a vote revert
  // captured against an older generation must not clobber the newer truth.
  const entriesGenRef = useRef(0);
  const voteBusyRef = useRef(false);
  const actionBusyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Select the raw array (stable reference) and derive with useMemo — a
  // filtering selector would return a fresh array every snapshot and loop the
  // render (zustand 5 has no selector memoization).
  const allPhotos = useBeerPhotosStore((s) => s.photos);
  const myPhotos = useMemo(
    () => allPhotos.filter((p) => p.syncState === 'synced' && p.id != null),
    [allPhotos],
  );

  // Never sets state synchronously (React Compiler rule): the pull-to-refresh
  // spinner is flipped on in the RefreshControl handler, off here after await.
  const load = useCallback(async () => {
    const snap = await fetchPhotoContest();
    if (!mountedRef.current) return;
    setRefreshing(false);
    if (!snap) {
      // Keep showing stale-but-real data over an error screen on a failed refresh.
      setState((prev) => (prev === 'loaded' ? prev : 'error'));
      return;
    }
    setSnapshot(snap);
    setEntries(snap.entries);
    entriesGenRef.current += 1;
    setState('loaded');
    // Feed the results store: queue a podium celebration first, then mark the
    // round's results as seen (the user is looking at the podium right now).
    // markResultsSeen skips rounds owned by a queued celebration, so the modal
    // still pops over this screen and advances the baseline on dismiss.
    void (async () => {
      const results = useContestResultsStore.getState();
      await results.ingestSnapshot(snap);
      const lastId = snap.lastResults?.contest.id;
      if (lastId) results.markResultsSeen(lastId);
    })();
  }, []);

  useEffect(() => {
    // Deferred kickoff (FriendsScreen idiom) — keeps the effect body free of
    // synchronous state writes. The enter strip additionally needs my synced
    // diary photos even when the profile section has not mounted this session.
    const kickoff = setTimeout(() => {
      void load();
      void loadBeerPhotos();
    }, 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  const retry = useCallback(() => {
    setState('loading');
    void load();
  }, [load]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/profile' as Href);
  }, [router]);

  // ── Voting (optimistic move semantics) ────────────────────────────────────

  const applyVote = useCallback((targetId: string | null) => {
    setEntries((prev) =>
      prev.map((entry) => {
        const shouldHold = entry.id === targetId;
        if (entry.myVote === shouldHold) return entry;
        return {
          ...entry,
          myVote: shouldHold,
          votes: Math.max(0, entry.votes + (shouldHold ? 1 : -1)),
        };
      }),
    );
  }, []);

  const handleVote = useCallback(
    (entry: PhotoContestEntry) => {
      if (entry.isMine || voteBusyRef.current) return;
      voteBusyRef.current = true;
      const previous = entries;
      const generation = entriesGenRef.current;
      const retracting = entry.myVote;

      applyVote(retracting ? null : entry.id);
      if (useSettingsStore.getState().hapticEnabled) {
        if (retracting) fireLightImpactHaptic();
        else fireSuccessHaptic();
      }

      const settle = (res: { ok: true; entryId?: string; votes?: number } | FriendActionError) => {
        voteBusyRef.current = false;
        if (!mountedRef.current) return;
        if (!res.ok) {
          // Hard reject (finished round, own entry, network…): restore the
          // tap-time snapshot — but only if no fresher server snapshot landed
          // meanwhile (that one already carries the truth; reverting would
          // clobber it with stale counts).
          if (generation === entriesGenRef.current) setEntries(previous);
          showToast(
            res.code === 'cannot_vote_own'
              ? cs.photoContest.errorCannotVoteOwn
              : res.detail || cs.photoContest.errorVote,
          );
          return;
        }
        const { entryId, votes } = res;
        if (!retracting && typeof entryId === 'string' && typeof votes === 'number') {
          // Reconcile the target with the server's fresh tally.
          setEntries((cur) =>
            cur.map((e) => (e.id === entryId ? { ...e, votes, myVote: true } : e)),
          );
        }
      };
      if (retracting) void clearPhotoContestVote().then(settle);
      else void votePhotoContest(entry.id).then(settle);
    },
    [entries, applyVote, showToast],
  );

  // ── Enter / withdraw ──────────────────────────────────────────────────────

  const doEnter = useCallback(
    async (photoId: string) => {
      if (actionBusyRef.current) return;
      actionBusyRef.current = true;
      const res = await enterPhotoContest(photoId);
      actionBusyRef.current = false;
      if (!mountedRef.current) return;
      if (res.ok) {
        showToast(cs.photoContest.enteredToast, {
          icon: <TrophyIcon size={18} color={Colors.amber} />,
        });
        void load();
        void loadBeerPhotos();
        return;
      }
      showToast(
        res.code === 'nickname_required'
          ? cs.photoContest.errorNicknameRequired
          : res.detail || cs.photoContest.errorEnter,
      );
    },
    [showToast, load],
  );

  const confirmEnter = useCallback(
    (photoId: string) => {
      showAppDialog({
        title: cs.photoContest.enterConfirmTitle,
        message: cs.photoContest.enterConfirmBody,
        buttons: [
          { text: cs.common.cancel, style: 'cancel' },
          { text: cs.photoContest.enterCta, onPress: () => void doEnter(photoId) },
        ],
      });
    },
    [doEnter],
  );

  const doWithdraw = useCallback(async () => {
    if (actionBusyRef.current) return;
    actionBusyRef.current = true;
    const res = await withdrawPhotoContestEntry();
    actionBusyRef.current = false;
    if (!mountedRef.current) return;
    if (res.ok) {
      showToast(cs.photoContest.withdrawnToast);
      void load();
      void loadBeerPhotos();
      return;
    }
    showToast(res.detail || cs.photoContest.errorGeneric);
  }, [showToast, load]);

  const confirmWithdraw = useCallback(() => {
    showAppDialog({
      title: cs.photoContest.withdrawConfirmTitle,
      message: cs.photoContest.withdrawConfirmBody,
      buttons: [
        { text: cs.common.cancel, style: 'cancel' },
        { text: cs.photoContest.withdrawCta, style: 'destructive', onPress: () => void doWithdraw() },
      ],
    });
  }, [doWithdraw]);

  // ── Reporting ─────────────────────────────────────────────────────────────

  const doReport = useCallback(
    (entry: PhotoContestEntry) => {
      void reportProfileContent({
        targetAccountId: entry.account.id,
        reason: 'inappropriate_photo',
        photoId: entry.photoId ?? undefined,
        // Without a photo id on the wire, the entry id keeps moderation context.
        comment: entry.photoId ? '' : `contest entry ${entry.id}`,
      }).then((res) => {
        if (!mountedRef.current) return;
        showToast(res.ok ? cs.photoContest.reportedToast : res.detail || cs.photoContest.errorGeneric);
      });
    },
    [showToast],
  );

  const openProfile = useCallback(
    (entry: PhotoContestEntry) => {
      if (entry.isMine) {
        router.push('/profile' as Href);
        return;
      }
      router.push({ pathname: '/parta/[id]', params: { id: entry.account.id } } as Href);
    },
    [router],
  );

  const confirmReport = useCallback(
    (entry: PhotoContestEntry) => {
      showAppDialog({
        title: cs.photoContest.reportConfirmTitle,
        message: cs.photoContest.reportConfirmBody,
        buttons: [
          { text: cs.common.cancel, style: 'cancel' },
          { text: cs.photoContest.reportAction, style: 'destructive', onPress: () => doReport(entry) },
        ],
      });
    },
    [doReport],
  );

  const openEntryActions = useCallback(
    (entry: PhotoContestEntry) => {
      if (entry.isMine) return;
      showAppDialog({
        title: cs.photoContest.entryActionsTitle(nameOf(entry)),
        buttons: [
          { text: cs.photoContest.openPhotoAction, onPress: () => setViewerEntry(entry) },
          { text: cs.photoContest.openProfileAction, onPress: () => openProfile(entry) },
          { text: cs.photoContest.reportAction, style: 'destructive', onPress: () => confirmReport(entry) },
          { text: cs.common.cancel, style: 'cancel' },
        ],
      });
    },
    [confirmReport, openProfile],
  );

  // ── Derived ───────────────────────────────────────────────────────────────

  const contest = snapshot?.contest ?? null;
  const myEntry = useMemo(() => entries.find((e) => e.isMine) ?? null, [entries]);
  const countdown = contest ? contestCountdownLabel(contest.periodEnd) : '';
  const lastResults = snapshot?.lastResults ?? null;
  const winners = useMemo(() => {
    const list = [...(lastResults?.winners ?? [])].sort((a, b) => a.rank - b.rank);
    return list.slice(0, 3);
  }, [lastResults]);
  // Podium order: 2nd — 1st — 3rd.
  const podium = useMemo(() => {
    if (winners.length === 0) return [];
    const byRank = (rank: number) => winners.find((w) => w.rank === rank) ?? null;
    return [byRank(2), byRank(1), byRank(3)].filter(
      (w): w is PhotoContestWinner => w != null,
    );
  }, [winners]);

  // Two staggered columns; the right one starts lower for the masonry feel.
  const columns = useMemo(() => {
    const left: { entry: PhotoContestEntry; index: number }[] = [];
    const right: { entry: PhotoContestEntry; index: number }[] = [];
    entries.forEach((entry, index) => {
      (index % 2 === 0 ? left : right).push({ entry, index });
    });
    return { left, right };
  }, [entries]);

  const enterablePhotos = useMemo(
    () => myPhotos.filter((p) => !p.inContest).slice(0, 12),
    [myPhotos],
  );

  const renderColumn = (
    column: { entry: PhotoContestEntry; index: number }[],
    columnOffset: boolean,
  ) => (
    <View style={[styles.galleryColumn, columnOffset && styles.galleryColumnOffset]}>
      {column.map(({ entry, index }, i) => (
        <Reveal key={entry.id} index={index} reduceMotion={reduceMotion}>
          <EntryTile
            entry={entry}
            // Alternate tall/short per column position for the layout variance.
            tall={(i + (columnOffset ? 1 : 0)) % 2 === 0}
            onVote={() => handleVote(entry)}
            onActions={() => openEntryActions(entry)}
            onOpenPhoto={() => setViewerEntry(entry)}
            onOpenProfile={() => openProfile(entry)}
          />
        </Reveal>
      ))}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.sm }]}>
      {/* Header — back · title */}
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          style={({ pressed }) => [styles.headerBtn, pressed && styles.pressedDim]}
        >
          <ChevronLeftIcon size={26} color={Colors.foam} />
        </Pressable>
        <View style={styles.headerTitleRow}>
          <TrophyIcon size={18} color={Colors.amber} />
          <Text style={styles.headerTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.photoContest.title}
          </Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {state === 'loading' ? (
        <View style={styles.skeletonWrap}>
          <SkeletonBlock width="70%" height={26} reduceMotion={reduceMotion} />
          <SkeletonBlock width="45%" height={16} reduceMotion={reduceMotion} />
          <SkeletonBlock width="100%" height={132} radius={Radius.cardLarge} reduceMotion={reduceMotion} />
          <View style={styles.skeletonRow}>
            <SkeletonBlock width="48%" height={200} radius={Radius.card} reduceMotion={reduceMotion} />
            <SkeletonBlock width="48%" height={168} radius={Radius.card} reduceMotion={reduceMotion} />
          </View>
          <View style={styles.skeletonRow}>
            <SkeletonBlock width="48%" height={168} radius={Radius.card} reduceMotion={reduceMotion} />
            <SkeletonBlock width="48%" height={200} radius={Radius.card} reduceMotion={reduceMotion} />
          </View>
        </View>
      ) : state === 'error' ? (
        <View style={styles.centerBlock}>
          <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.photoContest.loadError}
          </Text>
          <View style={styles.errorCta}>
            <GlowButton
              label={cs.photoContest.retry}
              onPress={retry}
              variant="secondary"
              glow="none"
              height={50}
            />
          </View>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={Colors.amber}
            />
          }
        >
          {/* Round hero */}
          {countdown ? (
            <Text style={styles.countdown} maxFontSizeMultiplier={FontScaleCap.heading}>
              {countdown}
            </Text>
          ) : null}
          <Text style={styles.subtitle} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.photoContest.subtitle}
          </Text>

          {/* Reigning winner — the traveling golden coaster: last round's
              winning photo stays featured while the new round runs. */}
          {contest && winners.length > 0 && winners[0].rank === 1 ? (
            <View style={styles.reigningStrip}>
              <View style={styles.reigningThumbWrap}>
                <Image
                  source={{ uri: winners[0].imageUrl }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                  accessibilityIgnoresInvertColors
                />
              </View>
              <View style={styles.reigningTextCol}>
                <View style={styles.reigningTitleRow}>
                  <TrophyIcon size={13} color={Colors.amber} />
                  <Text style={styles.reigningTitle} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.photoContest.reigningTitle}
                  </Text>
                </View>
                <Text style={styles.reigningName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {nameOf(winners[0])}
                </Text>
                <Text style={styles.reigningVotes} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.photoContest.votesCount(winners[0].votes)}
                </Text>
              </View>
            </View>
          ) : null}

          {!contest ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.photoContest.noContest}
              </Text>
            </View>
          ) : (
            <>
              {/* ── My entry ── */}
              <Text style={styles.sectionHeader}>{cs.photoContest.myEntryHeader}</Text>
              {myEntry ? (
                <View style={styles.myEntryCard}>
                  <View style={styles.myEntryThumbWrap}>
                    <Image
                      source={{ uri: myEntry.imageUrl }}
                      style={StyleSheet.absoluteFill}
                      resizeMode="cover"
                      accessibilityIgnoresInvertColors
                    />
                  </View>
                  <View style={styles.myEntryBody}>
                    <Text style={styles.myEntryVotes} maxFontSizeMultiplier={FontScaleCap.heading}>
                      {cs.photoContest.votesCount(myEntry.votes)}
                    </Text>
                    {myEntry.caption ? (
                      <Text style={styles.myEntryCaption} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
                        {myEntry.caption}
                      </Text>
                    ) : null}
                    <Pressable
                      onPress={confirmWithdraw}
                      style={({ pressed }) => [styles.withdrawPill, pressed && styles.pressedDim]}
                      accessibilityRole="button"
                      accessibilityLabel={cs.photoContest.withdrawCta}
                      hitSlop={4}
                    >
                      <Text style={styles.withdrawPillText} maxFontSizeMultiplier={FontScaleCap.body}>
                        {cs.photoContest.withdrawCta}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.enterCard}>
                  <View style={styles.enterTitleRow}>
                    <View style={styles.enterIconWell}>
                      <CameraIcon size={18} color={Colors.amber} />
                    </View>
                    <Text style={styles.enterTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                      {cs.photoContest.enterCardTitle}
                    </Text>
                  </View>
                  <Text style={styles.enterHint} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.photoContest.enterCardHint}
                  </Text>
                  <GlowButton
                    label={cs.photoContest.takePhotoCta}
                    onPress={() => setCaptureOpen(true)}
                    glow="soft"
                    height={52}
                    icon={<CameraIcon size={18} color={Colors.stout} />}
                  />
                  {enterablePhotos.length > 0 ? (
                    <>
                      <View style={styles.enterDivider}>
                        <View style={styles.enterDividerLine} />
                        <Text style={styles.enterDividerText} allowFontScaling={false}>
                          {cs.photoContest.pickFromDiary}
                        </Text>
                        <View style={styles.enterDividerLine} />
                      </View>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.enterStrip}
                      >
                        {enterablePhotos.map((photo) => (
                          <ScalePressable
                            key={photo.clientId}
                            onPress={() => photo.id && confirmEnter(photo.id)}
                            style={styles.enterThumb}
                            accessibilityRole="button"
                            accessibilityLabel={cs.a11y.contestPickMyPhoto(photo.caption || photo.pubName)}
                          >
                            {photo.imageUrl ? (
                              <Image
                                source={{ uri: photo.imageUrl }}
                                style={StyleSheet.absoluteFill}
                                resizeMode="cover"
                                accessibilityIgnoresInvertColors
                              />
                            ) : null}
                          </ScalePressable>
                        ))}
                      </ScrollView>
                    </>
                  ) : (
                    <Text style={styles.enterEmptyHint} maxFontSizeMultiplier={FontScaleCap.body}>
                      {cs.photoContest.enterNoPhotos}
                    </Text>
                  )}
                </View>
              )}

              {/* ── Entries gallery ── */}
              <Text style={styles.sectionHeader}>{cs.photoContest.entriesHeader}</Text>
              {entries.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.photoContest.emptyEntries}
                  </Text>
                </View>
              ) : (
                <View style={styles.gallery}>
                  {renderColumn(columns.left, false)}
                  {renderColumn(columns.right, true)}
                </View>
              )}
            </>
          )}

          {/* ── Last round podium ── */}
          {lastResults && podium.length > 0 ? (
            <>
              <Text style={styles.sectionHeader}>{cs.photoContest.winnersHeader}</Text>
              <View style={styles.podiumRow}>
                {podium.map((winner) => (
                  <WinnerTile key={winner.rank} winner={winner} lead={winner.rank === 1} />
                ))}
              </View>
              <Text style={styles.winnerNote} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.photoContest.winnerBadgeNote}
              </Text>
            </>
          ) : null}
        </ScrollView>
      )}

      <Modal
        visible={viewerEntry != null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setViewerEntry(null)}
      >
        <View style={styles.viewerBackdrop}>
          <Pressable
            onPress={() => setViewerEntry(null)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.photoViewerClose}
            style={({ pressed }) => [
              styles.viewerClose,
              { top: insets.top + Spacing.sm },
              pressed && styles.pressedDim,
            ]}
          >
            <XIcon size={22} color={Colors.foam} />
          </Pressable>
          {viewerEntry ? (
            <>
              <View
                style={[
                  styles.viewerStage,
                  {
                    width: Math.min(screenWidth - Spacing.md, 430),
                    height: Math.min(screenWidth - Spacing.md, 430) * (4 / 3),
                    marginTop: insets.top + Spacing.xl,
                  },
                ]}
              >
                <View style={styles.viewerPhotoWell}>
                  <Image
                    source={{ uri: viewerEntry.imageUrl }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="contain"
                    accessibilityIgnoresInvertColors
                  />
                </View>
                <View
                  style={styles.viewerFrameOverlay}
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <Image
                    source={ENTRY_FRAME}
                    style={styles.viewerFrameImage}
                    resizeMode="stretch"
                  />
                </View>
              </View>
              <View style={[styles.viewerMeta, { paddingBottom: insets.bottom + Spacing.lg }]}>
                <Pressable
                  onPress={() => {
                    const entry = viewerEntry;
                    setViewerEntry(null);
                    setTimeout(() => openProfile(entry), 0);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.contestOpenProfile(nameOf(viewerEntry))}
                  style={({ pressed }) => [styles.viewerAuthorRow, pressed && styles.pressedDim]}
                >
                  <Avatar
                    uri={viewerEntry.account.avatarUrl}
                    nickname={viewerEntry.account.nickname}
                    displayName={viewerEntry.account.displayName}
                    size={28}
                  />
                  <Text
                    style={styles.viewerAuthor}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {nameOf(viewerEntry)}
                  </Text>
                </Pressable>
                {viewerEntry.caption ? (
                  <Text style={styles.viewerCaption} maxFontSizeMultiplier={FontScaleCap.body}>
                    {viewerEntry.caption}
                  </Text>
                ) : null}
                {viewerEntry.pubName ? (
                  <View style={styles.viewerPubRow}>
                    <MapPinIcon size={14} color={Colors.amber} />
                    <Text
                      style={styles.viewerPub}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {[viewerEntry.pubName, viewerEntry.pubCity].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : null}
        </View>
      </Modal>
      <BeerPhotoCaptureFlow
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        directSource="camera"
        initialContestEntry
        onContestEntered={() => {
          void load();
          void loadBeerPhotos();
        }}
      />
      <AppDialogHost />
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
  headerTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  headerTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 20,
    color: Colors.foam,
  },

  // — Loading / error —
  skeletonWrap: {
    gap: Spacing.md,
    paddingTop: Spacing.lg,
  },
  skeletonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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

  content: {
    paddingTop: Spacing.md,
  },
  countdown: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.amber,
  },
  subtitle: {
    marginTop: 4,
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.mutedText,
  },
  reigningStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.lg,
    padding: Spacing.sm + 2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.35),
    backgroundColor: withAlpha(Colors.amber, 0.07),
  },
  reigningThumbWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.medium,
    overflow: 'hidden',
    backgroundColor: Colors.stout3,
  },
  reigningTextCol: {
    flex: 1,
    minWidth: 0,
  },
  reigningTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  reigningTitle: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Colors.amber,
  },
  reigningName: {
    marginTop: 2,
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.foam,
  },
  reigningVotes: {
    marginTop: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.foamMuted,
  },
  sectionHeader: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm + 2,
    marginLeft: 4,
  },

  // — My entry —
  myEntryCard: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.35),
    padding: Spacing.md,
  },
  myEntryThumbWrap: {
    width: 96,
    height: 120,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
    overflow: 'hidden',
  },
  myEntryBody: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  myEntryVotes: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  myEntryCaption: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.foamMuted,
  },
  withdrawPill: {
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.xs,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
  },
  withdrawPillText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foamMuted,
  },

  // — Enter card —
  enterCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  enterTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  enterIconWell: {
    width: 36,
    height: 36,
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  enterTitle: {
    flex: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
  },
  enterHint: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.mutedText,
  },
  enterDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  enterDividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  enterDividerText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 9,
    letterSpacing: 1,
    color: Colors.mutedText,
  },
  enterEmptyHint: {
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  enterStrip: {
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  enterThumb: {
    width: 84,
    height: 104,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
    overflow: 'hidden',
  },

  // — Gallery —
  gallery: {
    flexDirection: 'row',
    gap: Spacing.sm + 2,
  },
  galleryColumn: {
    flex: 1,
    gap: Spacing.sm + 2,
  },
  galleryColumnOffset: {
    marginTop: Spacing.xl,
  },
  entryTile: {
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    overflow: 'hidden',
  },
  entryImageWrap: {
    width: '100%',
    backgroundColor: Colors.stout3,
  },
  entryImageTall: {
    aspectRatio: 3 / 4,
  },
  entryImageShort: {
    aspectRatio: 1,
  },
  mineChip: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.stout, 0.85),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.5),
  },
  mineChipText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 9,
    letterSpacing: 0.4,
    color: Colors.amber,
    textTransform: 'uppercase',
  },
  entryOverflow: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.stout, 0.72),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.18),
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    elevation: 2,
  },
  entryFooter: {
    padding: Spacing.sm + 2,
    gap: 6,
  },
  entryAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  entryAuthor: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.foam,
  },
  entryPubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  entryPub: {
    flex: 1,
    fontFamily: Fonts.ui.regular,
    fontSize: 11,
    color: Colors.mutedText,
  },

  // — Fullscreen entry viewer —
  viewerBackdrop: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  viewerClose: {
    position: 'absolute',
    right: Spacing.lg,
    zIndex: 2,
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  viewerStage: {
    alignSelf: 'center',
  },
  viewerPhotoWell: {
    position: 'absolute',
    top: '7%',
    right: '5.5%',
    bottom: '4.5%',
    left: '5.5%',
    overflow: 'hidden',
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout2,
  },
  viewerFrameOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  viewerFrameImage: {
    width: '100%',
    height: '100%',
  },
  viewerMeta: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  viewerAuthorRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  viewerAuthor: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  viewerCaption: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foam,
  },
  viewerPubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  viewerPub: {
    flex: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.foamMuted,
  },

  // — Vote pill —
  votePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 36,
    paddingHorizontal: Spacing.sm + 2,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.06),
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
  },
  votePillActive: {
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  votePillMine: {
    opacity: 0.55,
  },
  votePillText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  votePillTextActive: {
    color: Colors.amber,
  },

  // — Empty states —
  emptyCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginTop: Spacing.md,
  },
  emptyText: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
    textAlign: 'center',
  },

  // — Podium —
  podiumRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  winnerTile: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  winnerTileLead: {
    flex: 1.35,
  },
  winnerImageWrap: {
    width: '100%',
    borderRadius: Radius.card,
    backgroundColor: Colors.stout3,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  winnerImageLead: {
    aspectRatio: 4 / 5,
    borderWidth: 2,
    borderColor: Colors.amber,
  },
  winnerImageSide: {
    aspectRatio: 1,
  },
  winnerCrown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    marginTop: 2,
  },
  winnerCrownText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 0.4,
    color: Colors.stout,
    textTransform: 'uppercase',
  },
  winnerRank: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 0.6,
    color: Colors.mutedText,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  winnerName: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.foam,
    maxWidth: '100%',
  },
  winnerVotes: {
    fontFamily: Fonts.display.bold,
    fontSize: 12,
    color: Colors.amber,
    fontVariant: ['tabular-nums'],
  },
  winnerNote: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    color: Colors.mutedText,
    textAlign: 'center',
  },

  pressedDim: {
    opacity: 0.6,
  },
});
