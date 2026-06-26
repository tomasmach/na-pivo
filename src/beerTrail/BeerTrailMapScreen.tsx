import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { fetchBeerTrailSnapshot, type BeerTrailPub, type BeerTrailSnapshot } from '@/beerTrail/beerTrailClient';
import {
  BeerIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CrownIcon,
  MapPinnedIcon,
  MapPinIcon,
  StarIcon,
} from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { formatPrice } from '@/utils/currency';
import { useSettingsStore } from '@/stores/settingsStore';

export default function BeerTrailMapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const [snapshot, setSnapshot] = useState<BeerTrailSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetchBeerTrailSnapshot({ signal: controller.signal }).then((next) => {
      setSnapshot(next);
      setLoaded(true);
    });
    return () => controller.abort();
  }, []);

  const trail = snapshot?.trail;
  const pubs = trail?.pubs ?? [];
  const stats = snapshot?.teaser;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.beerTrail.mapTitle}
        </Text>
        <Pressable
          onPress={() => router.push('/beer-trail-report' as Href)}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.beerTrail.openReport}
          hitSlop={4}
        >
          <StarIcon size={20} color={Colors.amber} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        {!loaded ? (
          <StateCard icon={<MapPinnedIcon size={24} color={Colors.amber} />} title={cs.beerTrail.loading} />
        ) : !snapshot ? (
          <StateCard icon={<MapPinnedIcon size={24} color={Colors.amber} />} title={cs.beerTrail.loadFailed} />
        ) : snapshot.locked ? (
          <LockedCard onPress={() => router.push('/beer-trail-plus' as Href)} />
        ) : (
          <>
            <View style={styles.heroCard}>
              <View style={styles.heroHeader}>
                <View style={styles.heroIcon}>
                  <MapPinnedIcon size={24} color={Colors.amber} />
                </View>
                <View style={styles.heroCopy}>
                  <Text style={styles.eyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.beerTrail.plusEyebrow}
                  </Text>
                  <Text style={styles.heroTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                    {cs.beerTrail.mapHeadline}
                  </Text>
                </View>
              </View>

              <PersonalMap pubs={pubs} />

              {!!trail?.nudge && (
                <Text style={styles.nudge} maxFontSizeMultiplier={FontScaleCap.body}>
                  {trail.nudge}
                </Text>
              )}
            </View>

            {stats && (
              <View style={styles.statsRow}>
                <Stat value={stats.distinctPubs} label={cs.beerTrail.statPubs} />
                <Stat value={stats.citiesCount} label={cs.beerTrail.statCities} />
                <Stat value={trail?.returningPubs.length ?? 0} label={cs.beerTrail.statReturns} />
              </View>
            )}

            <Section title={cs.beerTrail.favoritePubs}>
              {(trail?.favorites ?? []).slice(0, 5).map((pub) => (
                <PubRow key={pub.cacheKey} pub={pub} priceCurrency={priceCurrency} />
              ))}
              {pubs.length === 0 && <EmptyLine text={cs.beerTrail.noTrailYet} />}
            </Section>

            <Section title={cs.beerTrail.returningPubs}>
              {(trail?.returningPubs ?? []).slice(0, 5).map((pub) => (
                <PubRow key={pub.cacheKey} pub={pub} priceCurrency={priceCurrency} compact />
              ))}
              {(trail?.returningPubs.length ?? 0) === 0 && <EmptyLine text={cs.beerTrail.noReturnsYet} />}
            </Section>

            <Section title={cs.beerTrail.citiesTitle}>
              {(trail?.cities ?? []).slice(0, 8).map((city) => (
                <View key={city.name} style={styles.cityRow}>
                  <Text style={styles.cityName} maxFontSizeMultiplier={FontScaleCap.heading}>
                    {city.name}
                  </Text>
                  <Text style={styles.cityMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.beerTrail.cityMeta(city.pubsCount, city.beersCount)}
                  </Text>
                </View>
              ))}
              {(trail?.cities.length ?? 0) === 0 && <EmptyLine text={cs.beerTrail.noCitiesYet} />}
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PersonalMap({ pubs }: { pubs: BeerTrailPub[] }) {
  const points = useMemo(() => {
    const usable = pubs.filter((pub) => Number.isFinite(pub.lat) && Number.isFinite(pub.lng));
    if (usable.length <= 1) {
      return usable.map((pub) => ({ pub, left: 50, top: 50 }));
    }
    const minLat = Math.min(...usable.map((pub) => pub.lat));
    const maxLat = Math.max(...usable.map((pub) => pub.lat));
    const minLng = Math.min(...usable.map((pub) => pub.lng));
    const maxLng = Math.max(...usable.map((pub) => pub.lng));
    const latSpan = Math.max(0.0001, maxLat - minLat);
    const lngSpan = Math.max(0.0001, maxLng - minLng);
    return usable.map((pub) => ({
      pub,
      left: 10 + ((pub.lng - minLng) / lngSpan) * 80,
      top: 90 - ((pub.lat - minLat) / latSpan) * 80,
    }));
  }, [pubs]);

  return (
    <View style={styles.mapCanvas}>
      <View style={[styles.mapLine, styles.mapLineOne]} />
      <View style={[styles.mapLine, styles.mapLineTwo]} />
      {points.map(({ pub, left, top }) => (
        <View
          key={pub.cacheKey}
          style={[
            styles.mapPoint,
            {
              left: `${left}%`,
              top: `${top}%`,
              transform: [{ scale: pub.isReturning ? 1.18 : 1 }],
            },
          ]}
          accessible
          accessibilityRole="image"
          accessibilityLabel={cs.a11y.beerTrailMapPoint(pub.name)}
        >
          <View style={styles.mapPointInner} />
        </View>
      ))}
      {points.length === 0 && (
        <Text style={styles.mapEmpty} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.beerTrail.noTrailYet}
        </Text>
      )}
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} maxFontSizeMultiplier={FontScaleCap.display}>
        {value}
      </Text>
      <Text style={styles.statLabel} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.body}>
        {title}
      </Text>
      <View style={styles.listCard}>{children}</View>
    </>
  );
}

function PubRow({
  pub,
  priceCurrency,
  compact = false,
}: {
  pub: BeerTrailPub;
  priceCurrency: 'CZK' | 'EUR';
  compact?: boolean;
}) {
  return (
    <View style={styles.pubRow}>
      <View style={styles.pubIcon}>
        {compact ? <MapPinIcon size={17} color={Colors.amber} /> : <BeerIcon size={17} color={Colors.amber} />}
      </View>
      <View style={styles.pubText}>
        <Text style={styles.pubName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {pub.name}
        </Text>
        <Text style={styles.pubMeta} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.beerTrail.pubMeta(pub.visitsCount, pub.beersCount)}
        </Text>
      </View>
      {pub.totalSpentCzk > 0 && (
        <Text style={styles.pubSpent} maxFontSizeMultiplier={FontScaleCap.body}>
          {formatPrice(pub.totalSpentCzk, priceCurrency)}
        </Text>
      )}
    </View>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <Text style={styles.emptyLine} maxFontSizeMultiplier={FontScaleCap.body}>
      {text}
    </Text>
  );
}

function StateCard({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View style={styles.stateCard}>
      {icon}
      <Text style={styles.stateText} maxFontSizeMultiplier={FontScaleCap.body}>
        {title}
      </Text>
    </View>
  );
}

function LockedCard({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.lockedCard}>
      <CrownIcon size={28} color={Colors.amber} />
      <Text style={styles.lockedTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
        {cs.beerTrail.lockedTitle}
      </Text>
      <Text style={styles.lockedBody} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.beerTrail.lockedBody}
      </Text>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.lockedButton, pressed && styles.pressed]}>
        <Text style={styles.lockedButtonText}>{cs.beerTrail.unlock}</Text>
        <ChevronRightIcon size={18} color={Colors.stout} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.stout },
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
  headerAction: {
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
    fontSize: 23,
    color: Colors.foam,
  },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  heroCard: {
    backgroundColor: Colors.stout3,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.34),
    padding: 18,
    gap: Spacing.md,
  },
  heroHeader: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'center',
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: { flex: 1, minWidth: 0 },
  eyebrow: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: Colors.amber,
  },
  heroTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 25,
    color: Colors.foam,
  },
  mapCanvas: {
    height: 230,
    borderRadius: Radius.card,
    backgroundColor: Colors.stout,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  mapLine: {
    position: 'absolute',
    height: 1,
    width: '120%',
    backgroundColor: withAlpha(Colors.amber, 0.12),
    left: '-10%',
  },
  mapLineOne: {
    top: '34%',
    transform: [{ rotate: '-18deg' }],
  },
  mapLineTwo: {
    top: '68%',
    transform: [{ rotate: '13deg' }],
  },
  mapPoint: {
    position: 'absolute',
    width: 26,
    height: 26,
    marginLeft: -13,
    marginTop: -13,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.24),
    borderWidth: 1,
    borderColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPointInner: {
    width: 9,
    height: 9,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  mapEmpty: {
    margin: 18,
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    color: Colors.mutedText,
  },
  nudge: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  stat: {
    flex: 1,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  statValue: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 32,
    color: Colors.foam,
  },
  statLabel: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 0.9,
    color: Colors.mutedText,
  },
  sectionTitle: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.4,
    color: Colors.amber,
    marginLeft: 4,
    marginTop: Spacing.xs,
  },
  listCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  pubRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pubIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: withAlpha(Colors.amber, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  pubText: { flex: 1, minWidth: 0 },
  pubName: {
    fontFamily: Fonts.display.bold,
    fontSize: 17,
    color: Colors.foam,
  },
  pubMeta: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.mutedText,
  },
  pubSpent: {
    fontFamily: Fonts.ui.bold,
    fontSize: 13,
    color: Colors.amber,
  },
  cityRow: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  cityName: {
    fontFamily: Fonts.display.bold,
    fontSize: 17,
    color: Colors.foam,
  },
  cityMeta: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.mutedText,
  },
  emptyLine: {
    padding: 16,
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    color: Colors.mutedText,
  },
  stateCard: {
    minHeight: 150,
    borderRadius: Radius.cardLarge,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: 20,
  },
  stateText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  lockedCard: {
    borderRadius: Radius.cardLarge,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.34),
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
  },
  lockedTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
    textAlign: 'center',
  },
  lockedBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  lockedButton: {
    minHeight: 48,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lockedButtonText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 14,
    color: Colors.stout,
  },
  pressed: {
    opacity: 0.72,
  },
});
