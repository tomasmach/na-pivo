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
 * Paging is `snapToInterval` rather than `pagingEnabled` so the neighbouring
 * cards peek in at the edges — that peek is what tells you the card swipes at
 * all, without a hint label saying so.
 */

import React, { useCallback, useRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { CompassContainer } from '@/components/compass/CompassContainer';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { useCompassRotation } from '@/pubs/useCompassRotation';
import { MOCK_PUBS, type MockPub } from '@/pubs/mockPubs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

const DIAL = 62;
const GAP = Spacing.sm;
/** How much of the next card shows — the affordance that it swipes. */
const PEEK = 34;

/** Stand-in for the device position until the mock is wired to location. */
const HERE = { lat: 50.077, lng: 14.4165 };

function PubCard({ pub, width, nearest }: { pub: MockPub; width: number; nearest: boolean }) {
  const rotation = useCompassRotation(HERE, { lat: pub.lat, lng: pub.lng });

  return (
    <View style={[styles.card, { width }]}>
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
          {pub.open ? `Otevřeno ${pub.hours}` : `Zavřeno, ${pub.hours}`} · {pub.beer}
        </Text>
      </View>
    </View>
  );
}

export function PubCarousel({ onSelect }: { onSelect?: (id: string) => void }) {
  const { width: screen } = useWindowDimensions();
  const cardWidth = screen - MockLayout.screenPad * 2 - PEEK;
  const interval = cardWidth + GAP;
  const lastIndex = useRef(0);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(event.nativeEvent.contentOffset.x / interval);
      if (index === lastIndex.current) return;
      lastIndex.current = index;
      const pub = MOCK_PUBS[index];
      if (pub) onSelect?.(pub.id);
    },
    [interval, onSelect],
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
      {MOCK_PUBS.map((pub, index) => (
        <PubCard key={pub.id} pub={pub} width={cardWidth} nearest={index === 0} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: MockLayout.screenPad, gap: GAP },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: MockLayout.cardRadius,
    // Solid, not translucent: it sits on a map, and anything see-through here
    // means reading a pub name over street labels.
    backgroundColor: Colors.stout2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.12),
  },
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
