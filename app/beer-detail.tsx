import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BeerTagChips, sortTagsByCount } from '@/components/shared/BeerTagChips';
import { BeerIcon, ChevronLeftIcon, StarIcon, UsersIcon } from '@/components/shared/IconGlyph';
import { fetchBeerDetail, type BeerDetail } from '@/data/beerCheckinsClient';
import { FriendMini } from '@/friends/FriendMini';
import HairlineRow from '@/friends/HairlineRow';
import SectionHeader from '@/friends/SectionHeader';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { cs } from '@/i18n/cs';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { useReduceMotion } from '@/utils/useReduceMotion';

function shortDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
}

function formatAverage(value: number | null): string {
  return value == null ? '-' : value.toFixed(1);
}

/** Genitive Czech month names for the "Piješ ho od června" relationship line. */
const CZ_MONTHS_GENITIVE = [
  'ledna',
  'února',
  'března',
  'dubna',
  'května',
  'června',
  'července',
  'srpna',
  'září',
  'října',
  'listopadu',
  'prosince',
];

/**
 * Earliest check-in month, or '' when unknown. Prefers the server's
 * `first_checked_in_at` (exact even beyond the 50-item history cap); falls back
 * to deriving from the capped history on an older backend.
 */
function sinceMonthLabel(firstCheckedInAt: string | null, isoDates: string[]): string {
  let earliest = firstCheckedInAt ? Date.parse(firstCheckedInAt) : Number.NaN;
  if (!Number.isFinite(earliest)) {
    earliest = Number.POSITIVE_INFINITY;
    for (const iso of isoDates) {
      const ms = Date.parse(iso);
      if (Number.isFinite(ms) && ms < earliest) earliest = ms;
    }
  }
  if (!Number.isFinite(earliest)) return '';
  return CZ_MONTHS_GENITIVE[new Date(earliest).getMonth()] ?? '';
}

export default function BeerDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const params = useLocalSearchParams<{ beer?: string | string[]; brewery?: string | string[] }>();
  const beerName = useMemo(() => {
    const raw = params.beer;
    return (Array.isArray(raw) ? raw[0] : raw) ?? '';
  }, [params.beer]);
  const breweryName = useMemo(() => {
    const raw = params.brewery;
    return (Array.isArray(raw) ? raw[0] : raw) ?? '';
  }, [params.brewery]);

  const [detail, setDetail] = useState<BeerDetail | null>(null);
  const [failed, setFailed] = useState(() => !beerName);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const load = useCallback(() => {
    if (!beerName) {
      setFailed(true);
      return;
    }
    setFailed(false);
    void fetchBeerDetail(beerName, breweryName).then((result) => {
      if (!mountedRef.current) return;
      setDetail(result);
      setFailed(result == null);
    });
  }, [beerName, breweryName]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/friends');
  }, [router]);

  const sinceMonth = useMemo(
    () =>
      detail && detail.myCount > 0
        ? sinceMonthLabel(
            detail.firstCheckedInAt,
            detail.myHistory.map((c) => c.checkedInAt),
          )
        : '',
    [detail],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.sm }]}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={10}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
        >
          <ChevronLeftIcon size={26} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.beerCheckins.detailHeader}
        </Text>
        <View style={styles.headerBtn} />
      </View>

      {!detail && !failed ? (
        <View style={styles.loading}>
          <SkeletonBlock width={72} height={72} radius={36} reduceMotion={reduceMotion} />
          <SkeletonBlock width="80%" height={24} reduceMotion={reduceMotion} />
          <SkeletonBlock width="100%" height={84} reduceMotion={reduceMotion} />
        </View>
      ) : failed ? (
        <View style={styles.center}>
          <Text style={styles.emptyText} maxFontSizeMultiplier={FontScaleCap.body}>{cs.beerCheckins.detailLoadError}</Text>
          <Pressable
            onPress={load}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={cs.beerCheckins.detailRetry}
          >
            <Text style={styles.retryText} maxFontSizeMultiplier={FontScaleCap.body}>{cs.beerCheckins.detailRetry}</Text>
          </Pressable>
        </View>
      ) : detail ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}>
          <View style={styles.hero}>
            <BeerIcon size={38} color={Colors.amber} />
            <Text style={styles.title} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
              {detail.beerName}
            </Text>
            {detail.breweryName ? (
              <Text style={styles.subtitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {detail.breweryName}
              </Text>
            ) : null}
            {sinceMonth ? (
              <Text style={styles.relationship} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.beerCheckins.detailSinceMonth(sinceMonth)}
              </Text>
            ) : null}
          </View>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue} allowFontScaling={false}>{detail.myCount}</Text>
              <Text style={styles.statLabel} maxFontSizeMultiplier={FontScaleCap.body}>moje</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue} allowFontScaling={false}>{formatAverage(detail.myAverageRating)}</Text>
              <Text style={styles.statLabel} maxFontSizeMultiplier={FontScaleCap.body}>můj průměr</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue} allowFontScaling={false}>{formatAverage(detail.partyAverageRating)}</Text>
              <Text style={styles.statLabel} maxFontSizeMultiplier={FontScaleCap.body}>parta</Text>
            </View>
          </View>

          {sortTagsByCount(detail.myTags).length > 0 ? (
            <View style={styles.section}>
              <SectionHeader label={cs.beerCheckins.detailMyTagsLabel.toUpperCase()} />
              <BeerTagChips tags={sortTagsByCount(detail.myTags)} counts={detail.myTags} max={8} />
            </View>
          ) : null}

          {detail.partyDrinkers.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader label="KDO Z PARTY PIL" />
              {detail.partyDrinkers.map((profile, i) => (
                <HairlineRow key={profile.id} first={i === 0}>
                  <FriendMini profile={profile} />
                </HairlineRow>
              ))}
            </View>
          ) : null}

          <View style={styles.section}>
            <SectionHeader label="POSLEDNÍ ZÁPISY" />
            {detail.recentCheckins.length > 0 ? (
              detail.recentCheckins.map((checkIn, i) => (
                <HairlineRow key={checkIn.id} first={i === 0}>
                  <View style={styles.row}>
                    <StarIcon size={15} color={Colors.amber} />
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                        {checkIn.account.nickname ? `@${checkIn.account.nickname}` : checkIn.account.displayName}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                        {[checkIn.rating != null ? `${checkIn.rating.toFixed(1)} / 5` : '', checkIn.pubName, shortDate(checkIn.checkedInAt)]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                      {checkIn.tags.length > 0 ? (
                        <View style={styles.rowTags}>
                          <BeerTagChips tags={checkIn.tags} />
                        </View>
                      ) : null}
                    </View>
                  </View>
                </HairlineRow>
              ))
            ) : (
              <Text style={styles.emptyText} maxFontSizeMultiplier={FontScaleCap.body}>Zatím žádný zápis.</Text>
            )}
          </View>

          <View style={styles.section}>
            <SectionHeader label="MOJE HISTORIE" />
            {detail.myHistory.length > 0 ? (
              detail.myHistory.map((checkIn, i) => (
                <HairlineRow key={checkIn.id} first={i === 0}>
                  <View style={styles.row}>
                    <UsersIcon size={15} color={Colors.mutedText} />
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                        {checkIn.pubName || 'Bez hospody'}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                        {[checkIn.rating != null ? `${checkIn.rating.toFixed(1)} / 5` : '', shortDate(checkIn.checkedInAt)]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                      {checkIn.tags.length > 0 ? (
                        <View style={styles.rowTags}>
                          <BeerTagChips tags={checkIn.tags} />
                        </View>
                      ) : null}
                    </View>
                  </View>
                </HairlineRow>
              ))
            ) : (
              <Text style={styles.emptyText} maxFontSizeMultiplier={FontScaleCap.body}>Tohle pivo sis ještě nezapsal.</Text>
            )}
          </View>
        </ScrollView>
      ) : null}
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
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    fontWeight: '800',
    fontSize: 18,
    color: Colors.foam,
  },
  loading: {
    paddingTop: Spacing.xxl,
    gap: Spacing.md,
    alignItems: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  retryButton: {
    minHeight: HitArea.min,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  retryText: { fontSize: 15, fontWeight: '700', color: Colors.stout },
  pressed: { opacity: 0.65 },
  content: {
    paddingTop: Spacing.lg,
    gap: Spacing.lg,
  },
  hero: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  title: {
    fontWeight: '800',
    fontSize: 30,
    lineHeight: 36,
    color: Colors.foam,
    textAlign: 'center',
  },
  subtitle: {
    fontWeight: '500',
    fontSize: 14,
    color: Colors.foamMuted,
  },
  relationship: {
    marginTop: 2,
    fontWeight: '700',
    fontSize: 13,
    color: Colors.amber,
  },
  rowTags: {
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  stat: {
    flex: 1,
    minHeight: 74,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
  },
  statValue: {
    fontWeight: '800',
    fontSize: 24,
    color: Colors.amber,
  },
  statLabel: {
    marginTop: 2,
    fontWeight: '500',
    fontSize: 12,
    color: Colors.mutedText,
  },
  section: {
    gap: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontWeight: '700',
    fontSize: 14,
    color: Colors.foam,
  },
  rowMeta: {
    marginTop: 2,
    fontWeight: '500',
    fontSize: 12,
    color: Colors.mutedText,
  },
  emptyText: {
    fontWeight: '500',
    fontSize: 14,
    color: Colors.mutedText,
    textAlign: 'center',
  },
});
