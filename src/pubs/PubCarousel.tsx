import React, { useCallback, useRef } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';

import { CompassContainer } from '@/components/compass/CompassContainer';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import type { PubPosition, PubPresentation } from '@/pubs/pubPresentation';
import { useCompassRotation } from '@/pubs/useCompassRotation';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';
import { t } from '@/i18n';

const GLASS = isLiquidGlassAvailable();
const DIAL = 62;
const GAP = Spacing.sm;

function PubCard({
  pub,
  position,
  width,
  nearest,
  onPress,
}: {
  pub: PubPresentation;
  position: PubPosition;
  width: number;
  nearest: boolean;
  onPress?: () => void;
}) {
  const rotation = useCompassRotation(position, { lat: pub.pub.lat, lng: pub.pub.lng });

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { width }, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={t.pubList.carouselA11y(pub.name, pub.distanceLabel ?? t.pubList.distanceUnknown)}
    >
      {GLASS ? (
        <GlassView
          style={StyleSheet.absoluteFill}
          glassEffectStyle="regular"
          tintColor={withAlpha(Colors.stout, 0.72)}
          colorScheme="dark"
          pointerEvents="none"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.solid]} pointerEvents="none" />
      )}
      <CompassContainer rotation={rotation} size={DIAL} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {pub.name}
        </Text>
        <View style={styles.distanceRow}>
          <Text style={styles.distance} allowFontScaling={false}>
            {pub.distanceLabel}
          </Text>
          {nearest ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} allowFontScaling={false}>
                {t.compass.modeNearest}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {[pub.openLabel, pub.beerLine].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

export function PubCarousel({
  pubs,
  position,
  onSelect,
  onOpen,
}: {
  pubs: readonly PubPresentation[];
  position: PubPosition;
  onSelect?: (id: string) => void;
  onOpen?: (id: string) => void;
}) {
  const { width: screen } = useWindowDimensions();
  const cardWidth = screen - MockLayout.screenPad * 2;
  const interval = cardWidth + GAP;
  const lastIndex = useRef(0);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(event.nativeEvent.contentOffset.x / interval);
      if (index === lastIndex.current) return;
      lastIndex.current = index;
      const pub = pubs[index];
      if (pub) onSelect?.(pub.id);
    },
    [interval, onSelect, pubs],
  );

  const renderCard = useCallback(
    ({ item: pub, index }: ListRenderItemInfo<PubPresentation>) => (
      <PubCard
        pub={pub}
        position={position}
        width={cardWidth}
        nearest={index === 0}
        onPress={() => onOpen?.(pub.id)}
      />
    ),
    [cardWidth, onOpen, position],
  );

  // Virtualized: the carousel mounts the moment the sheet drops to `peek`,
  // and eagerly building a glass card (plus its reanimated compass dial) for
  // every loaded pub froze the map drag for seconds. Fixed card metrics make
  // getItemLayout exact, so snapping behaves like the old ScrollView.
  return (
    <FlatList
      horizontal
      data={pubs as PubPresentation[]}
      keyExtractor={(pub) => pub.id}
      renderItem={renderCard}
      showsHorizontalScrollIndicator={false}
      snapToInterval={interval}
      decelerationRate="fast"
      contentContainerStyle={styles.row}
      onMomentumScrollEnd={handleScroll}
      initialNumToRender={3}
      maxToRenderPerBatch={4}
      windowSize={5}
      getItemLayout={(_, index) => ({
        length: interval,
        offset: MockLayout.screenPad + interval * index,
        index,
      })}
    />
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  row: { paddingHorizontal: MockLayout.screenPad, gap: GAP },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: MockLayout.cardRadius,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  solid: { backgroundColor: Colors.stout2 },
  body: { flex: 1 },
  name: { ...MockType.titleS, color: Colors.foam },
  distanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  distance: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  badge: {
    paddingHorizontal: 8,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.14),
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: Colors.amber },
  meta: { fontSize: 12, fontWeight: '400', color: Colors.mutedText, marginTop: 1 },
});
