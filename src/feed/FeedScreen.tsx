import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  CollapsingHeader,
  useCollapsingHeader,
} from '@/components/shared/CollapsingHeader';
import { GlassIconButton } from '@/components/shared/GlassIconButton';
import {
  DicesIcon,
  MapPinIcon,
  MenuIcon,
  MessageSquareIcon,
  SearchIcon,
  UsersIcon,
} from '@/components/shared/IconGlyph';
import { TAB_CHROME } from '@/components/shared/TabBar';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import { ensureAccount } from '@/data/account';
import {
  fetchNightsFeed,
  type NightsFeedScope,
  type PublishedNight,
} from '@/data/nightsClient';
import {
  fetchPartaFeed,
  type PartaFeedSitting,
} from '@/data/partaFeedClient';
import { fetchFriendsLive } from '@/data/friendsClient';
import { CheersButton } from '@/feed/CheersButton';
import {
  loadNightFeedCache,
  saveNightFeedCache,
} from '@/feed/feedCache';
import {
  filterNightFeedForSafety,
  subscribeNightFeedSafety,
} from '@/feed/feedSafetySignal';
import {
  feedAuthorLabel,
  feedFacts,
  type FeedNightRoute,
  feedNightRoute,
  feedNightTitle,
  feedOtherDrinks,
  feedWhen,
  mergeNightPages,
  replaceNightReaction,
} from '@/feed/feedModel';
import { mergeHistoricalNights, withoutRunningNight } from '@/feed/historicalFeedModel';
import { useNightReaction } from '@/feed/useNightReaction';
import { useNightActions } from '@/feed/useNightActions';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { cs } from '@/i18n/cs';
import { useLivePartyStore } from '@/mocks/livePartyStore';
import { MockLayout } from '@/mocks/mockTheme';
import { Avatar } from '@/profile/Avatar';
import { useAccountStore } from '@/stores/accountStore';
import { hasLiveFriendSignal, usePartaSignalStore } from '@/stores/partaSignalStore';
import { usePartyEveningStore } from '@/stores/partyEveningStore';
import { drinkingDayKey } from '@/stores/tallyStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { useReduceMotion } from '@/utils/useReduceMotion';

const SCOPE_LABELS = ['Parta', 'Svět'] as const;
type ScopeLabel = (typeof SCOPE_LABELS)[number];

function scopeOf(label: ScopeLabel): NightsFeedScope {
  return label === 'Parta' ? 'friends' : 'global';
}

function FeedSkeleton() {
  const reduceMotion = useReduceMotion();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {[0, 1, 2].map((index) => (
        <View key={index} style={[styles.card, index === 0 && styles.cardFirst]}>
          <View style={styles.cardHead}>
            <SkeletonBlock width={34} height={34} radius={17} reduceMotion={reduceMotion} />
            <View style={styles.skeletonHeadText}>
              <SkeletonBlock width="42%" height={14} reduceMotion={reduceMotion} />
              <SkeletonBlock width="28%" height={10} reduceMotion={reduceMotion} />
            </View>
          </View>
          <SkeletonBlock width="68%" height={24} reduceMotion={reduceMotion} />
          <View style={styles.skeletonFacts}>
            <SkeletonBlock width="22%" height={42} reduceMotion={reduceMotion} />
            <SkeletonBlock width="26%" height={42} reduceMotion={reduceMotion} />
            <SkeletonBlock width="20%" height={42} reduceMotion={reduceMotion} />
          </View>
        </View>
      ))}
    </View>
  );
}

function StateMessage({
  title,
  body,
  onRetry,
}: {
  title: string;
  body?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.state}>
      <Text style={styles.stateTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
        {title}
      </Text>
      {body ? (
        <Text style={styles.stateBody} maxFontSizeMultiplier={FontScaleCap.body}>
          {body}
        </Text>
      ) : null}
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Zkusit načíst Kocoviny znovu"
        >
          <Text style={styles.retryText} maxFontSizeMultiplier={FontScaleCap.body}>
            Zkusit znovu
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface FeedCardProps {
  night: PublishedNight;
  reacting?: boolean;
  onToggleReaction?: (night: PublishedNight) => void;
  onOpenAuthor?: (night: PublishedNight) => void;
  onOpenNight?: (night: PublishedNight) => void;
  onOpenActions?: (night: PublishedNight) => void;
  first?: boolean;
}

function NightPeopleHeader({
  night,
  onOpenAuthor,
  onOpenActions,
}: {
  night: PublishedNight;
  onOpenAuthor?: (night: PublishedNight) => void;
  onOpenActions?: (night: PublishedNight) => void;
}) {
  const author = feedAuthorLabel(night);
  const people = [night.author, ...night.participants].filter(
    (person, index, all) => person.id && all.findIndex((row) => row.id === person.id) === index,
  );
  const names = people
    .map((person) => person.nickname ? `@${person.nickname}` : person.displayName)
    .join(', ');

  return (
    <View style={styles.cardHead}>
      <Pressable
        style={({ pressed }) => [styles.profileHead, pressed && onOpenAuthor && styles.pressed]}
        onPress={() => onOpenAuthor?.(night)}
        disabled={!onOpenAuthor}
        accessibilityRole={onOpenAuthor ? 'button' : undefined}
        accessibilityLabel={onOpenAuthor ? `Profil ${author}` : undefined}
      >
        <View style={styles.peopleFaces}>
          {people.slice(0, 4).map((person, index) => (
            <View key={person.id} style={index > 0 ? styles.faceOverlap : undefined}>
              <Avatar
                uri={person.avatarUrl}
                nickname={person.nickname}
                displayName={person.displayName}
                size={34}
                border="quiet"
              />
            </View>
          ))}
        </View>
        <View style={styles.grow}>
          <Text
            style={styles.author}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {names || author}
          </Text>
          <Text style={styles.when} maxFontSizeMultiplier={FontScaleCap.body}>
            {feedWhen(night)}
          </Text>
        </View>
      </Pressable>
      {onOpenActions ? (
        <Pressable
          onPress={() => onOpenActions(night)}
          style={({ pressed }) => [styles.nightMenu, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Možnosti večera"
          hitSlop={4}
        >
          <MenuIcon size={18} color={Colors.mutedText} />
        </Pressable>
      ) : null}
    </View>
  );
}

function NightHeroStrip({ night }: { night: PublishedNight }) {
  const hasRoute = night.pubNames.length > 0;
  const routeStops = night.pubNames.slice(0, 5);
  const hasMedia = night.heroPhotos.length > 0 || night.heroGames.length > 0;
  if (!hasMedia) return null;

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.heroStrip}
      accessibilityLabel="Momentky večera"
    >
      {hasRoute ? (
        <View testID="night-route-tile" style={[styles.heroTile, styles.routeTile]}>
          <MapPinIcon size={24} color={Colors.amber} />
          <View style={styles.routeRail}>
            {routeStops.map((name, index) => (
              <View key={`${name}:${index}`} style={styles.routeStop}>
                <View style={styles.routeDot} />
                <Text style={styles.routeName} numberOfLines={1}>
                  {name}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {night.heroPhotos.map((photo) => (
        <View key={photo.id} style={styles.heroTile}>
          <Image source={{ uri: photo.imageUrl }} style={styles.heroPhoto} />
          {photo.caption ? (
            <View style={styles.heroCaptionFade}>
              <Text style={styles.heroCaption} numberOfLines={1}>
                {photo.caption}
              </Text>
            </View>
          ) : null}
        </View>
      ))}
      {night.heroGames.map((game) => (
        <View key={game.id} style={[styles.heroTile, styles.gameTile]}>
          <View style={styles.gameIcon}>
            <DicesIcon size={30} color={Colors.amber} />
          </View>
          <Text style={styles.gameEyebrow} allowFontScaling={false}>
            ODEHRÁNO
          </Text>
          <Text style={styles.gameTitle} numberOfLines={2}>
            {game.name}
          </Text>
          <Text style={styles.gameScoring}>
            {game.scoring === 'points' ? 'Na body' : 'Bez bodů'}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

function RouteLine({
  route,
  otherDrinks,
}: {
  route: FeedNightRoute;
  otherDrinks: string | null;
}) {
  if (route.city) {
    return (
      <Text style={styles.description} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {[route.city, otherDrinks].filter(Boolean).join(' · ')}
      </Text>
    );
  }

  return (
    <View
      testID="night-route-line"
      style={styles.routeRow}
      accessible
      accessibilityLabel={[route.accessibilityLabel, otherDrinks].filter(Boolean).join(', ')}
    >
      <Text style={styles.routeSep} maxFontSizeMultiplier={FontScaleCap.body}>→ </Text>
      {route.next ? (
        <Text
          style={[styles.route, styles.routeMid]}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {route.next}
        </Text>
      ) : null}
      {route.skipped > 0 ? (
        <Text style={styles.routeSep} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {`${route.next ? '  →  ' : ''}+${route.skipped}`}
        </Text>
      ) : null}
      {route.last ? (
        <>
          <Text style={styles.routeSep} maxFontSizeMultiplier={FontScaleCap.body}>  →  </Text>
          <Text
            style={[styles.route, styles.routeLast]}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {route.last}
          </Text>
        </>
      ) : null}
      {otherDrinks ? (
        <Text
          style={styles.routeTail}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {` · ${otherDrinks}`}
        </Text>
      ) : null}
    </View>
  );
}

/** One truthful published-night card, reusable by feed and profile surfaces. */
export const FeedCard = memo(function FeedCard({
  night,
  reacting = false,
  onToggleReaction,
  onOpenAuthor,
  onOpenNight,
  onOpenActions,
  first = false,
}: FeedCardProps) {
  const author = feedAuthorLabel(night);
  const facts = feedFacts(night);
  const route = feedNightRoute(night);
  const otherDrinks = feedOtherDrinks(night);
  const hasRoastBasis = Boolean(night.roastBasis);

  return (
    <View style={[styles.card, first && styles.cardFirst]}>
      <NightPeopleHeader
        night={night}
        onOpenAuthor={onOpenAuthor}
        onOpenActions={onOpenActions}
      />

      <Pressable
        disabled={!onOpenNight}
        onPress={() => onOpenNight?.(night)}
        style={({ pressed }) => [styles.storyTap, pressed && onOpenNight && styles.pressed]}
        accessibilityRole={onOpenNight ? 'button' : undefined}
        accessibilityLabel={onOpenNight ? `Otevřít večer ${night.roastLine || night.title || feedNightTitle(night)}` : undefined}
      >
        <Text
          style={styles.title}
          numberOfLines={hasRoastBasis ? 2 : 3}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {night.roastLine || night.title || feedNightTitle(night)}
        </Text>
        {hasRoastBasis ? (
          <Text style={styles.description} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {night.roastBasis}
          </Text>
        ) : null}
        {route ? (
          <RouteLine route={route} otherDrinks={otherDrinks} />
        ) : !hasRoastBasis && otherDrinks ? (
          <Text style={styles.description} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {otherDrinks}
          </Text>
        ) : null}

        <View style={styles.facts}>
          {facts.map((fact, index) => {
            const last = facts.length > 1 && index === facts.length - 1;
            return (
              <View
                key={fact.label}
                style={[styles.fact, last && styles.factLast]}
              >
                {/* No `adjustsFontSizeToFit` here. The night detail mounts this
                    card inside a container that lays out at zero width on the
                    first pass; iOS shrinks the value to the minimum scale then
                    and never grows it back, so "3" rendered at ~6 pt. The fact
                    values are short by construction ("3", "4h 45m"), so an
                    equal-width cell with `numberOfLines={1}` is enough. */}
                <Text
                  style={[styles.factValue, last && styles.factTextLast]}
                  numberOfLines={1}
                  allowFontScaling={false}
                >
                  {fact.value}
                </Text>
                {/* The fact is the number; its label must never end in "Ve…".
                    At the largest text sizes a third of a card is narrower than
                    the word, so the label wraps instead of clipping. */}
                <Text
                  style={[styles.factLabel, last && styles.factTextLast]}
                  numberOfLines={2}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {fact.label}
                </Text>
              </View>
            );
          })}
        </View>
      </Pressable>

      <NightHeroStrip night={night} />

      {!night.historical ? (
        <View style={styles.cardFoot}>
          <CheersButton
            count={night.rounds}
            cheered={night.myRound}
            disabled={night.isMine || reacting || !onToggleReaction}
            onPress={() => onToggleReaction?.(night)}
            label={
              night.isMine || !onToggleReaction
                ? cs.vycep.roundCount(night.rounds)
                : cs.a11y.roundButton(author)
            }
          />
          <Pressable
            disabled={!onOpenNight}
            onPress={() => onOpenNight?.(night)}
            style={({ pressed }) => [styles.commentButton, pressed && styles.pressed]}
            accessibilityRole={onOpenNight ? 'button' : undefined}
            accessibilityLabel={`${night.commentCount} komentářů. Otevřít večer.`}
          >
            <MessageSquareIcon size={18} color={Colors.mutedText} />
            <Text style={styles.commentCount} allowFontScaling={false}>
              {night.commentCount}
            </Text>
          </Pressable>
          {night.isMine ? (
            <Text style={styles.mineLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              Tvoje noc
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

function FeedScreenContent() {
  const insets = useSafeAreaInsets();
  // The wordmark row is 28pt tall under an 8pt pad, so it has cleared the bar
  // band by 40pt of scroll.
  const { progress: headerProgress, scrollProps } = useCollapsingHeader(40);
  const router = useRouter();
  const pendingRequests = usePartaSignalStore((state) => state.pendingRequests);
  const reduceMotion = useReduceMotion();
  const showToast = useToastStore((state) => state.show);

  const [scopeLabel, setScopeLabel] = useState<ScopeLabel>('Parta');
  const scope = scopeOf(scopeLabel);
  const [nights, setNights] = useState<PublishedNight[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [historicalCursor, setHistoricalCursor] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState(false);
  const [showingCache, setShowingCache] = useState(false);

  // The evening that is running right now is chrome, not a post (§20.5). Its
  // drinks are already on the server, so without this the feed would show it as
  // a finished night while you are still sitting in it.
  const partyLive = useLivePartyStore((state) => state.live);
  const partyStartedAt = useLivePartyStore((state) => state.startedAt);
  const evening = usePartyEveningStore((state) => state.evening);
  const runningDrinkingDay = useMemo(() => {
    const eveningStartedAt =
      evening?.active === true ? Date.parse(evening.startedAt) : Number.NaN;
    const startedAt = partyLive && partyStartedAt !== null
      ? partyStartedAt
      : Number.isFinite(eveningStartedAt)
        ? eveningStartedAt
        : null;
    if (startedAt === null) return null;
    return drinkingDayKey(new Date(startedAt));
  }, [evening, partyLive, partyStartedAt]);
  const feedNights = useMemo(
    () => withoutRunningNight(nights ?? [], runningDrinkingDay),
    [nights, runningDrinkingDay],
  );

  const requestSeq = useRef(0);
  const mountedRef = useRef(true);
  const accountIdRef = useRef<string | null>(null);
  const nightsRef = useRef<PublishedNight[] | null>(null);
  const cursorRef = useRef<string | null>(null);
  const historicalSittingsRef = useRef<PartaFeedSitting[]>([]);

  const commitNights = useCallback((next: PublishedNight[] | null) => {
    nightsRef.current = next;
    setNights(next);
  }, []);

  const commitCursor = useCallback((next: string | null) => {
    cursorRef.current = next;
    setCursor(next);
  }, []);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Keep the fixed Parta door honest after a cold launch. This cheap slice
  // carries request/live counts without loading the full social dashboard.
  useEffect(() => {
    let alive = true;
    void fetchFriendsLive().then((live) => {
      if (!alive || !live) return;
      usePartaSignalStore.getState().setSignal({
        pendingRequests: live.incomingCount,
        unread: live.unreadCount,
        liveNow: hasLiveFriendSignal(live),
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback(
    (nextNights: PublishedNight[], nextCursor: string | null) => {
      const accountId = accountIdRef.current;
      if (!accountId) return;
      void saveNightFeedCache(accountId, scope, {
        nights: nextNights,
        nextCursor,
        savedAt: Date.now(),
      });
    },
    [scope],
  );

  const loadFirstPage = useCallback(
    async (kind: 'initial' | 'refresh') => {
      const seq = ++requestSeq.current;
      if (kind === 'initial') {
        setInitialLoading(true);
        commitNights(null);
        commitCursor(null);
        setShowingCache(false);
      } else {
        setRefreshing(true);
      }
      setLoadingMore(false);
      setLoadError(null);
      setMoreError(false);

      const session = await ensureAccount();
      if (!mountedRef.current || seq !== requestSeq.current) return;
      if (!session) {
        setLoadError('Účet se teď nepodařilo připravit.');
        setInitialLoading(false);
        setRefreshing(false);
        return;
      }
      accountIdRef.current = session.accountId;

      const networkRequest = fetchNightsFeed(scope);
      const historicalRequest =
        scope === 'friends'
          ? fetchPartaFeed()
          : Promise.resolve({ sittings: [], nextCursor: null });
      if (kind === 'initial') {
        const cached = await loadNightFeedCache(session.accountId, scope);
        if (!mountedRef.current || seq !== requestSeq.current) return;
        if (cached && cached.nights.length > 0) {
          commitNights(filterNightFeedForSafety(session.accountId, cached.nights));
          commitCursor(cached.nextCursor);
          setShowingCache(true);
          setInitialLoading(false);
        }
      }

      const [result, historicalPage] = await Promise.all([
        networkRequest,
        historicalRequest,
      ]);
      if (!mountedRef.current || seq !== requestSeq.current) return;
      setInitialLoading(false);
      setRefreshing(false);
      if (!result.ok) {
        setLoadError(result.detail || 'Kocoviny se teď nenačetly.');
        return;
      }

      historicalSittingsRef.current = historicalPage?.sittings ?? [];
      setHistoricalCursor(historicalPage?.nextCursor ?? null);
      const visibleNights = filterNightFeedForSafety(
        session.accountId,
        mergeHistoricalNights(result.nights, historicalSittingsRef.current),
      );
      commitNights(visibleNights);
      commitCursor(result.nextCursor);
      setShowingCache(false);
      setLoadError(null);
      persist(visibleNights, result.nextCursor);
    },
    [commitCursor, commitNights, persist, scope],
  );

  useEffect(
    () =>
      subscribeNightFeedSafety((change) => {
        const viewerAccountId = accountIdRef.current;
        if (!viewerAccountId) return;
        if (change.viewerAccountId && change.viewerAccountId !== viewerAccountId) return;

        if (change.blocked) {
          const current = nightsRef.current;
          if (current) {
            const next = filterNightFeedForSafety(viewerAccountId, current);
            const changed =
              next.length !== current.length ||
              next.some((night, index) => night !== current[index]);
            if (changed) {
              commitNights(next);
              persist(next, cursorRef.current);
            }
          }
        }

        void loadFirstPage('refresh');
      }),
    [commitNights, loadFirstPage, persist],
  );

  useEffect(() => {
    const kickoff = setTimeout(() => void loadFirstPage('initial'), 0);
    return () => clearTimeout(kickoff);
  }, [loadFirstPage]);

  const changeScope = useCallback((next: ScopeLabel) => {
    if (next === scopeLabel) return;
    requestSeq.current += 1;
    setScopeLabel(next);
    commitNights(null);
    commitCursor(null);
    historicalSittingsRef.current = [];
    setHistoricalCursor(null);
    setInitialLoading(true);
    setRefreshing(false);
    setLoadingMore(false);
    setLoadError(null);
    setMoreError(false);
    setShowingCache(false);
  }, [commitCursor, commitNights, scopeLabel]);

  const refresh = useCallback(() => {
    if (refreshing) return;
    void loadFirstPage('refresh');
  }, [loadFirstPage, refreshing]);

  const loadMore = useCallback((force = false) => {
    if (
      (!cursor && !historicalCursor) ||
      !nights ||
      loadingMore ||
      refreshing ||
      (moreError && !force)
    ) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    setMoreError(false);
    const publishedRequest = cursor
      ? fetchNightsFeed(scope, cursor)
      : Promise.resolve({ ok: true as const, nights: [], nextCursor: null });
    const historicalRequest =
      scope === 'friends' && historicalCursor
        ? fetchPartaFeed({ cursor: historicalCursor })
        : Promise.resolve({ sittings: [], nextCursor: null });
    void Promise.all([publishedRequest, historicalRequest]).then(([result, historicalPage]) => {
      if (!mountedRef.current || seq !== requestSeq.current) return;
      setLoadingMore(false);
      if (!result.ok || historicalPage === null) {
        setMoreError(true);
      }
      const viewerAccountId = accountIdRef.current;
      const currentPublished = (nightsRef.current ?? []).filter((night) => !night.historical);
      const nextPublished = result.ok
        ? mergeNightPages(currentPublished, result.nights)
        : currentPublished;
      if (historicalPage) {
        const seen = new Set(historicalSittingsRef.current.map((sitting) => sitting.id));
        historicalSittingsRef.current = [
          ...historicalSittingsRef.current,
          ...historicalPage.sittings.filter((sitting) => !seen.has(sitting.id)),
        ];
        setHistoricalCursor(historicalPage.nextCursor);
      }
      const mergedRaw = mergeHistoricalNights(nextPublished, historicalSittingsRef.current);
      const merged = viewerAccountId
        ? filterNightFeedForSafety(viewerAccountId, mergedRaw)
        : mergedRaw;
      commitNights(merged);
      if (result.ok) commitCursor(result.nextCursor);
      persist(merged, result.ok ? result.nextCursor : cursorRef.current);
    });
  }, [
    commitCursor,
    commitNights,
    cursor,
    historicalCursor,
    loadingMore,
    moreError,
    nights,
    persist,
    refreshing,
    scope,
  ]);

  const retryMore = useCallback(() => {
    loadMore(true);
  }, [loadMore]);

  const openAuthor = useCallback(
    (night: PublishedNight) => {
      if (!night.author.id || night.isMine) return;
      router.push(`/user?accountId=${encodeURIComponent(night.author.id)}` as Href);
    },
    [router],
  );

  const openNight = useCallback(
    (night: PublishedNight) => {
      router.push(`/night/${encodeURIComponent(night.id)}` as Href);
    },
    [router],
  );

  const applyReaction = useCallback(
    (nightId: string, rounds: number, myRound: boolean) => {
      const current = nightsRef.current;
      if (!current) return;
      const next = replaceNightReaction(current, nightId, rounds, myRound);
      commitNights(next);
      persist(next, cursorRef.current);
    },
    [commitNights, persist],
  );

  const { reactingIds, toggleReaction } = useNightReaction(applyReaction, showToast);
  const removeNight = useCallback(
    (removed: PublishedNight) => {
      const current = nightsRef.current;
      if (!current) return;
      const next = current.filter((night) => night.id !== removed.id);
      commitNights(next);
      persist(next, cursorRef.current);
    },
    [commitNights, persist],
  );
  const openNightActions = useNightActions(removeNight);

  const header = useMemo(
    () => (
      <View>
        <View style={[styles.brandRow, { paddingTop: insets.top + Spacing.sm }]}>
          <Image source={require('../../assets/images/icon.png')} style={styles.mark} />
          <Text style={styles.wordmark} allowFontScaling={false}>
            Na pivo
          </Text>
        </View>
        <UnderlineTabs
          options={SCOPE_LABELS}
          value={scopeLabel}
          onChange={changeScope}
          inset={MockLayout.screenPad}
        />
        {feedNights.length > 0 && (showingCache || loadError) ? (
          <View style={[styles.statusBar, loadError && styles.statusBarError]}>
            <Text style={styles.statusText} maxFontSizeMultiplier={FontScaleCap.body}>
              {loadError
                ? 'Jedeš z posledního načtení. Novější večery se teď nedotáhly.'
                : 'Poslední načtení · kontroluju novější večery…'}
            </Text>
            {loadError ? (
              <Pressable
                onPress={refresh}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Zkusit načíst nové večery"
              >
                <Text style={styles.statusRetry} maxFontSizeMultiplier={FontScaleCap.body}>
                  Zkusit znovu
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    ),
    [changeScope, feedNights.length, insets.top, loadError, refresh, scopeLabel, showingCache],
  );

  const empty = initialLoading ? (
    <FeedSkeleton />
  ) : loadError ? (
    <StateMessage
      title="Kocoviny se teď nenačetly"
      body="Zápisy v telefonu zůstávají v bezpečí. Zkus to za chvíli znovu."
      onRetry={refresh}
    />
  ) : (
    <StateMessage
      title={scope === 'friends' ? cs.vycep.emptyPartaTitle : 'Svět je zatím podezřele čerstvý'}
      body={
        scope === 'friends'
          ? cs.vycep.emptyPartaBody
          : 'Zatím tu nikdo nezveřejnil svůj večer.'
      }
    />
  );

  return (
    <View style={styles.screen}>
      <Animated.FlatList
        style={styles.screen}
        data={feedNights}
        keyExtractor={(night) => night.id}
        renderItem={({ item, index }) => (
          <FeedCard
            night={item}
            first={index === 0}
            reacting={reactingIds.has(item.id)}
            onToggleReaction={item.historical ? undefined : toggleReaction}
            onOpenAuthor={!item.isMine && item.author.id ? openAuthor : undefined}
            onOpenNight={item.historical ? undefined : openNight}
            onOpenActions={item.historical ? undefined : openNightActions}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoading}>
              <SkeletonBlock width="100%" height={88} reduceMotion={reduceMotion} />
            </View>
          ) : moreError ? (
            <Pressable
              onPress={retryMore}
              style={({ pressed }) => [styles.moreError, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.vycep.loadMoreRetryA11y}
            >
              <Text style={styles.moreErrorText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.vycep.loadMoreError}
              </Text>
            </Pressable>
          ) : cursor || historicalCursor ? (
            <Pressable
              onPress={() => loadMore()}
              style={({ pressed }) => [styles.moreError, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.vycep.loadMore}
            >
              <Text style={styles.moreErrorText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.vycep.loadMore}
              </Text>
            </Pressable>
          ) : null
        }
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + TAB_CHROME },
          feedNights.length === 0 && styles.contentEmpty,
        ]}
        contentInsetAdjustmentBehavior="never"
        {...scrollProps}
        onEndReachedThreshold={0.35}
        onEndReached={() => loadMore()}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.amber} />
        }
      />

      {/* The bar that forms once the wordmark scrolls away. Without it the two
          buttons floated on nothing and post text ran under them and under the
          status bar. */}
      <CollapsingHeader progress={headerProgress} title={cs.appName}>
        <View style={styles.partaButtonWrap}>
          <GlassIconButton
            size={40}
            accessibilityLabel={
              pendingRequests > 0
                ? cs.a11y.openPartaWithRequests(pendingRequests)
                : cs.a11y.openParta
            }
            onPress={() => router.push('/friends/parta' as Href)}
          >
            <UsersIcon size={19} color={Colors.foam} />
          </GlassIconButton>
          {pendingRequests > 0 ? (
            <View style={styles.partaBadge} pointerEvents="none">
              <Text style={styles.partaBadgeText} allowFontScaling={false}>
                {pendingRequests > 9 ? '9+' : pendingRequests}
              </Text>
            </View>
          ) : null}
        </View>
        <GlassIconButton
          size={40}
          accessibilityLabel="Hledat"
          onPress={() => router.push('/search' as Href)}
        >
          <SearchIcon size={19} color={Colors.amber} />
        </GlassIconButton>
      </CollapsingHeader>
    </View>
  );
}

/**
 * A tab scene stays mounted while account/auth screens are pushed above it.
 * Keying the account-owned content prevents a logout or account claim from
 * exposing the previous viewer's friends-only feed, even when the replacement
 * account is offline. The key is stable during ordinary offline use, so that
 * viewer keeps the last real feed already held in this component.
 */
export default function FeedScreen() {
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  return <FeedScreenContent key={accountId ?? 'account-pending'} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: MockLayout.screenPad },
  contentEmpty: { flexGrow: 1 },
  grow: { flex: 1 },
  pressed: { opacity: 0.62 },

  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  partaButtonWrap: { position: 'relative' },
  partaBadge: {
    position: 'absolute',
    top: -5,
    right: -7,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: Colors.amber,
    borderWidth: 2,
    borderColor: Colors.stout,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partaBadgeText: {
    color: Colors.stout,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '800',
  },
  mark: { width: 28, height: 28, borderRadius: 7 },
  wordmark: {
    fontFamily: Fonts.numeral,
    fontSize: 19,
    lineHeight: 24,
    color: Colors.foam,
    includeFontPadding: false,
  },

  statusBar: {
    minHeight: HitArea.min,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.medium,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: withAlpha(Colors.foam, 0.06),
  },
  statusBarError: {
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.22),
  },
  statusText: { flex: 1, fontSize: 12, fontWeight: '500', color: Colors.mutedText },
  statusRetry: { fontSize: 12, fontWeight: '800', color: Colors.amber },

  card: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    borderTopWidth: 10,
    borderTopColor: '#0F0A05',
    marginHorizontal: -MockLayout.screenPad,
    paddingHorizontal: MockLayout.screenPad,
  },
  cardFirst: { borderTopWidth: 0, paddingTop: Spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center' },
  profileHead: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  nightMenu: {
    width: HitArea.min,
    height: HitArea.min,
    marginRight: -Spacing.xs,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peopleFaces: { flexDirection: 'row', alignItems: 'center', paddingRight: Spacing.xs },
  faceOverlap: { marginLeft: -10 },
  author: { fontWeight: '700', fontSize: 15, color: Colors.foam },
  when: { fontWeight: '400', fontSize: 12, color: Colors.mutedText, marginTop: 1 },
  storyTap: { borderRadius: Radius.small },
  title: {
    fontWeight: '800',
    fontSize: 21,
    color: Colors.foam,
    marginTop: Spacing.md,
    letterSpacing: -0.3,
  },
  route: {
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    color: withAlpha(Colors.amber, 0.86),
  },
  routeRow: {
    flexDirection: 'row',
    // At the largest text sizes the pub name and the drink tail no longer fit
    // on one line. Wrapping moves the tail down; shrinking would leave
    // "→ U Pin… · 1 ne…" instead.
    flexWrap: 'wrap',
    alignItems: 'baseline',
    marginTop: Spacing.xs,
    minWidth: 0,
  },
  routeMid: { flexShrink: 3, minWidth: 0 },
  routeLast: { flexShrink: 1, minWidth: 0 },
  routeSep: {
    flexShrink: 0,
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  routeTail: {
    flexShrink: 4,
    minWidth: 0,
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  description: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.mutedText,
    marginTop: Spacing.xs,
  },

  facts: {
    flexDirection: 'row',
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  // Equal-width cells that shrink with the row instead of a percentage width,
  // so a long value truncates inside its cell rather than pushing the row.
  fact: { flex: 1, minWidth: 0, paddingRight: Spacing.sm },
  factLast: { paddingRight: 0, alignItems: 'flex-end' },
  factTextLast: { textAlign: 'right' },
  factValue: {
    fontFamily: Fonts.numeral,
    fontSize: 22,
    lineHeight: 27,
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  factLabel: { fontWeight: '400', fontSize: 13, color: Colors.mutedText, marginTop: 2 },

  heroStrip: { gap: Spacing.sm, paddingTop: Spacing.md, paddingRight: Spacing.xl },
  heroTile: {
    width: 276,
    height: 164,
    borderRadius: Radius.medium,
    overflow: 'hidden',
    backgroundColor: '#24170C',
  },
  heroPhoto: { width: '100%', height: '100%', resizeMode: 'cover' },
  heroCaptionFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    backgroundColor: withAlpha('#000000', 0.58),
  },
  heroCaption: { fontSize: 13, fontWeight: '700', color: Colors.foam },
  routeTile: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    padding: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.amber, 0.22),
  },
  routeRail: { flex: 1, gap: Spacing.sm },
  routeStop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  routeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.amber },
  routeName: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.foam },
  gameTile: { justifyContent: 'flex-end', padding: Spacing.md },
  gameIcon: { position: 'absolute', right: Spacing.md, top: Spacing.md },
  gameEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: Colors.amber },
  gameTitle: { marginTop: Spacing.xs, fontSize: 25, fontWeight: '800', color: Colors.foam },
  gameScoring: { marginTop: Spacing.xs, fontSize: 13, fontWeight: '600', color: Colors.mutedText },

  cardFoot: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  mineLabel: { fontSize: 12, fontWeight: '600', color: Colors.mutedText },
  commentButton: {
    minWidth: HitArea.min,
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  commentCount: { fontSize: 13, fontWeight: '700', color: Colors.mutedText },

  skeletonHeadText: { flex: 1, gap: Spacing.xs },
  skeletonFacts: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.md },
  footerLoading: { paddingVertical: Spacing.md },

  state: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  stateTitle: { fontSize: 20, fontWeight: '800', color: Colors.foam, textAlign: 'center' },
  stateBody: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  retryButton: {
    minWidth: 132,
    minHeight: HitArea.min,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  retryText: { fontSize: 14, fontWeight: '800', color: Colors.stout },
  moreError: { minHeight: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  moreErrorText: { fontSize: 13, fontWeight: '700', color: Colors.amber },
});
