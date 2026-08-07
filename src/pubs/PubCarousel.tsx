/**
 * DESIGN MOCK — the swipeable pub card that floats over the map.
 *
 * When the sheet is down and the map is the screen, one card rides above it:
 * the pub, its distance, and the live compass pointing at it. Swiping sideways
 * walks through the pubs and the map highlights whichever card you are on —
 * the Apple Maps / Packeta places idiom, and the same object Strava floats over
 * a route.
 *
 * It only exists at the `peek` detent. At `half` and `full` the list itself is
 * on screen, and a carousel of the same pubs above it would be the same content
 * twice (§0.3).
 *
 * One card fills the width; the next is fully off-screen. `snapToInterval`
 * rather than `pagingEnabled` because the cards are inset by the screen padding
 * and separated by a gap, so a "page" is not the viewport width.
 */

import React, { useCallback, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';

import { CompassContainer } from '@/components/compass/CompassContainer';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { useCompassRotation } from '@/pubs/useCompassRotation';
import type { PubListItem } from '@/pubs/pubPresentation';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

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
  pub: PubListItem;
  position: { lat: number; lng: number };
  width: number;
  nearest: boolean;
  onPress?: () => void;
}) {
  const rotation = useCompassRotation(position, { lat: pub.lat, lng: pub.lng });

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { width }, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${pub.name}, ${pub.distance}, detail`}
    >
      {/* Glass, like Packeta's places card. Tinted hard enough that a pub name
          never has to be read against a street label showing through — glass
          here is a material, not transparency for its own sake. */}
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
            {pub.distance}
          </Text>
          {nearest ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} allowFontScaling={false}>
                Nejbližší
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {pub.hoursLabel} · {pub.beerLabel}
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
  pubs: PubListItem[];
  position: { lat: number; lng: number };
  onSelect?: (id: string) => void;
  /** Tapping a card opens that pub — the card is a row, not a caption. */
  onOpen?: (id: string) => void;
}) {
  const { width: screen } = useWindowDimensions();
  // One card per screen width: no peek of the next one.
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

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={interval}
      decelerationRate="fast"
      contentContainerStyle={styles.row}
      onMomentumScrollEnd={handleScroll}
    >
      {pubs.map((pub, index) => (
        <PubCard
          key={pub.id}
          pub={pub}
          position={position}
          width={cardWidth}
          nearest={index === 0}
          onPress={() => onOpen?.(pub.id)}
        />
      ))}
    </ScrollView>
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
  /** The pre-glass surface, kept for iOS < 26 and Android. */
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
