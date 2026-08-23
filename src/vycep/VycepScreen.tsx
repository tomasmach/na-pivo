/**
 * VycepScreen — finished nights hung up as tally marks on a pub coaster.
 *
 * The fetch, stale-response guard, pagination latch, refresh and mutation
 * reconciliation are unchanged. The surface is the Tácek composition:
 * one-line header, one breathing feed, one fixed nudge slot and one amber CTA.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon } from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import {
  fetchNightsFeed,
  type NightsFeedScope,
  type PublishedNight,
} from '@/data/nightsClient';
import { TallyCoaster } from '@/diary/TallyCoaster';
import { cs } from '@/i18n/cs';
import { leaveRoute } from '@/navigation/leaveRoute';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  allSessionsNewestFirst,
  drinkingDayKey,
  useTallyStore,
} from '@/stores/tallyStore';
import { useVycepStore } from '@/stores/vycepStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { NightCard } from '@/vycep/NightCard';
import { PublishNightSheet } from '@/vycep/PublishNightSheet';
import {
  buildNightSummary,
  sessionsOfNight,
  type NightSummary,
} from '@/vycep/nightModel';

const SCOPES: readonly [NightsFeedScope, NightsFeedScope] = ['friends', 'global'];

interface ScopeSegmentProps {
  value: 0 | 1;
  onChange: (value: 0 | 1) => void;
}

const ScopeSegment = memo(function ScopeSegment({
  value,
  onChange,
}: ScopeSegmentProps) {
  const hapticEnabled = useSettingsStore((state) => state.hapticEnabled);
  const options = [cs.vycep.scopeParta, cs.vycep.scopeWorld] as const;

  const handlePress = useCallback(
    (next: 0 | 1) => {
      if (next === value) return;
      if (hapticEnabled) fireLightImpactHaptic();
      onChange(next);
    },
    [hapticEnabled, onChange, value],
  );

  return (
    <View
      style={styles.segment}
      accessibilityRole="tablist"
      accessibilityLabel={cs.vycep.title}
    >
      {options.map((label, index) => {
        const next = index as 0 | 1;
        const active = next === value;
        return (
          <Pressable
            key={label}
            onPress={() => handlePress(next)}
            hitSlop={{ top: 4, bottom: 4 }}
            style={({ pressed }) => [
              styles.segmentItem,
              active && styles.segmentItemActive,
              pressed && styles.pressed,
            ]}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[
                styles.segmentLabel,
                active ? styles.segmentLabelActive : styles.segmentLabelMuted,
              ]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

function GhostCard({ height }: { height: number }) {
  return (
    <View
      style={[styles.ghostCard, { height }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

export default function VycepScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [scopeIndex, setScopeIndex] = useState<0 | 1>(0);
  const scope = SCOPES[scopeIndex];

  // `nights === null` is the cold-start flag; it also makes a scope switch
  // discard the previous feed before the next request begins.
  const [nights, setNights] = useState<PublishedNight[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [publishNight, setPublishNight] = useState<NightSummary | null>(null);

  const current = useTallyStore((state) => state.current);
  const history = useTallyStore((state) => state.history);
  const published = useVycepStore((state) => state.published);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // One live request per scope switch; a stale response must never clobber a
  // newer scope's list.
  const requestSeq = useRef(0);
  const handleScopeChange = useCallback((next: 0 | 1) => {
    // Invalidate the old scope before React renders the new one. A response
    // resolving between that render and its effect must not repaint old data.
    requestSeq.current += 1;
    setScopeIndex(next);
  }, []);

  const load = useCallback(() => {
    const seq = ++requestSeq.current;
    void fetchNightsFeed(scope).then((res) => {
      if (!mountedRef.current) return;
      // The spinner teardown must happen BEFORE the staleness guard. A
      // pull-to-refresh whose response is invalidated by a scope switch used to
      // return early here and leave `refreshing` true forever — the wheel sat
      // wedged above the feed until the screen was remounted, which is exactly
      // what "výčep mi nefunguje" looked like from the outside.
      setRefreshing(false);
      if (seq !== requestSeq.current) return;
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setNights(res.nights);
      setCursor(res.nextCursor);
    });
  }, [scope]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  // Scope switch resets the list during render (derived-state idiom); the
  // effect below then fetches the fresh scope.
  const [prevScope, setPrevScope] = useState(scope);
  if (scope !== prevScope) {
    setPrevScope(scope);
    setNights(null);
    setCursor(null);
    setFailed(false);
  }

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore || refreshing || nights === null) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    void fetchNightsFeed(scope, cursor).then((res) => {
      if (!mountedRef.current) return;
      // Always release the latch, including stale pages after a refresh or
      // scope switch, so later pagination can never stay blocked.
      setLoadingMore(false);
      if (seq !== requestSeq.current) return;
      if (!res.ok) return;
      setNights((previous) => {
        const seen = new Set((previous ?? []).map((night) => night.id));
        return [
          ...(previous ?? []),
          ...res.nights.filter((night) => !seen.has(night.id)),
        ];
      });
      setCursor(res.nextCursor);
    });
  }, [cursor, loadingMore, nights, refreshing, scope]);

  const handleRemoved = useCallback((nightClientId: string) => {
    setNights((previous) =>
      previous
        ? previous.filter((night) => night.clientId !== nightClientId)
        : previous,
    );
  }, []);

  const latestUnpublishedNight = useMemo(() => {
    const seenDays = new Set<string>();
    const summaries: NightSummary[] = [];

    for (const session of allSessionsNewestFirst(current, history)) {
      if (session.drinks.length === 0) continue;
      const dayKey = drinkingDayKey(new Date(session.startedAt));
      if (seenDays.has(dayKey)) continue;
      seenDays.add(dayKey);
      const summary = buildNightSummary(
        sessionsOfNight(current, history, dayKey),
      );
      if (summary) summaries.push(summary);
    }

    summaries.sort(
      (a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt),
    );
    return summaries.find((summary) => !published[summary.clientKey]) ?? null;
  }, [current, history, published]);

  const handleCta = useCallback(() => {
    if (latestUnpublishedNight) {
      setPublishNight(latestUnpublishedNight);
      return;
    }
    router.push('/beer');
  }, [latestUnpublishedNight, router]);

  const nudge = useMemo<Nudge | null>(() => {
    if (!failed) return null;
    return {
      kind: 'counted',
      text: cs.vycep.loadError,
      undoLabel: cs.vycep.retry,
      onUndo: load,
    };
  }, [failed, load]);

  const isColdStart = nights === null && !failed;
  const hideEmptyState =
    failed && (nights === null || nights.length === 0);

  const emptyComponent = isColdStart ? (
    <View
      style={styles.ghostList}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <GhostCard height={150} />
      <GhostCard height={150} />
      <GhostCard height={150} />
    </View>
  ) : hideEmptyState ? null : (
    <View style={styles.empty}>
      <TallyCoaster marks={0} nights={0} width={96} />
      <Text
        style={styles.emptyTitle}
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {scope === 'friends'
          ? cs.vycep.emptyPartaTitle
          : cs.vycep.emptyWorldTitle}
      </Text>
      <Text
        style={styles.emptyBody}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {scope === 'friends'
          ? cs.vycep.emptyPartaBody
          : cs.vycep.emptyWorldBody}
      </Text>
    </View>
  );

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => leaveRoute(router)}
          hitSlop={8}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.vycepBack}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <ScopeSegment value={scopeIndex} onChange={handleScopeChange} />
      </View>

      <FlatList
        style={styles.feed}
        data={nights ?? []}
        keyExtractor={(night) => night.id}
        renderItem={({ item }) => (
          <NightCard
            night={item}
            onRemoved={handleRemoved}
            onChanged={load}
          />
        )}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={Colors.amber}
          />
        }
        ListEmptyComponent={emptyComponent}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoading}>
              <GhostCard height={96} />
            </View>
          ) : null
        }
      />

      <NudgeSlot nudge={nudge} />

      <GlowButton
        label={
          latestUnpublishedNight
            ? cs.vycep.publishLatestCta
            : cs.vycep.logBeerCta
        }
        onPress={handleCta}
        variant="primary"
        glow="soft"
        height={62}
        accessibilityLabel={
          latestUnpublishedNight
            ? cs.a11y.publishNightButton
            : cs.vycep.logBeerCta
        }
      />

      {publishNight ? (
        <PublishNightSheet
          visible
          night={publishNight}
          onPublished={load}
          onClose={() => setPublishNight(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: 24,
    gap: 12,
  },
  header: {
    minHeight: 42,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  segment: {
    flex: 1,
    height: 46,
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.08),
    backgroundColor: withAlpha(Colors.foam, 0.04),
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  segmentItemActive: {
    backgroundColor: withAlpha(Colors.foam, 0.1),
  },
  segmentLabel: {
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.2,
    includeFontPadding: false,
  },
  segmentLabelActive: {
    color: Colors.foam,
  },
  segmentLabelMuted: {
    color: Colors.mutedText,
  },
  feed: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 12,
  },
  separator: {
    height: 12,
  },
  ghostList: {
    gap: 12,
  },
  ghostCard: {
    width: '100%',
    borderRadius: Radius.card,
    backgroundColor: withAlpha(Colors.foam, 0.05),
  },
  footerLoading: {
    paddingTop: 12,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  emptyTitle: {
    fontWeight: '800',
    fontSize: 20,
    color: Colors.foam,
    textAlign: 'center',
    includeFontPadding: false,
  },
  emptyBody: {
    fontWeight: '500',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
    textAlign: 'center',
    includeFontPadding: false,
  },
});
