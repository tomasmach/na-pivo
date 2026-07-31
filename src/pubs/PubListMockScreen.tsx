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
 * come for, its price and a rating — plus a heart when you have been here
 * before. How many times and when is a detail-screen answer; as a sentence on
 * every row it competed with the facts you actually scan.
 */

import React from 'react';
import {
  ActionSheetIOS,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import {
  BeerIcon,
  ChevronDownIcon,
  LocateFixedIcon,
  ChevronRightIcon,
  HeartIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  StarIcon,
} from '@/components/shared/IconGlyph';
import { CompassCell } from '@/pubs/CompassCell';
import { DETENT_TOP, PlacesSheet, type Detent } from '@/pubs/PlacesSheet';
import { PubsMap } from '@/pubs/PubsMap';
import { MOCK_PUBS, type MockPub } from '@/pubs/mockPubs';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

/**
 * How the list is ordered. "Nejbližší" is the default because standing
 * somewhere and asking "where do I go" is the whole job of this screen;
 * "Vše" was never an answer to anything.
 */
const SORTS = ['Nejbližší', 'Nejlépe hodnocené', 'Náhodně v okolí'] as const;
type Sort = (typeof SORTS)[number];

/**
 * The beer is why you pick one pub over another, so it gets its own pill next
 * to "Otevřeno" rather than hiding behind the sliders. This maps onto the
 * filter the app already has — `PubSearchFilters.beerBrand`.
 */
const BEERS = ['Pilsner Urquell', 'Kozel', 'Matuška', 'Únětické', 'Kacíř'] as const;

/**
 * Independent toggles, on top of whatever the sort is. These are real
 * `mapFilterable` amenity keys from `src/data/amenities.ts`
 * (`practical_tank_beer`, `seating_garden`) plus the open-now state — not
 * invented labels.
 */
const TOGGLES = ['Otevřeno', 'Tank', 'Zahrádka'] as const;

function FilterChips() {
  const [sort, setSort] = React.useState<Sort>('Nejbližší');
  const [on, setOn] = React.useState<string[]>([]);

  const [beer, setBeer] = React.useState<string | null>(null);

  const openBeer = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Jakékoliv pivo', ...BEERS, 'Zrušit'],
        cancelButtonIndex: BEERS.length + 1,
        title: 'Pivo',
        userInterfaceStyle: 'dark',
      },
      (index) => {
        if (index === 0) setBeer(null);
        else if (index <= BEERS.length) setBeer(BEERS[index - 1]);
      },
    );
  };

  const openSort = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...SORTS, 'Zrušit'],
        cancelButtonIndex: SORTS.length,
        title: 'Seřadit',
        userInterfaceStyle: 'dark',
      },
      (index) => {
        if (index < SORTS.length) setSort(SORTS[index]);
      },
    );
  };

  const toggle = (label: string) =>
    setOn((current) =>
      current.includes(label) ? current.filter((l) => l !== label) : [...current, label],
    );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipsRow}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable
        style={({ pressed }) => [styles.chipIcon, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Filtry"
      >
        <SlidersHorizontalIcon size={17} color={Colors.foam} />
      </Pressable>

      {/* The sort is a dropdown, not one of the toggles — it answers a
          different question and only ever has one answer at a time.
          This SHOULD be a menu that morphs out of the pill. It briefly was, via
          `react-native-ios-context-menu` (the library Spendee uses), but that
          package's peer `react-native-ios-utilities` fails to link against this
          Xcode SDK: "cannot link directly with 'SwiftUICore' because product
          being built is not an allowed client of it". Fixing it means a config
          plugin re-adding a linker flag after every `expo prebuild --clean` —
          a permanent maintenance tax for one control. The action sheet is the
          same system control, presented from the bottom instead of the anchor. */}
      <Pressable
        onPress={openSort}
        style={({ pressed }) => [styles.chip, styles.chipActive, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Seřadit: ${sort}`}
      >
        <Text style={[styles.chipText, styles.chipTextActive]} allowFontScaling={false}>
          {sort}
        </Text>
        <ChevronDownIcon size={14} color={Colors.amber} />
      </Pressable>

      {/* Beer is a value, not a toggle — one answer at a time — so it is a
          dropdown like the sort, and sits right beside "Otevřeno". */}
      <Pressable
        onPress={openBeer}
        style={({ pressed }) => [styles.chip, beer && styles.chipActive, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={beer ? `Pivo: ${beer}` : 'Vybrat pivo'}
      >
        <Text
          style={[styles.chipText, beer && styles.chipTextActive]}
          allowFontScaling={false}
        >
          {beer ?? 'Pivo'}
        </Text>
        <ChevronDownIcon size={14} color={beer ? Colors.amber : Colors.mutedText} />
      </Pressable>

      {TOGGLES.map((label) => {
        const active = on.includes(label);
        return (
          <Pressable
            key={label}
            onPress={() => toggle(label)}
            style={({ pressed }) => [
              styles.chip,
              active && styles.chipActive,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
          >
            <Text
              style={[styles.chipText, active && styles.chipTextActive]}
              allowFontScaling={false}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function PubRow({ pub, nearest }: { pub: MockPub; nearest?: boolean }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, nearest && styles.rowNearest, pressed && styles.pressed]}
    >
      {/* The well is the pub's picture — a photo, or a static map of the spot
          when there is none. Until either is wired it carries the initial, so
          the rows still differ from each other at a glance instead of being
          five identical beer glyphs. The beer moves to the corner badge: it
          says "this is a pub", which is a label, not the picture. */}
      <View style={styles.thumb}>
        <Text style={styles.thumbInitial} allowFontScaling={false}>
          {pub.name.slice(0, 1).toUpperCase()}
        </Text>
        <View style={styles.thumbBadge}>
          <BeerIcon size={11} color={Colors.stout} />
        </View>
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.pubName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {pub.name}
          </Text>
          <StarIcon size={12} color={Colors.amber} />
          <Text style={styles.rating} allowFontScaling={false}>
            {pub.rating.toFixed(1)}
          </Text>
          {/* Been here before. Just the fact — how many times and when is a
              detail-screen answer, and spelling it out on every row was a
              second sentence competing with the ones you actually scan. */}
          {pub.lastParty ? (
            <View accessible accessibilityLabel="Už jsi tu byl">
              <HeartIcon size={13} color={Colors.amber} />
            </View>
          ) : null}
        </View>

        <Text style={styles.address} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {pub.address}
        </Text>

        {/* One line, the way Packeta writes it: state · distance · why it is
            first. The price rides in brackets on the beer below. */}
        <View style={styles.factsRow}>
          <Text
            style={[styles.factText, { color: pub.open ? Colors.open : Colors.mutedText }]}
            allowFontScaling={false}
          >
            {pub.open ? `Otevřeno ${pub.hours}` : `Zavřeno, ${pub.hours}`}
          </Text>
          <Text style={styles.distance} allowFontScaling={false}>
            {pub.distance}
          </Text>
          {nearest ? (
            <Text style={styles.nearestTag} allowFontScaling={false}>
              Nejbližší
            </Text>
          ) : null}
        </View>

        <Text style={styles.beer} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {pub.beer}
          {pub.priceCzk !== null ? (
            <Text style={styles.price}>{`  (${pub.priceCzk} Kč)`}</Text>
          ) : null}
        </Text>

      </View>

      <ChevronRightIcon size={18} color={Colors.mutedText} />
    </Pressable>
  );
}

export default function PubListMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const [detent, setDetent] = React.useState<Detent>('half');
  const [collapseSignal, setCollapseSignal] = React.useState(0);
  const [listAtTop, setListAtTop] = React.useState(true);

  // The locate button rides just above the sheet's resting top, so collapsing
  // the sheet walks the button down with it instead of stranding it.
  const sheetTop = height * DETENT_TOP[detent];

  return (
    <View style={styles.screen}>
      {/* The map is the screen; the places ride over it in a sheet you drag. */}
      <View style={styles.map}>
        <PubsMap
          onPressPub={() => router.push('/pubs-map' as Href)}
          onPan={() => setCollapseSignal((n) => n + 1)}
        />
      </View>

      <Pressable
        onPress={() => router.push('/pubs-map' as Href)}
        style={({ pressed }) => [
          styles.locate,
          { top: sheetTop - 56 },
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Vycentrovat na mě"
      >
        {/* The real SF Symbol, not a lookalike: this button means the same
            thing as Apple Maps' tracking button, so it should be the same
            glyph. `location.fill` is what iOS uses for "centre on me". */}
        <SymbolView
          name="location.fill"
          size={19}
          tintColor={Colors.foam}
          resizeMode="scaleAspectFit"
          fallback={<LocateFixedIcon size={20} color={Colors.foam} />}
        />
      </Pressable>

      <PlacesSheet
        initial="half"
        onDetentChange={setDetent}
        collapseSignal={collapseSignal}
        listAtTop={listAtTop}
      >
        {/* Search lives IN the sheet, above the chips — the reference puts it
            here, not in a nav bar, because it filters the list under it. */}
        <View style={styles.searchWrap}>
          <View style={styles.searchField}>
            <SearchIcon size={17} color={Colors.mutedText} />
            <Text style={styles.searchPlaceholder} maxFontSizeMultiplier={FontScaleCap.body}>
              Hledej hospodu nebo pivo
            </Text>
          </View>
        </View>

        <FilterChips />

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          // Below `full` the sheet owns the drag (see PlacesSheet); letting the
          // list scroll at the same time would make one gesture do two things.
          scrollEnabled={detent === 'full'}
          scrollEventThrottle={16}
          onScroll={(event) => {
            const atTop = event.nativeEvent.contentOffset.y <= 0.5;
            setListAtTop((current) => (current === atTop ? current : atTop));
          }}
        >
          <CompassCell onPress={() => router.push('/pubs-map' as Href)} />

          <View style={styles.list}>
            {MOCK_PUBS.map((pub, index) => (
              <PubRow key={pub.id} pub={pub} nearest={index === 0} />
            ))}
          </View>

          <Text style={styles.mockNote} maxFontSizeMultiplier={FontScaleCap.body}>
            Design mock — data jsou napevno.
          </Text>
        </ScrollView>
      </PlacesSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: 16, paddingTop: 4 },
  map: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
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

  // — Search + filters, inside the sheet —
  searchWrap: { paddingHorizontal: MockLayout.screenPad, paddingBottom: Spacing.sm },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 46,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
  },
  searchPlaceholder: { ...MockType.body, color: Colors.mutedText },
  chipsRow: {
    paddingHorizontal: MockLayout.screenPad,
    gap: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  chipIcon: {
    width: MockLayout.pillHeight,
    height: MockLayout.pillHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: MockLayout.pillHeight,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { borderColor: withAlpha(Colors.amber, 0.5) },
  chipText: { fontSize: 14, fontWeight: '600', color: Colors.mutedText },
  chipTextActive: { color: Colors.amber },

  // — Rows (Packeta list item: photo well + title + facts) —
  // Rows sit straight on the sheet, separated by a hairline. Wrapping each one
  // in its own bordered card put a rectangle inside a rectangle inside the
  // sheet — three frames deep, and §14.10 kills exactly that. The list reads as
  // a list; nothing needs a container to prove it is a row.
  list: { marginTop: Spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  /** The nearest one needs no tinted panel — the amber tag already says why. */
  rowNearest: {},
  thumb: {
    width: MockLayout.thumb,
    height: MockLayout.thumb,
    borderRadius: MockLayout.thumbRadius,
    alignItems: 'center',
    justifyContent: 'center',
    // Neutral, not amber: it is a picture well, and a tinted one would fight
    // the photo that eventually fills it.
    backgroundColor: Colors.stout3,
    overflow: 'visible',
  },
  thumbInitial: { fontSize: 19, fontWeight: '700', color: withAlpha(Colors.foam, 0.55) },
  thumbBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  rowBody: { flex: 1, gap: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pubName: { ...MockType.bodySemibold, color: Colors.foam, letterSpacing: -0.2 },
  rating: { fontSize: 12, fontWeight: '700', color: Colors.amber },
  address: { fontSize: 13, fontWeight: '400', color: Colors.mutedText },
  factsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 1 },
  factText: { fontSize: 13, fontWeight: '600' },
  distance: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  nearestTag: { fontSize: 13, fontWeight: '700', color: Colors.amber },
  beer: { ...MockType.bodySmall, color: Colors.foam, marginTop: 2 },
  price: { fontWeight: '700', color: Colors.mutedText },

  locate: {
    position: 'absolute',
    right: MockLayout.screenPad,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha('#000000', 0.62),
  },
  mockNote: {
    fontWeight: '400',
    fontSize: 12,
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
});
