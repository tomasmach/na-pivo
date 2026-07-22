/**
 * VycepScreen — the Výčep: the feed of nights people chose to hang up
 * ("Strava for beer drinkers"). Two scopes behind one segmented control:
 * Parta (friends' + my nights) and Svět (the global, explicitly-public feed).
 *
 * Loading follows the local idiom: cursor-paginated fetch on focus and on
 * scope change, pull-to-refresh, skeleton only on a true cold start, and an
 * inline error state with retry (never a dead white screen). Reaction and
 * unpublish mutations reconcile in place without a full reload jump.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ChevronLeftIcon, HandPlatterIcon } from '@/components/shared/IconGlyph';
import {
  fetchNightsFeed,
  type NightsFeedScope,
  type PublishedNight,
} from '@/data/nightsClient';
import { cs } from '@/i18n/cs';
import SegmentedControl from '@/friends/SegmentedControl';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { useReduceMotion } from '@/utils/useReduceMotion';
import { NightCard } from '@/vycep/NightCard';

const SCOPES: readonly [NightsFeedScope, NightsFeedScope] = ['friends', 'global'];

export default function VycepScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  const [scopeIndex, setScopeIndex] = useState<0 | 1>(0);
  const scope = SCOPES[scopeIndex];

  // `nights === null` doubles as the cold-start flag, so the initial-load
  // effect never has to set a loading boolean synchronously.
  const [nights, setNights] = useState<PublishedNight[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

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

  const load = useCallback(() => {
    const seq = ++requestSeq.current;
    void fetchNightsFeed(scope).then((res) => {
      if (!mountedRef.current || seq !== requestSeq.current) return;
      setRefreshing(false);
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

  // Scope switch resets the list during render (derived-state idiom), the
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
      // Always release the pagination latch, even when a scope switch or
      // refresh made this page stale, or later pagination would stay blocked.
      setLoadingMore(false);
      if (seq !== requestSeq.current) return;
      if (!res.ok) return;
      setNights((prev) => {
        const seen = new Set((prev ?? []).map((n) => n.id));
        return [...(prev ?? []), ...res.nights.filter((n) => !seen.has(n.id))];
      });
      setCursor(res.nextCursor);
    });
  }, [cursor, loadingMore, nights, refreshing, scope]);

  const handleRemoved = useCallback((nightClientId: string) => {
    setNights((prev) => (prev ? prev.filter((n) => n.clientId !== nightClientId) : prev));
  }, []);

  const isColdStart = nights === null && !failed;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.vycepBack}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {cs.vycep.title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.scopeRow}>
        <SegmentedControl
          options={[cs.vycep.scopeParta, cs.vycep.scopeWorld]}
          value={scopeIndex}
          onChange={setScopeIndex}
          accessibilityLabel={cs.vycep.title}
        />
      </View>

      {isColdStart ? (
        <View style={styles.skeletons}>
          {[0, 1, 2].map((i) => (
            <SkeletonBlock
              key={i}
              width="100%"
              height={150}
              radius={Radius.card}
              reduceMotion={reduceMotion}
            />
          ))}
        </View>
      ) : failed && !nights ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.vycep.loadError}
          </Text>
          <Pressable
            onPress={load}
            accessibilityRole="button"
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryText}>{cs.vycep.retry}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={nights ?? []}
          keyExtractor={(night) => night.id}
          renderItem={({ item }) => (
            <NightCard night={item} onRemoved={handleRemoved} onChanged={load} />
          )}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.amber} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyGlyph}>
                <HandPlatterIcon size={26} color={Colors.amber} />
              </View>
              <Text style={styles.emptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                {scope === 'friends' ? cs.vycep.emptyPartaTitle : cs.vycep.emptyWorldTitle}
              </Text>
              <Text style={styles.emptyBody} maxFontSizeMultiplier={FontScaleCap.body}>
                {scope === 'friends' ? cs.vycep.emptyPartaBody : cs.vycep.emptyWorldBody}
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoading}>
                <SkeletonBlock
                  width="100%"
                  height={150}
                  radius={Radius.card}
                  reduceMotion={reduceMotion}
                />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },
  scopeRow: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    flexGrow: 1,
  },
  skeletons: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  footerLoading: {
    paddingTop: Spacing.md,
  },
  empty: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
  },
  emptyGlyph: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
    marginBottom: Spacing.xs,
  },
  emptyTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 20,
    color: Colors.foam,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: Spacing.sm,
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 14,
    color: Colors.stout,
  },
  pressed: {
    opacity: 0.7,
  },
});
