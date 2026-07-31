/**
 * DESIGN MOCK — Hospody, as a Packeta-style branch list.
 *
 * The shape borrowed from Packeta is the LIST, not the palette: a search field
 * pinned at the top, then dense cells that answer the question on the cell
 * itself. You never tap a row to find out whether it is open.
 *
 * The compass is the list's head cell (§17.5) rather than a separate view, so
 * there is one road to "where do I go" instead of two. It is compact on
 * purpose — the compass is now a part of the app, not the whole of it — but it
 * keeps the one thing that made it iconic: a big distance and the pub it is
 * pointing at.
 *
 * Every row carries: distance, open state with the actual hour, the beer people
 * come for, its price, a rating — and, when there is one, what the party did
 * here before. That last line is the only genuinely new fact.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import {
  BeerIcon,
  MapIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  StarIcon,
  UsersIcon,
} from '@/components/shared/IconGlyph';
import { CompassCell } from '@/pubs/CompassCell';
import { MOCK_PUBS, type MockPub } from '@/pubs/mockPubs';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

function PubRow({ pub }: { pub: MockPub }) {
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {/* Packeta's 48x48 r12 pictogram well opens every row. */}
      <View style={styles.thumb}>
        <BeerIcon size={22} color={Colors.amber} />
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.pubName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {pub.name}
          </Text>
          <View style={styles.grow} />
          <Text style={styles.distance} allowFontScaling={false}>
            {pub.distance}
          </Text>
        </View>

        <Text style={styles.address} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {pub.address}
        </Text>

        {/* Open state and the beer are the two facts you came for. The price
            rides in brackets on the beer rather than as its own right-aligned
            column — it belongs to the beer, not to the row. */}
        <View style={styles.factsRow}>
          <View style={[styles.dot, { backgroundColor: pub.open ? Colors.open : Colors.closed }]} />
          <Text
            style={[styles.factText, { color: pub.open ? Colors.open : Colors.mutedText }]}
            numberOfLines={1}
            allowFontScaling={false}
          >
            {pub.open ? 'Otevřeno' : 'Zavřeno'} {pub.hours}
          </Text>
          <View style={styles.ratingChip}>
            <StarIcon size={11} color={Colors.amber} />
            <Text style={styles.ratingText} allowFontScaling={false}>
              {pub.rating.toFixed(1)}
            </Text>
          </View>
        </View>

        <Text style={styles.beer} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {pub.beer}
          {pub.priceCzk !== null ? (
            <Text style={styles.price}>{`  (${pub.priceCzk} Kč)`}</Text>
          ) : null}
        </Text>

        {pub.lastParty ? (
          <View style={styles.historyRow}>
            <UsersIcon size={13} color={withAlpha(Colors.amber, 0.9)} />
            <Text
              style={styles.historyText}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {pub.lastParty}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function PubListMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.sm, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.screenTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            Hospody
          </Text>
          <View style={styles.grow} />
          <Pressable
            onPress={() => router.push('/pubs-map' as Href)}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Mapa"
          >
            <MapIcon size={20} color={Colors.foam} />
          </Pressable>
        </View>

        {/* Search sits above the list, the way a branch picker does — one field,
            one filter door, no third control competing with them. */}
        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <SearchIcon size={17} color={Colors.mutedText} />
            <Text style={styles.searchPlaceholder} maxFontSizeMultiplier={FontScaleCap.body}>
              Hledej hospodu nebo pivo
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Filtry"
          >
            <SlidersHorizontalIcon size={18} color={Colors.foam} />
          </Pressable>
        </View>

        <CompassCell onPress={() => router.push('/pubs-map' as Href)} />

        <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.body}>
          V okolí
        </Text>

        <View style={styles.list}>
          {MOCK_PUBS.map((pub) => (
            <PubRow key={pub.id} pub={pub} />
          ))}
        </View>

        <Text style={styles.mockNote} maxFontSizeMultiplier={FontScaleCap.body}>
          Design mock — data jsou napevno.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: 16 },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  screenTitle: { ...MockType.titleXL, color: Colors.foam },
  headerButton: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // — Search —
  searchRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
  },
  searchPlaceholder: { fontWeight: '400', fontSize: 15, color: Colors.mutedText },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout2,
  },

  // — Compass head cell —
  compassCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.card,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
  },
  compassDial: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  compassKicker: {
    fontWeight: '700',
    fontSize: 13,
    color: withAlpha(Colors.amber, 0.9),
  },
  compassDistanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 1 },
  compassDistance: {
    fontWeight: '800',
    fontSize: 34,
    color: Colors.foam,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  compassUnit: { fontWeight: '500', fontSize: 13, color: Colors.mutedText },
  compassPub: { fontWeight: '700', fontSize: 16, color: Colors.foam, marginTop: 1 },
  compassMeta: { fontWeight: '400', fontSize: 12, color: Colors.mutedText, marginTop: 1 },

  // Packeta section header: 18pt Bold, sentence case, foam — NOT an 11pt
  // uppercase muted kicker. The kicker was the loudest "old app" tell.
  sectionTitle: {
    ...MockType.titleS,
    color: Colors.foam,
    marginTop: MockLayout.sectionGap,
    marginBottom: Spacing.sm,
  },

  // — Rows (Packeta list item: pictogram well + two lines + facts) —
  list: { gap: Spacing.sm },
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.sm + 2,
    borderRadius: MockLayout.cardRadius,
    backgroundColor: Colors.stout2,
  },
  thumb: {
    width: MockLayout.thumb,
    height: MockLayout.thumb,
    borderRadius: MockLayout.thumbRadius,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  pubName: { ...MockType.bodySemibold, fontSize: 17, color: Colors.foam, letterSpacing: -0.2 },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    height: 19,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  ratingText: { fontSize: 11, fontWeight: '700', color: Colors.amber },
  distance: {
    ...MockType.bodySmall,
    fontWeight: '600',
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  address: { fontSize: 13, fontWeight: '400', color: Colors.mutedText },
  factsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  factText: { fontSize: 13, fontWeight: '500' },
  beer: { ...MockType.bodySmall, color: Colors.foam, marginTop: 2 },
  price: { fontWeight: '700', color: Colors.mutedText },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  historyText: { flex: 1, fontSize: 12, fontWeight: '500', color: withAlpha(Colors.amber, 0.9) },

  mockNote: {
    fontWeight: '400',
    fontSize: 12,
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
});
