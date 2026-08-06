import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassIconButton } from '@/components/shared/GlassIconButton';
import { SearchIcon } from '@/components/shared/IconGlyph';
import { TAB_CHROME } from '@/components/shared/TabBar';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import { ensureAccount } from '@/data/account';
import {
  clearNightReaction,
  fetchNightsFeed,
  isRetriableNightError,
  reactToNight,
  type NightsFeedScope,
  type PublishedNight,
} from '@/data/nightsClient';
import { enqueueNightOp } from '@/data/nightsQueue';
import { CheersButton } from '@/feed/CheersButton';
import {
  loadNightFeedCache,
  saveNightFeedCache,
} from '@/feed/feedCache';
import {
  feedAuthorLabel,
  feedFacts,
  feedNightRoute,
  feedNightTitle,
  feedOtherDrinks,
  feedWhen,
  mergeNightPages,
  replaceNightReaction,
} from '@/feed/feedModel';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { cs } from '@/i18n/cs';
import { MockLayout } from '@/mocks/mockTheme';
import { Avatar } from '@/profile/Avatar';
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
      style={styles.skeletonList}
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
  first?: boolean;
}

/** One truthful published-night card, reusable by feed and profile surfaces. */
export const FeedCard = memo(function FeedCard({
  night,
  reacting = false,
  onToggleReaction,
  first = false,
}: FeedCardProps) {
  const author = feedAuthorLabel(night);
  const facts = feedFacts(night);
  const route = feedNightRoute(night);
  const otherDrinks = feedOtherDrinks(night);

  return (
    <View style={[styles.card, first && styles.cardFirst]}>
      <View style={styles.cardHead}>
        <Avatar
          uri={night.author.avatarUrl}
          nickname={night.author.nickname}
          displayName={night.author.displayName}
          size={34}
          border="quiet"
        />
        <View style={styles.grow}>
          <Text
            style={styles.author}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {author}
          </Text>
          <Text style={styles.when} maxFontSizeMultiplier={FontScaleCap.body}>
            {feedWhen(night)}
          </Text>
        </View>
      </View>

      <Text style={styles.title} numberOfLines={3} maxFontSizeMultiplier={FontScaleCap.heading}>
        {feedNightTitle(night)}
      </Text>
      {route ? (
        <Text style={styles.route} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
          {route}
        </Text>
      ) : null}
      {otherDrinks ? (
        <Text style={styles.description} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
          {otherDrinks}
        </Text>
      ) : null}

      <View style={styles.facts}>
        {facts.map((fact, index) => {
          const last = facts.length > 1 && index === facts.length - 1;
          return (
            <View key={fact.label} style={[styles.fact, last && styles.factLast]}>
              <Text
                style={[styles.factValue, last && styles.factTextLast]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                allowFontScaling={false}
              >
                {fact.value}
              </Text>
              <Text
                style={[styles.factLabel, last && styles.factTextLast]}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {fact.label}
              </Text>
            </View>
          );
        })}
      </View>

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
        {night.isMine ? (
          <Text style={styles.mineLabel} maxFontSizeMultiplier={FontScaleCap.body}>
            Tvoje noc
          </Text>
        ) : null}
      </View>
    </View>
  );
});

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const showToast = useToastStore((state) => state.show);

  const [scopeLabel, setScopeLabel] = useState<ScopeLabel>('Parta');
  const scope = scopeOf(scopeLabel);
  const [nights, setNights] = useState<PublishedNight[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState(false);
  const [showingCache, setShowingCache] = useState(false);
  const [reactingIds, setReactingIds] = useState<Set<string>>(() => new Set());

  const requestSeq = useRef(0);
  const mountedRef = useRef(true);
  const accountIdRef = useRef<string | null>(null);
  const nightsRef = useRef<PublishedNight[] | null>(null);
  const cursorRef = useRef<string | null>(null);
  const reactionBusyRef = useRef(new Set<string>());

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
      if (kind === 'initial') {
        const cached = await loadNightFeedCache(session.accountId, scope);
        if (!mountedRef.current || seq !== requestSeq.current) return;
        if (cached && cached.nights.length > 0) {
          commitNights(cached.nights);
          commitCursor(cached.nextCursor);
          setShowingCache(true);
          setInitialLoading(false);
        }
      }

      const result = await networkRequest;
      if (!mountedRef.current || seq !== requestSeq.current) return;
      setInitialLoading(false);
      setRefreshing(false);
      if (!result.ok) {
        setLoadError(result.detail || 'Kocoviny se teď nenačetly.');
        return;
      }

      commitNights(result.nights);
      commitCursor(result.nextCursor);
      setShowingCache(false);
      setLoadError(null);
      persist(result.nights, result.nextCursor);
    },
    [commitCursor, commitNights, persist, scope],
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
    if (!cursor || !nights || loadingMore || refreshing || (moreError && !force)) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    setMoreError(false);
    void fetchNightsFeed(scope, cursor).then((result) => {
      if (!mountedRef.current || seq !== requestSeq.current) return;
      setLoadingMore(false);
      if (!result.ok) {
        setMoreError(true);
        return;
      }
      const merged = mergeNightPages(nightsRef.current ?? [], result.nights);
      commitNights(merged);
      commitCursor(result.nextCursor);
      persist(merged, result.nextCursor);
    });
  }, [commitCursor, commitNights, cursor, loadingMore, moreError, nights, persist, refreshing, scope]);

  const retryMore = useCallback(() => {
    loadMore(true);
  }, [loadMore]);

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

  const toggleReaction = useCallback(
    (night: PublishedNight) => {
      if (night.isMine || reactionBusyRef.current.has(night.id)) return;
      reactionBusyRef.current.add(night.id);
      setReactingIds((current) => new Set(current).add(night.id));

      const turningOn = !night.myRound;
      const optimisticRounds = Math.max(0, night.rounds + (turningOn ? 1 : -1));
      applyReaction(night.id, optimisticRounds, turningOn);

      const request = turningOn ? reactToNight(night.id) : clearNightReaction(night.id);
      void request.then((result) => {
        if (!mountedRef.current) return;
        if (result.ok) {
          applyReaction(night.id, result.rounds, result.myRound);
          showToast(turningOn ? cs.vycep.roundSentToast : cs.vycep.roundUndoneToast);
        } else if (isRetriableNightError(result)) {
          void enqueueNightOp(
            turningOn
              ? { op: 'round', nightId: night.id }
              : { op: 'round-clear', nightId: night.id },
          );
          showToast(cs.vycep.roundQueuedToast);
        } else {
          applyReaction(night.id, night.rounds, night.myRound);
          showToast(cs.vycep.roundErrorToast);
        }
        reactionBusyRef.current.delete(night.id);
        setReactingIds((current) => {
          const next = new Set(current);
          next.delete(night.id);
          return next;
        });
      });
    },
    [applyReaction, showToast],
  );

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
        {(nights?.length ?? 0) > 0 && (showingCache || loadError) ? (
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
    [changeScope, insets.top, loadError, nights?.length, refresh, scopeLabel, showingCache],
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
      title={scope === 'friends' ? 'V partě je zatím klid' : 'Svět je zatím podezřele čerstvý'}
      body={
        scope === 'friends'
          ? 'Až někdo z party zveřejní večer, objeví se tady.'
          : 'Zatím tu nikdo nezveřejnil svůj večer.'
      }
    />
  );

  return (
    <View style={styles.screen}>
      <FlatList
        style={styles.screen}
        data={nights ?? []}
        keyExtractor={(night) => night.id}
        renderItem={({ item, index }) => (
          <FeedCard
            night={item}
            first={index === 0}
            reacting={reactingIds.has(item.id)}
            onToggleReaction={toggleReaction}
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
              accessibilityLabel="Zkusit načíst další večery"
            >
              <Text style={styles.moreErrorText} maxFontSizeMultiplier={FontScaleCap.body}>
                Další večery se nedotáhly · Zkusit znovu
              </Text>
            </Pressable>
          ) : null
        }
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + TAB_CHROME },
          (nights?.length ?? 0) === 0 && styles.contentEmpty,
        ]}
        contentInsetAdjustmentBehavior="never"
        onEndReachedThreshold={0.35}
        onEndReached={() => loadMore()}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.amber} />
        }
      />

      <View style={[styles.searchFloat, { top: insets.top + Spacing.sm }]}>
        <GlassIconButton
          size={40}
          accessibilityLabel="Hledat"
          onPress={() => router.push('/search' as Href)}
        >
          <SearchIcon size={19} color={Colors.amber} />
        </GlassIconButton>
      </View>
    </View>
  );
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
  searchFloat: { position: 'absolute', right: MockLayout.screenPad, zIndex: 2 },
  mark: { width: 28, height: 28, borderRadius: 7 },
  wordmark: { fontFamily: Fonts.numeral, fontSize: 19, color: Colors.foam },

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
    marginHorizontal: -Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  cardFirst: { borderTopWidth: 0, paddingTop: Spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  author: { fontWeight: '700', fontSize: 15, color: Colors.foam },
  when: { fontWeight: '400', fontSize: 12, color: Colors.mutedText, marginTop: 1 },
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
    marginTop: Spacing.xs,
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
  fact: { flex: 1, minWidth: 0, paddingRight: Spacing.sm },
  factLast: { paddingRight: 0, alignItems: 'flex-end' },
  factTextLast: { textAlign: 'right' },
  factValue: {
    fontFamily: Fonts.numeral,
    fontSize: 22,
    lineHeight: 27,
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  factLabel: { fontWeight: '400', fontSize: 13, color: Colors.mutedText, marginTop: 2 },

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

  skeletonList: { marginHorizontal: -Spacing.md },
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
